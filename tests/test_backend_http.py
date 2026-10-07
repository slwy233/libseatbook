"""Loopback integration and shared OCR concurrency tests, no school requests."""
import base64
from http.client import HTTPConnection
import importlib.util
import io
import json
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ocr_server'))
from backend_runtime import ApiError, LazyOCR, captcha_result, decode_image


def import_ocr():
    spec = importlib.util.spec_from_file_location('ocr_integration', Path(__file__).resolve().parents[1] / 'ocr_server' / 'server.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackendRuntimeTests(unittest.TestCase):
    def test_lazy_model_is_constructed_once_and_inference_is_serial(self):
        engine, runtime = Mock(), LazyOCR()
        state = {'active': 0, 'maximum': 0}
        lock = threading.Lock()
        def classify(_):
            with lock:
                state['active'] += 1
                state['maximum'] = max(state['maximum'], state['active'])
            time.sleep(0.02)
            with lock:
                state['active'] -= 1
            return 'AB'
        engine.classification.side_effect = classify
        factory = Mock(return_value=engine)
        threads = [threading.Thread(target=lambda: runtime.classification(b'image')) for _ in range(5)]
        with patch.dict(sys.modules, {'ddddocr': types.SimpleNamespace(DdddOcr=factory)}):
            factory.assert_not_called()
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(3)
        factory.assert_called_once()
        self.assertEqual(state['maximum'], 1)
        self.assertTrue(all(not thread.is_alive() for thread in threads))

    def test_images_reject_bad_types_base64_empty_or_oversized(self):
        for value in (None, '', [], '***', 'data:text/plain;base64,AA==', 'data:image/png;url,AA=='):
            with self.subTest(value=value):
                with self.assertRaises(ApiError):
                    decode_image(value)
        with self.assertRaises(ApiError) as raised:
            decode_image(base64.b64encode(b'abc').decode(), max_bytes=2)
        self.assertEqual(raised.exception.code, 413)

    def test_arithmetic_zero_division_and_empty_result_are_not_valid_answers(self):
        for raw in ('1/0=', '??', '中文'):
            with self.subTest(raw=raw):
                with self.assertRaises(ApiError):
                    captcha_result(raw)


class OcrHttpTests(unittest.TestCase):
    def setUp(self):
        self.module = import_ocr()
        self.module.ocr._engine = Mock()
        self.module.ocr._engine.classification.return_value = '2X3=?'
        self.httpd = self.module.ThreadingHTTPServer(('127.0.0.1', 0), self.module.Handler)
        self.worker = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.worker.join(3)

    def call(self, method, path, body=None, headers=None):
        connection = HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw) if raw else None
        finally:
            connection.close()

    def test_valid_ocr_response_has_json_length_and_cors(self):
        body = json.dumps({'image': 'data:image/png;base64,AA=='})
        status, headers, data = self.call('POST', '/', body, {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        self.assertEqual(data['text'], '6')
        self.assertTrue(data['isMath'])
        self.assertEqual(int(headers['Content-Length']), len(json.dumps(data, ensure_ascii=False).encode()))
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['Access-Control-Allow-Origin'], '*')

    def test_bad_json_type_content_length_and_unknown_path(self):
        for body, headers, expected in [
            ('[]', {'Content-Type': 'application/json'}, 400),
            ('{', {'Content-Type': 'application/json'}, 400),
            ('{}', {'Content-Type': 'text/plain'}, 415),
            ('{}', {'Content-Length': str(self.module.MAX_BODY_BYTES + 1)}, 413),
            ('{}', {'Transfer-Encoding': 'chunked'}, 400),
        ]:
            with self.subTest(body=body, expected=expected):
                status, _, data = self.call('POST', '/', body, headers)
                self.assertEqual(status, expected)
                self.assertFalse(data['status'])
        self.assertEqual(self.call('POST', '/unknown', '{}')[0], 404)

    def test_inference_failure_is_503_without_exception_details(self):
        self.module.ocr._engine.classification.side_effect = RuntimeError('secret path or image')
        status, _, data = self.call('POST', '/', '{"image":"AA=="}')
        self.assertEqual(status, 503)
        self.assertNotIn('secret', json.dumps(data))

    def test_health_remains_responsive_while_inference_is_running(self):
        started, release = threading.Event(), threading.Event()
        def slow(_):
            started.set()
            release.wait(3)
            return 'AB'
        self.module.ocr._engine.classification.side_effect = slow
        errors = []
        def post_image():
            try:
                self.call('POST', '/', '{"image":"AA=="}')
            except Exception as error:
                errors.append(error)
        request = threading.Thread(target=post_image)
        request.start()
        try:
            self.assertTrue(started.wait(2))
            status, _, data = self.call('GET', '/health')
            self.assertEqual(status, 200)
            self.assertEqual(data['status'], 'ok')
        finally:
            release.set()
            request.join(3)
        self.assertFalse(errors)
        self.assertFalse(request.is_alive())

    def test_options_advertises_methods_with_empty_body(self):
        status, headers, data = self.call('OPTIONS', '/')
        self.assertEqual(status, 204)
        self.assertEqual(headers['Content-Length'], '0')
        self.assertIn('POST', headers['Access-Control-Allow-Methods'])
        self.assertIsNone(data)


    def test_script_starts_without_ocr_dependency_or_model_loading(self):
        import subprocess
        script = Path(__file__).resolve().parents[1] / 'ocr_server' / 'server.py'
        process = subprocess.Popen(
            [sys.executable, '-B', str(script), '--host', '127.0.0.1', '--port', '0'],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            line = process.stdout.readline().strip()
            self.assertIn('OCR server on 127.0.0.1:', line)
            port = int(line.rsplit(':', 1)[1])
            connection = HTTPConnection('127.0.0.1', port, timeout=3)
            try:
                connection.request('GET', '/health')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertFalse(json.loads(response.read())['modelLoaded'])
            finally:
                connection.close()
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()


if __name__ == '__main__':
    unittest.main()
