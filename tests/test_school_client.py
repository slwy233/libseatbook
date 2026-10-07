"""Offline transport tests: responses are fixtures, never connect to school."""
import io
import json
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ocr_server'))
from school_client import SchoolClient, SchoolError, CONFIG_PATH, sign_headers


class FakeClock:
    def __init__(self):
        self.now = 100.0
        self.waits = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds


class SchoolClientTests(unittest.TestCase):
    def client(self, responses, **kwargs):
        def open_response(request, timeout):
            response = next(responses)
            if isinstance(response, Exception):
                raise response
            return io.BytesIO(response if isinstance(response, bytes) else json.dumps(response).encode())
        self.opener = Mock(side_effect=open_response)
        self.signer = Mock(side_effect=lambda info, method: {'x-request-id': str(self.signer.call_count)})
        self.clock = FakeClock()
        return SchoolClient('https://school.invalid/jsq', opener=self.opener,
                            signer=self.signer, clock=self.clock, sleep=self.clock.sleep, **kwargs)

    def config(self, key='one'):
        return {'status': True, 'data': {'hmac': 1, 'hmacKey': key}}

    def test_configuration_is_cached_and_refreshed_after_ttl(self):
        client = self.client(iter([self.config(), {'status': True},
                                   {'status': True}, self.config('two'), {'status': True}]), config_ttl=10)
        client.post('/static/frontApi/user/getUserInfo', token='token')
        self.clock.now += 5
        client.post('/static/frontApi/user/getUserInfo', token='token')
        self.clock.now += 6
        client.post('/static/frontApi/user/getUserInfo', token='token')
        configs = [call.args[0] for call in self.opener.call_args_list
                   if call.args[0].full_url.endswith(CONFIG_PATH)]
        self.assertEqual(len(configs), 2)
        self.assertEqual([call.args[0]['hmacKey'] for call in self.signer.call_args_list], ['one', 'one', 'two'])
        self.assertEqual(self.opener.call_args.kwargs['timeout'], 15)

    def test_failed_config_is_not_cached_or_replaced_with_static_key(self):
        client = self.client(iter([{'status': False}, self.config(), {'status': True}]))
        with self.assertRaises(SchoolError):
            client.post('/static/frontApi/user/getUserInfo')
        self.signer.assert_not_called()
        client.post('/static/frontApi/user/getUserInfo')
        self.signer.assert_called_once()

    def test_parallel_queries_only_fetch_configuration_once(self):
        config_started, release = threading.Event(), threading.Event()
        calls, errors = [], []
        def open_response(request, timeout):
            calls.append(request.full_url)
            if request.full_url.endswith(CONFIG_PATH):
                config_started.set()
                release.wait(3)
                return io.BytesIO(json.dumps(self.config()).encode())
            return io.BytesIO(b'{"status":true}')
        client = SchoolClient('https://school.invalid', opener=open_response, signer=lambda *_: {})
        def read():
            try:
                client.post('/static/frontApi/user/getUserInfo')
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=read) for _ in range(4)]
        for thread in threads:
            thread.start()
        self.assertTrue(config_started.wait(2))
        release.set()
        for thread in threads:
            thread.join(3)
        self.assertFalse(errors)
        self.assertTrue(all(not t.is_alive() for t in threads))
        self.assertEqual(sum(url.endswith(CONFIG_PATH) for url in calls), 1)

    def test_explicit_read_limit_retries_once_with_new_signature(self):
        limited = {'status': False, 'code': 500, 'message': '访问过于频繁 请稍后再试'}
        client = self.client(iter([self.config(), limited, limited]))
        self.assertEqual(client.post('/static/frontApi/user/getUserInfo'), limited)
        self.assertEqual(self.signer.call_count, 2)
        self.assertEqual(self.clock.waits, [2])
        headers = [call.args[0].get_header('X-request-id') for call in self.opener.call_args_list[1:]]
        self.assertEqual(headers, ['1', '2'])

    def test_http_429_only_retries_read_operation(self):
        error = HTTPError('https://school.invalid', 429, 'rate limited', {}, io.BytesIO())
        client = self.client(iter([self.config(), error, {'status': True}]))
        self.assertTrue(client.post('/static/frontApi/user/getUserInfo')['status'])
        self.assertEqual(self.clock.waits, [2])

    def test_booking_and_cancel_never_retry_even_when_limited(self):
        limited = {'status': False, 'code': 429, 'message': '访问过于频繁'}
        for endpoint in ('/static/frontApi/make/freeBook/1/2026-10-08/480/600?capToken=capToken',
                         '/static/frontApi/make/cancel/1'):
            with self.subTest(endpoint=endpoint):
                client = self.client(iter([self.config(), limited]))
                self.assertEqual(client.post(endpoint, token='token'), limited)
                self.assertEqual(self.signer.call_count, 1)
                self.assertFalse(self.clock.waits)

    def test_network_error_is_redacted_and_not_retried(self):
        client = self.client(iter([self.config(), URLError('private credentials here')]))
        with self.assertRaises(SchoolError) as raised:
            client.post('/static/frontApi/make/freeBook/1/2026-10-08/480/600')
        self.assertNotIn('private', str(raised.exception))
        self.assertEqual(self.signer.call_count, 1)

    def test_pacing_reserves_spacing_per_endpoint_and_account(self):
        client = self.client(iter([self.config()] + [{'status': True}] * 5))
        path = '/static/frontApi/res/freeSeatIdsDuration/1/2026-10-08'
        client.post(path, token='a')
        client.post(path, token='a')
        self.assertEqual(self.clock.waits, [2])
        client.post(path, token='b')
        client.post('/static/frontApi/res/querySeatLayout/1/1', token='a')
        self.assertEqual(self.clock.waits, [2])
        self.assertTrue(all(b'a' != key[1] for key in client._next_request))

    def test_invalid_or_oversized_upstream_json_is_rejected(self):
        for response in (b'not-json', b'[]', b'\xff', b'x' * 100):
            with self.subTest(response=response[:8]):
                client = self.client(iter([response]))
                client.max_response_bytes = 32
                with self.assertRaises(SchoolError):
                    client.post(CONFIG_PATH)

    def test_public_configuration_and_captcha_do_not_load_signing_key(self):
        client = self.client(iter([{'status': True}, {'status': True}]))
        client.post(CONFIG_PATH)
        client.post('/static/public/cg/generateCaptcha/test')
        self.signer.assert_not_called()
        self.assertEqual(self.opener.call_count, 2)

    def test_signatures_use_config_prefix_suffix_and_unique_protocol_nonce(self):
        cipher = Mock()
        cipher.decrypt.return_value = b'decrypted'
        aes = types.SimpleNamespace(MODE_CBC=2, new=Mock(return_value=cipher))
        unpad = Mock(return_value=b'secret')
        modules = {'Crypto': types.ModuleType('Crypto'),
                   'Crypto.Cipher': types.SimpleNamespace(AES=aes),
                   'Crypto.Util': types.ModuleType('Crypto.Util'),
                   'Crypto.Util.Padding': types.SimpleNamespace(unpad=unpad)}
        info = {'hmac': 1, 'makePrefix': '0123456789abcdef',
                'makeSuffix': 'fedcba9876543210', 'hmacKey': 'a2V5'}
        with patch.dict(sys.modules, modules):
            first, second = sign_headers(info, 'post'), sign_headers(info, 'POST')
        aes.new.assert_called_with(b'0123456789abcdef', 2, b'fedcba9876543210')
        self.assertNotEqual(first['x-request-id'], second['x-request-id'])
        self.assertEqual(len(first['x-request-id']), 36)
        self.assertEqual(first['x-request-id'][14], '4')
        self.assertIn(first['x-request-id'][19], '0123')
        import hashlib, hmac
        message = f"seat::{first['x-request-id']}::{first['x-request-date']}::POST"
        self.assertEqual(first['x-hmac-request-key'], hmac.new(b'secret', message.encode(), hashlib.sha256).hexdigest())


if __name__ == '__main__':
    unittest.main()
