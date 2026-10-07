"""Offline scheduler regression tests; no school API, OCR runtime or credentials needed."""
import base64
from datetime import datetime, timezone
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ocr_server'))

from unittest.mock import Mock, patch


# Import the service with isolated optional dependency stubs; never run real OCR/AES.
_stubs = {
    'Crypto': types.ModuleType('Crypto'),
    'Crypto.Cipher': types.ModuleType('Crypto.Cipher'),
    'Crypto.Util': types.ModuleType('Crypto.Util'),
    'Crypto.Util.Padding': types.ModuleType('Crypto.Util.Padding'),
    'ddddocr': types.ModuleType('ddddocr'),
}
_stubs['Crypto.Cipher'].AES = Mock()
_stubs['Crypto.Util.Padding'].pad = Mock()
_stubs['Crypto.Util.Padding'].unpad = Mock()
_stubs['ddddocr'].DdddOcr = Mock()
_spec = importlib.util.spec_from_file_location(
    'schedule_server_under_test', Path(__file__).resolve().parents[1] / 'ocr_server' / 'schedule_server.py')
server = importlib.util.module_from_spec(_spec)
with patch.dict(sys.modules, _stubs):
    _spec.loader.exec_module(server)


class ScheduleServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(self.directory.cleanup)
        self.start_patch('TASK_FILE', str(Path(self.directory.name) / 'tasks.json'))
        self.start_patch('school_post', side_effect=AssertionError('Unexpected upstream request'))
        self.today = server.school_now().strftime('%Y-%m-%d')
        self.credentials = base64.b64encode(b'a' * 16).decode()

    def start_patch(self, name, *args, **kwargs):
        replacement = patch.object(server, name, *args, **kwargs)
        self.addCleanup(replacement.stop)
        return replacement.start()

    def task(self, task_id='one', **changes):
        return {
            'id': task_id, 'enabled': True, 'dateFrom': self.today, 'dateTo': self.today,
            'roomId': 'room1', 'startMinute': 480, 'endMinute': 600,
            'encryptedUsername': self.credentials, 'encryptedPassword': self.credentials,
            'preferredSeats': [], 'results': {}, **changes,
        }

    def handler(self, method, path, body=None, raw=None, headers=None):
        handler = server.Handler.__new__(server.Handler)
        payload = raw if raw is not None else (json.dumps(body).encode() if body is not None else b'')
        handler.path = path
        handler.headers = headers if headers is not None else {'Content-Length': str(len(payload))}
        handler.rfile = io.BytesIO(payload)
        handler._send = Mock()
        getattr(handler, 'do_' + method)()
        return handler

    def mock_booking(self):
        login = self.start_patch('login', side_effect=lambda username, password: ('token-' + username, '1次OCR'))
        self.start_patch('get_current_make', return_value={'status': True, 'data': None})
        self.start_patch('get_free_seats', return_value={'status': True, 'data': {
            'first': {'id': 'seat1', 'label': '1', 'status': 'FREE'},
            'second': {'id': 'seat2', 'label': '2', 'status': 'FREE'},
        }})
        book = self.start_patch('book_seat', return_value={'status': True})
        return login, book

    def test_accounts_have_separate_tokens_and_same_credentials_share_token(self):
        other = base64.b64encode(b'b' * 16).decode()
        server.save_tasks([self.task(), self.task('two', encryptedUsername=other), self.task('three')])
        login, book = self.mock_booking()
        self.assertTrue(server.execute_scheduled_tasks())
        self.assertEqual(login.call_count, 2)
        self.assertEqual([c.args[0] for c in book.call_args_list],
                         ['token-' + self.credentials, 'token-' + other, 'token-' + self.credentials])

    def test_captcha_uses_decrypted_current_username(self):
        self.start_patch('aes_decrypt', return_value='user/42')
        self.start_patch('ocr_captcha', return_value='7')
        self.start_patch('time', wraps=server.time)
        with patch.object(server.time, 'sleep'):
            server.school_post.side_effect = [
                {'status': True, 'data': {'captchaId': 'cid', 'captchaText': 'image'}},
                {'status': True, 'data': {'token': 'mine'}},
            ]
            self.assertEqual(server.login('encrypted-user', 'encrypted-password')[0], 'mine')
        self.assertEqual(server.school_post.call_args_list[0].args[0],
                         '/static/public/cg/generateCaptcha/user%2F42')

    def test_login_attempts_are_bounded(self):
        self.start_patch('aes_decrypt', return_value='student')
        server.school_post.side_effect = RuntimeError('offline')
        with patch.object(server.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '5'):
                server.login('user', 'password')
        self.assertEqual(server.school_post.call_count, server.MAX_LOGIN_ATTEMPTS)

    def test_ocr_requires_full_arithmetic_expression_and_accepts_uppercase_x(self):
        for raw, expected in [('2x3abc', '2x3abc'), ('2X3=?', '6'), ('7 × 2', '14'),
                              ('9÷3=', '3'), ('-2+3?', '1'), ('3+4letters', '34letters')]:
            with self.subTest(raw=raw):
                with patch.object(server.ocr, 'classification', return_value=raw):
                    self.assertEqual(server.ocr_captcha(base64.b64encode(b'image').decode()), expected)

    def test_school_dates_and_creation_timestamp_ignore_utc_host_timezone(self):
        # UTC host is still October 6; school is October 7 at 06:00.
        utc_now = datetime(2026, 10, 6, 22, tzinfo=timezone.utc)
        with patch.object(server, 'datetime', wraps=datetime) as clock:
            clock.now.side_effect = lambda tz=None: (utc_now.astimezone(tz) if tz
                                                    else utc_now.replace(tzinfo=None))
            task = self.task(dateFrom='2026-10-07', dateTo='2026-10-07')
            server.save_tasks([task])
            _, book = self.mock_booking()
            server.execute_scheduled_tasks()
            self.assertEqual(book.call_args.args[2], '2026-10-07')
            self.assertIn('2026-10-07', server.load_tasks()[0]['results'])
            created = self.handler('POST', '/api/schedules', task)._send.call_args.args[0]['data']
            self.assertEqual(created['createdAt'], '2026-10-07T06:00:00+08:00')
            self.assertTrue(all(call.args == (server.SCHOOL_TIMEZONE,) for call in clock.now.call_args_list))

    def test_scheduler_checks_beijing_hour_on_non_china_host(self):
        # UTC host is at 18:00, but school is at 02:00: automatic execution must wait.
        utc_now = datetime(2026, 10, 6, 18, tzinfo=timezone.utc)
        with patch.object(server, 'datetime', wraps=datetime) as clock:
            clock.now.side_effect = lambda tz=None: (utc_now.astimezone(tz) if tz
                                                    else utc_now.replace(tzinfo=None))
            execute = self.start_patch('execute_scheduled_tasks')
            with patch.object(server.time, 'sleep', side_effect=StopIteration):
                with self.assertRaises(StopIteration):
                    server.scheduler_loop()
            execute.assert_not_called()
            utc_now = datetime(2026, 10, 6, 21, tzinfo=timezone.utc)
            with patch.object(server.time, 'sleep', side_effect=StopIteration):
                with self.assertRaises(StopIteration):
                    server.scheduler_loop()
            execute.assert_called_once()

    def test_existing_booking_is_preserved(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        server.get_current_make.return_value = {'status': True, 'data': {'id': 'existing'}}
        cancel = self.start_patch('cancel_booking')
        server.execute_scheduled_tasks()
        cancel.assert_not_called()
        server.book_seat.assert_not_called()
        self.assertTrue(server.load_tasks()[0]['results'][self.today].startswith('⚠️'))

    def test_unknown_current_booking_does_not_book(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        server.get_current_make.return_value = {'status': False}
        server.execute_scheduled_tasks()
        server.book_seat.assert_not_called()
        self.assertTrue(server.load_tasks()[0]['results'][self.today].startswith('❌'))

    def test_missing_results_are_persisted_and_success_is_not_repeated(self):
        task = self.task()
        del task['results']
        server.save_tasks([task])
        _, book = self.mock_booking()
        server.execute_scheduled_tasks()
        server.execute_scheduled_tasks()
        self.assertTrue(server.load_tasks()[0]['results'][self.today].startswith('✅'))
        self.assertEqual(book.call_count, 1)

    def test_preference_order_wins_over_free_seat_response_order(self):
        server.save_tasks([self.task(preferredSeats=['2', '1'])])
        _, book = self.mock_booking()
        server.execute_scheduled_tasks()
        self.assertEqual(book.call_args.args[1], 'seat2')

    def test_free_seats_request_uses_scheduled_duration(self):
        duration = {'beginMinute': 480, 'endMinute': 600, 'minMinute': 0}
        server.school_post.side_effect = None
        server.get_free_seats('token', 'room1', self.today, duration)
        server.school_post.assert_called_once_with(
            f'/static/frontApi/res/freeSeatIdsDuration/room1/{self.today}', duration, token='token')
        server.save_tasks([self.task()])
        self.mock_booking()
        server.execute_scheduled_tasks()
        server.get_free_seats.assert_called_once_with(
            'token-' + self.credentials, 'room1', self.today, duration)

    def test_result_merge_preserves_new_task_and_patch(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        def book_and_edit(*args):
            self.handler('PATCH', '/api/schedules/one', {'preferredSeats': ['2']})
            self.handler('POST', '/api/schedules', self.task('new'))
            return {'status': True}
        server.book_seat.side_effect = book_and_edit
        server.execute_scheduled_tasks()
        tasks = server.load_tasks()
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0]['preferredSeats'], ['2'])
        self.assertTrue(tasks[0]['results'][self.today].startswith('✅'))

    def test_deleted_task_is_not_resurrected_by_result_merge(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        def book_and_delete(*args):
            self.handler('DELETE', '/api/schedules/one')
            return {'status': True}
        server.book_seat.side_effect = book_and_delete
        server.execute_scheduled_tasks()
        self.assertEqual(server.load_tasks(), [])

    def test_disabled_task_is_rechecked_before_booking(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        seats = server.get_free_seats.return_value
        def seats_and_pause(*args):
            self.handler('PATCH', '/api/schedules/one', {'enabled': False})
            return seats
        server.get_free_seats.side_effect = seats_and_pause
        server.execute_scheduled_tasks()
        server.book_seat.assert_not_called()
        self.assertFalse(server.load_tasks()[0]['enabled'])

    def test_concurrent_execution_is_rejected(self):
        started, finish = threading.Event(), threading.Event()
        def execute_once():
            started.set()
            finish.wait(5)
        self.start_patch('_execute_scheduled_tasks', side_effect=execute_once)
        worker = threading.Thread(target=server.execute_scheduled_tasks)
        worker.start()
        try:
            self.assertTrue(started.wait(2))
            self.assertFalse(server.execute_scheduled_tasks())
            handler = self.handler('POST', '/api/schedules/execute')
            self.assertEqual(handler._send.call_args.args[1], 409)
        finally:
            finish.set()
            worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertTrue(server.execute_scheduled_tasks())

    def test_failed_attempts_have_cooldown_and_persisted_daily_limit(self):
        server.save_tasks([self.task()])
        login = self.start_patch('login', side_effect=RuntimeError('secret'))
        with patch.object(server.time, 'time', return_value=1000):
            server.execute_scheduled_tasks()
            server.execute_scheduled_tasks()
        self.assertEqual(login.call_count, 1)
        for timestamp in (1300, 1600, 1900):
            with patch.object(server.time, 'time', return_value=timestamp):
                server.execute_scheduled_tasks()
        self.assertEqual(login.call_count, server.MAX_DAILY_ATTEMPTS)
        self.assertEqual(server.load_tasks()[0]['_attempts'][self.today]['count'], 3)
        self.assertNotIn('secret', server.load_tasks()[0]['results'][self.today])

    def test_atomic_replace_failure_preserves_previous_file(self):
        server.save_tasks([self.task()])
        previous = Path(server.TASK_FILE).read_bytes()
        with patch.object(server.os, 'replace', side_effect=OSError('disk failure')):
            with self.assertRaises(OSError):
                server.save_tasks([])
        self.assertEqual(Path(server.TASK_FILE).read_bytes(), previous)
        self.assertEqual(list(Path(self.directory.name).glob('.schedule-*.tmp')), [])

    def test_create_and_get_redact_credentials_and_internal_attempts(self):
        created = self.handler('POST', '/api/schedules', self.task())
        public = created._send.call_args.args[0]['data']
        self.assertNotIn('encryptedUsername', public)
        self.assertNotIn('encryptedPassword', public)
        stored = server.load_tasks()[0]
        self.assertEqual(stored['encryptedUsername'], self.credentials)
        stored['_attempts'] = {self.today: {'count': 1}}
        server.save_tasks([stored])
        listed = self.handler('GET', '/api/schedules')._send.call_args.args[0]['data'][0]
        self.assertNotIn('_attempts', listed)
        self.assertNotIn('encryptedUsername', listed)

    def test_invalid_create_values_return_400_without_writing(self):
        cases = [
            {'dateFrom': '2026-02-30'}, {'dateFrom': '2026-9-1'}, {'dateTo': '2000-01-01'},
            {'startMinute': True}, {'startMinute': '480'}, {'endMinute': 480}, {'endMinute': 1441},
            {'roomId': '../room'}, {'roomId': False}, {'encryptedUsername': ''},
            {'encryptedPassword': 'not-ciphertext'}, {'preferredSeats': '1,2'},
            {'preferredSeats': [1]}, {'enabled': 'true'},
        ]
        for values in cases:
            with self.subTest(values=values):
                handler = self.handler('POST', '/api/schedules', self.task(**values))
                self.assertEqual(handler._send.call_args.args[1], 400)
                self.assertFalse(handler._send.call_args.args[0]['status'])
        self.assertEqual(server.load_tasks(), [])

    def test_invalid_json_lengths_and_non_object_return_errors(self):
        for raw in (b'{', b'[]', b'null', b'"text"', b'\xff'):
            with self.subTest(raw=raw):
                self.assertEqual(self.handler('POST', '/api/schedules', raw=raw)._send.call_args.args[1], 400)
        for length, expected in [('bad', 400), ('-1', 400), (str(server.MAX_BODY_BYTES + 1), 413)]:
            handler = self.handler('POST', '/api/schedules', headers={'Content-Length': length})
            self.assertEqual(handler._send.call_args.args[1], expected)
        short = self.handler('POST', '/api/schedules', raw=b'{}', headers={'Content-Length': '5'})
        self.assertEqual(short._send.call_args.args[1], 400)

    def test_body_read_timeout_returns_408(self):
        handler = server.Handler.__new__(server.Handler)
        handler.path = '/api/schedules'
        handler.headers = {'Content-Length': '10'}
        handler.rfile = Mock()
        handler.rfile.read.side_effect = TimeoutError()
        handler._send = Mock()
        handler.do_POST()
        self.assertEqual(handler._send.call_args.args[1], 408)

    def test_patch_validates_merged_date_range_and_enabled(self):
        server.save_tasks([self.task()])
        for body in ({'enabled': 'false'}, {'dateTo': '2000-01-01'}, {'unknown': 1}, {}):
            with self.subTest(body=body):
                self.assertEqual(self.handler('PATCH', '/api/schedules/one', body)._send.call_args.args[1], 400)
        self.assertTrue(server.load_tasks()[0]['enabled'])
        self.assertTrue(self.handler('PATCH', '/api/schedules/one', {'enabled': False})._send.call_args.args[0]['status'])

    def test_unknown_delete_and_patch_routes_return_404_without_mutation(self):
        server.save_tasks([self.task()])
        for method, path in [('DELETE', '/unrelated'), ('DELETE', '/api/schedules/missing'),
                             ('PATCH', '/api/schedules/one/extra'), ('DELETE', '/api/schedules/execute')]:
            with self.subTest(method=method, path=path):
                handler = self.handler(method, path, {'enabled': False})
                self.assertEqual(handler._send.call_args.args[1], 404)
        self.assertEqual(len(server.load_tasks()), 1)

    def test_storage_error_returns_json_500_without_exception_details(self):
        Path(server.TASK_FILE).write_text('{broken', encoding='utf-8')
        handler = self.handler('GET', '/api/schedules')
        self.assertEqual(handler._send.call_args.args[1], 500)
        self.assertFalse(handler._send.call_args.args[0]['status'])
        self.assertNotIn('broken', str(handler._send.call_args.args[0]))

    def test_patch_is_advertised_by_cors(self):
        handler = server.Handler.__new__(server.Handler)
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.do_OPTIONS()
        methods = next(c.args[1] for c in handler.send_header.call_args_list
                       if c.args[0] == 'Access-Control-Allow-Methods')
        self.assertIn('PATCH', methods.split(','))


    def test_expired_read_session_relogs_once_before_booking(self):
        for code in (20003, '20003'):
            with self.subTest(code=code):
                server.save_tasks([self.task()])
                self.mock_booking()
                server.login.side_effect = [('old', 'ok'), ('new', 'ok')]
                server.get_current_make.side_effect = [
                    {'status': False, 'code': code},
                    {'status': True, 'data': None},
                ]
                server.execute_scheduled_tasks()
                self.assertEqual(server.login.call_count, 2)
                self.assertEqual([call.args[0] for call in server.get_current_make.call_args_list], ['old', 'new'])
                self.assertEqual(server.get_free_seats.call_args.args[0], 'new')
                self.assertEqual(server.book_seat.call_args.args[0], 'new')

    def test_second_expired_read_rejection_stops_without_booking(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        server.get_current_make.return_value = {'status': False, 'code': 20003}
        server.execute_scheduled_tasks()
        self.assertEqual(server.login.call_count, 2)
        self.assertEqual(server.get_current_make.call_count, 2)
        server.book_seat.assert_not_called()
        self.assertIn('登录状态失效', server.load_tasks()[0]['results'][self.today])

    def test_expired_free_seat_query_uses_refreshed_token_for_booking(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        seats = server.get_free_seats.return_value
        server.get_free_seats.side_effect = [{'status': False, 'code': '20003'}, seats]
        server.login.side_effect = [('old', 'ok'), ('new', 'ok')]
        server.execute_scheduled_tasks()
        self.assertEqual(server.login.call_count, 2)
        self.assertEqual([call.args[0] for call in server.get_free_seats.call_args_list], ['old', 'new'])
        self.assertEqual(server.book_seat.call_args.args[0], 'new')

    def test_permanent_login_error_does_not_retry_or_sleep(self):
        self.start_patch('aes_decrypt', return_value='student')
        self.start_patch('ocr_captcha', return_value='AB')
        server.school_post.side_effect = [
            {'status': True, 'data': {'captchaId': 'id', 'captchaText': 'image'}},
            {'status': False, 'message': '密码错误'},
        ]
        with patch.object(server.time, 'sleep') as sleep:
            with self.assertRaises(server.PermanentLoginError):
                server.login('user', 'password')
            sleep.assert_not_called()
        self.assertEqual(server.school_post.call_count, 2)

    def test_explicitly_paused_new_task_stays_paused(self):
        response = self.handler('POST', '/api/schedules', self.task(enabled=False))
        self.assertFalse(response._send.call_args.args[0]['data']['enabled'])
        self.assertFalse(server.load_tasks()[0]['enabled'])

    def test_rate_limit_is_distinct_from_empty_seat_inventory(self):
        server.save_tasks([self.task()])
        self.mock_booking()
        server.get_free_seats.return_value = {'status': False, 'code': 500, 'message': '访问过于频繁'}
        server.execute_scheduled_tasks()
        server.book_seat.assert_not_called()
        self.assertIn('限流', server.load_tasks()[0]['results'][self.today])

    def test_empty_and_malformed_seat_inventory_never_book(self):
        for data, expected in [({}, '无空闲座位'), ([], '响应格式错误')]:
            with self.subTest(data=data):
                server.save_tasks([self.task()])
                self.mock_booking()
                server.get_free_seats.return_value = {'status': True, 'data': data}
                server.execute_scheduled_tasks()
                server.book_seat.assert_not_called()
                self.assertIn(expected, server.load_tasks()[0]['results'][self.today])

    def test_cli_can_disable_scheduler_and_use_an_isolated_task_file(self):
        service = Mock()
        service.server_port = 0
        service.serve_forever.side_effect = KeyboardInterrupt
        with patch.object(server, 'ThreadingHTTPServer') as httpd, patch.object(server.threading, 'Thread') as thread:
            httpd.return_value.__enter__.return_value = service
            server.main(['--host', '127.0.0.1', '--port', '0', '--task-file', server.TASK_FILE, '--no-scheduler'])
            thread.assert_not_called()
            httpd.assert_called_once_with(('127.0.0.1', 0), server.Handler)
            service.serve_forever.assert_called_once()



if __name__ == '__main__':
    unittest.main()
