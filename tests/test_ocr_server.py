import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ocr_server'))

from unittest.mock import patch


class OcrServerTests(unittest.TestCase):
    def recognize(self, raw):
        engine = types.SimpleNamespace(classification=lambda _: raw)
        stub = types.SimpleNamespace(DdddOcr=lambda **_: engine)
        filename = Path(__file__).resolve().parents[1] / 'ocr_server' / 'server.py'
        spec = importlib.util.spec_from_file_location('offline_ocr_server', filename)
        server = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'ddddocr': stub}):
            spec.loader.exec_module(server)
        server.ocr._engine = engine
        handler = server.Handler.__new__(server.Handler)
        body = json.dumps({'image': 'AA=='}).encode()
        handler.path = '/'
        handler.headers = {'Content-Length': str(len(body))}
        handler.rfile = io.BytesIO(body)
        results = []
        handler.respond = lambda value, code=200: results.append((value, code))
        handler.do_POST()
        return results[0][0]

    def test_uppercase_multiplication_is_recognized(self):
        result = self.recognize('2X3=?')
        self.assertEqual(result['text'], '6')
        self.assertTrue(result['isMath'])

    def test_mixed_alphanumeric_captcha_is_not_truncated_to_arithmetic(self):
        result = self.recognize('2x3abc')
        self.assertEqual(result['text'], '2x3abc')
        self.assertFalse(result['isMath'])

    def test_subtraction_preserves_negative_answer(self):
        self.assertEqual(self.recognize('2-5=')['text'], '-3')


if __name__ == '__main__':
    unittest.main()
