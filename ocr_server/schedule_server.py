"""
定时预约服务 API + 执行引擎
运行: /opt/ocr_venv/bin/python3 /opt/schedule_server.py --port 8911
"""
import argparse, json, os, re, time, base64, uuid, threading, tempfile
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import quote
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from backend_runtime import ApiError, LazyOCR, captcha_result, decode_image, read_json_body, send_json
from school_client import SchoolClient, SchoolError

# ===== 配置 =====
HOST = '0.0.0.0'
PORT = 8911
SCHOOL_BASE = os.getenv('SCHOOL_BASE_URL', 'https://libseat.tjcu.edu.cn/jsq')
TASK_FILE = os.getenv('SCHEDULE_TASK_FILE', os.path.join(os.path.dirname(__file__), 'schedule_tasks.json'))
AES_KEY = b'server_date_time'
AES_IV = b'client_date_time'
ocr = LazyOCR()
TASK_LOCK = threading.RLock()
EXECUTION_LOCK = threading.Lock()
MAX_LOGIN_ATTEMPTS = 5
MAX_DAILY_ATTEMPTS = 3
RETRY_INTERVAL_SECONDS = 300
MAX_BODY_BYTES = 64 * 1024
SCHOOL_TIMEZONE = timezone(timedelta(hours=8))


def school_now():
    """学校按北京时间开放预约，不依赖部署机器的本地时区。"""
    return datetime.now(SCHOOL_TIMEZONE)

# ===== 加密工具 =====
def aes_encrypt(text):
    cipher = AES.new(AES_KEY, AES.MODE_CBC, AES_IV)
    return base64.b64encode(cipher.encrypt(pad(text.encode(), 16))).decode()

def aes_decrypt(cipher_text):
    cipher = AES.new(AES_KEY, AES.MODE_CBC, AES_IV)
    raw = unpad(cipher.decrypt(base64.b64decode(cipher_text)), 16)
    return raw.decode()

SCHOOL_CLIENT = SchoolClient(
    SCHOOL_BASE,
    timeout=float(os.getenv('SCHOOL_REQUEST_TIMEOUT', '15')),
    config_ttl=float(os.getenv('SCHOOL_CONFIG_TTL', '900')),
    min_interval=float(os.getenv('SCHOOL_QUERY_INTERVAL', '2')),
)


def school_post(path, data=None, token=None):
    return SCHOOL_CLIENT.post(path, data, token)


def ocr_captcha(b64_image):
    return captcha_result(ocr.classification(decode_image(b64_image)))['text']


# ===== 登录&预约 =====
class PermanentLoginError(RuntimeError):
    pass


def login(username_enc, password_enc):
    """Bound retries; stop immediately on explicit account/password rejection."""
    username = aes_decrypt(username_enc).strip()
    if not username:
        raise ValueError('预约账号不能为空')
    for attempt in range(MAX_LOGIN_ATTEMPTS):
        try:
            cap = school_post(f'/static/public/cg/generateCaptcha/{quote(username, safe="")}', {})
            if cap.get('status') is not True:
                raise SchoolError('学校验证码获取失败')
            data = cap.get('data')
            if not isinstance(data, dict):
                raise SchoolError('学校验证码响应格式错误')
            captcha_text = ocr_captcha(data['captchaText'])
            if captcha_text:
                resp = school_post('/static/public/auth/user', {
                    'username': username_enc, 'password': password_enc,
                    'sysCaptchaRes': {'captchaId': data['captchaId'], 'captchaText': captcha_text}
                })
                user = resp.get('data')
                if resp.get('status') is True and isinstance(user, dict) and user.get('token'):
                    return user['token'], f'{attempt+1}次OCR'
                if re.search(r'密码.{0,8}(错误|不正确)|账号.{0,8}(不存在|禁用|锁定)|用户不存在|账户已锁定',
                             str(resp.get('message', ''))):
                    raise PermanentLoginError('学校账号或密码被拒绝，请检查账号配置')
        except PermanentLoginError:
            raise
        except Exception:
            pass
        if attempt + 1 < MAX_LOGIN_ATTEMPTS:
            time.sleep(min(2 ** (attempt + 1), 8))
    raise RuntimeError(f'登录失败，已尝试{MAX_LOGIN_ATTEMPTS}次')


def read_for_account(account, token_cache, operation):
    """Refresh an expired session only for read operations, at most once."""
    response = operation(token_cache[account])
    if str(response.get('code')) == '20003':
        token_cache[account], _ = login(*account)
        response = operation(token_cache[account])
    if response.get('status') is not True:
        if '频繁' in str(response.get('message', '')) or str(response.get('code')) == '429':
            raise SchoolError('学校查询限流，已结束本轮尝试')
        if str(response.get('code')) in ('20002', '20003'):
            raise SchoolError('学校登录状态失效')
        raise SchoolError('学校只读查询失败，已跳过预约')
    return response


def book_seat(token, seat_id, date, start_min, end_min):
    return school_post(
        f'/static/frontApi/make/freeBook/{seat_id}/{date}/{start_min}/{end_min}?capToken=capToken',
        {}, token=token
    )

def get_free_seats(token, room_id, date, params=None):
    duration = {'beginMinute': -1, 'endMinute': 0, 'minMinute': 0}
    duration.update(params or {})
    return school_post(f'/static/frontApi/res/freeSeatIdsDuration/{room_id}/{date}', duration, token=token)

def get_current_make(token):
    return school_post('/static/frontApi/user/currentUseMake', {}, token=token)

def cancel_booking(token, booking_id):
    return school_post(f'/static/frontApi/make/cancel/{booking_id}', {}, token=token)

# ===== 任务存储 =====
def load_tasks():
    with TASK_LOCK:
        if not os.path.exists(TASK_FILE): return []
        with open(TASK_FILE, 'r', encoding='utf-8') as f:
            tasks = json.load(f)
        if not isinstance(tasks, list) or any(not isinstance(t, dict) for t in tasks):
            raise ValueError('任务存储格式错误')
        return tasks

def save_tasks(tasks):
    """先写同目录临时文件，完成后原子替换；调用方锁住整个读改写操作。"""
    with TASK_LOCK:
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8',
                                             dir=os.path.dirname(os.path.abspath(TASK_FILE)),
                                             prefix='.schedule-', suffix='.tmp', delete=False) as f:
                temporary_path = f.name
                os.chmod(temporary_path, 0o600)
                json.dump(tasks, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary_path, TASK_FILE)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)


def validate_task(task):
    for key in ('dateFrom', 'dateTo'):
        value = task.get(key)
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ApiError(f'{key} 必须为 YYYY-MM-DD 日期')
        try:
            datetime.strptime(value, '%Y-%m-%d')
        except ValueError:
            raise ApiError(f'{key} 日期无效')
    if task['dateFrom'] > task['dateTo']:
        raise ApiError('结束日期必须不早于开始日期')
    start, end = task.get('startMinute'), task.get('endMinute')
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= 1440:
        raise ApiError('预约分钟必须为整数，且满足 0 <= 开始 < 结束 <= 1440')
    room = task.get('roomId')
    if (isinstance(room, bool) or not isinstance(room, (str, int)) or len(str(room)) > 128
            or not re.fullmatch(r'[A-Za-z0-9_-]+', str(room))):
        raise ApiError('roomId 无效')
    if isinstance(room, int) and room <= 0:
        raise ApiError('roomId 无效')
    for key in ('encryptedUsername', 'encryptedPassword'):
        value = task.get(key)
        try:
            if not isinstance(value, str) or not value or len(value) > 4096:
                raise ValueError()
            raw = base64.b64decode(value, validate=True)
            if not raw or len(raw) % 16:
                raise ValueError()
        except (ValueError, TypeError):
            raise ApiError(f'{key} 必须为有效加密字符串')
    prefs = task.get('preferredSeats', [])
    if not isinstance(prefs, list) or len(prefs) > 100 or any(
            not isinstance(s, str) or not s.strip() or len(s) > 64 for s in prefs):
        raise ApiError('preferredSeats 必须为非空座位名称数组')
    if 'enabled' in task and type(task['enabled']) is not bool:
        raise ApiError('enabled 必须为布尔值')
    for key in ('buildingName', 'roomName', 'startTime', 'endTime'):
        if key in task and (not isinstance(task[key], str) or len(task[key]) > 200):
            raise ApiError(f'{key} 必须为字符串，长度不超过200')


def public_task(task):
    return {k: v for k, v in task.items() if k not in
            ('encryptedUsername', 'encryptedPassword', '_attempts')}


def task_configuration(task):
    return {k: v for k, v in task.items() if k not in ('results', '_attempts')}


def save_result(task_id, today, result):
    # 重新加载，只合并执行结果，保留期间新增、删除和修改的任务。
    with TASK_LOCK:
        tasks = load_tasks()
        for current in tasks:
            if current.get('id') == task_id:
                current.setdefault('results', {})[today] = result
                save_tasks(tasks)
                break

# ===== 任务执行引擎 =====
def execute_scheduled_tasks():
    if not EXECUTION_LOCK.acquire(blocking=False):
        return False
    try:
        _execute_scheduled_tasks()
        return True
    finally:
        EXECUTION_LOCK.release()


def _execute_scheduled_tasks():
    with TASK_LOCK:
        task_ids = [t.get('id') for t in load_tasks()]
    today = school_now().strftime('%Y-%m-%d')
    token_cache = {}
    for task_id in task_ids:
        with TASK_LOCK:
            tasks = load_tasks()
            task = next((t for t in tasks if t.get('id') == task_id), None)
            if not task or not task.get('enabled'): continue
            try:
                validate_task(task)
            except ApiError as e:
                task.setdefault('results', {})[today] = f'❌ 配置无效: {e}'
                save_tasks(tasks)
                continue
            if not (task['dateFrom'] <= today <= task['dateTo']): continue
            if task.setdefault('results', {}).get(today, '').startswith(('✅', '⚠️')):
                continue
            attempts = task.setdefault('_attempts', {}).get(today, {})
            if attempts.get('count', 0) >= MAX_DAILY_ATTEMPTS:
                continue
            if attempts and time.time() - attempts.get('lastAt', 0) < RETRY_INTERVAL_SECONDS:
                continue
            task['_attempts'][today] = {'count': attempts.get('count', 0) + 1, 'lastAt': time.time()}
            save_tasks(tasks)
            configuration = task_configuration(task)
        try:
            account = (task['encryptedUsername'], task['encryptedPassword'])
            if account not in token_cache:
                token_cache[account], _ = login(*account)
            cur = read_for_account(account, token_cache, get_current_make)
            token = token_cache[account]
            if not cur.get('status'):
                raise RuntimeError('无法确认当前预约，跳过预约')
            if cur.get('data') and not isinstance(cur['data'], dict):
                raise SchoolError('学校当前预约响应格式错误')
            if cur.get('data') and cur['data'].get('id'):
                save_result(task_id, today, '⚠️ 已有预约，保留现有预约')
                continue
            seats_resp = read_for_account(account, token_cache, lambda current_token:
                get_free_seats(current_token, task['roomId'], today, {
                    'beginMinute': task['startMinute'], 'endMinute': task['endMinute'], 'minMinute': 0,
                }))
            token = token_cache[account]
            seat_data = seats_resp.get('data')
            if not isinstance(seat_data, dict):
                raise SchoolError('学校空闲座位响应格式错误')
            free_seats = {k: v for k, v in seat_data.items()
                          if isinstance(v, dict) and v.get('status') == 'FREE'
                          and v.get('id') and v.get('label') is not None}
            if not free_seats:
                save_result(task_id, today, '❌ 房间无空闲座位')
                continue
            prefs = task.get('preferredSeats', [])
            chosen = None
            picked_name = ''
            # 按用户给出的偏好顺序选择，而非服务器返回座位的顺序。
            for preferred in prefs:
                for s in free_seats.values():
                    if str(s['label']) == preferred.strip():
                        chosen = s
                        picked_name = f'{s["label"]}号'
                        break
                if chosen:
                    break
            if not chosen:
                chosen = list(free_seats.values())[0]
                picked_name = f'{chosen["label"]}号'
                if prefs:
                    picked_name = f'偏好座位已被他人占用，改选 {chosen["label"]}号'
            with TASK_LOCK:
                current = next((t for t in load_tasks() if t.get('id') == task_id), None)
                if not current or task_configuration(current) != configuration:
                    continue
            book_resp = book_seat(token, chosen['id'], today,
                                   task['startMinute'], task['endMinute'])
            if book_resp.get('status'):
                result = f'✅ {picked_name}'
            else:
                result = f'❌ 预约失败: {str(book_resp.get("message", "未知"))[:100]}'
            save_result(task_id, today, result)
        except SchoolError as e:
            save_result(task_id, today, f'❌ {e}')
        except Exception as e:
            # 不把可能包含凭据的远端异常原文写入对外可读的结果。
            print(f'[Scheduler] task {task_id}: {type(e).__name__}')
            save_result(task_id, today, '❌ 执行异常，请检查服务日志或账号配置')

def scheduler_loop():
    """每分钟检查一次"""
    while True:
        now = school_now()
        if now.hour >= 5:  # 5点后才检查
            try:
                execute_scheduled_tasks()
            except Exception as e:
                print(f'[Scheduler] error: {type(e).__name__}')
        time.sleep(60)

# ===== REST API =====
class Handler(BaseHTTPRequestHandler):
    timeout = 15

    def log_message(self, fmt, *args): pass

    def _send(self, data, code=200):
        send_json(self, data, code)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _run(self, action):
        try:
            action()
        except ApiError as e:
            self._send({'status': False, 'error': str(e), 'message': str(e)}, e.code)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._send({'status': False, 'error': 'internal error', 'message': '服务内部错误'}, 500)

    def _read_body(self):
        return read_json_body(self, MAX_BODY_BYTES)

    def _task_id(self):
        match = re.fullmatch(r'/api/schedules/([A-Za-z0-9_-]+)', self.path)
        if not match or match.group(1) == 'execute':
            raise ApiError('not found', 404)
        return match.group(1)

    def do_GET(self):
        self._run(self._get)

    def _get(self):
        if self.path == '/health':
            self._send({'status': 'ok'})
        elif self.path == '/api/schedules':
            tasks = [public_task(t) for t in load_tasks()]
            self._send({'status': True, 'data': tasks})
        else:
            raise ApiError('not found', 404)

    def do_POST(self):
        self._run(self._post)

    def _post(self):
        if self.path not in ('/api/schedules', '/api/schedules/execute'):
            raise ApiError('not found', 404)
        body = self._read_body()
        if self.path == '/api/schedules':
            validate_task(body)
            task = {
                'id': uuid.uuid4().hex,
                'enabled': body.get('enabled', True),
                'dateFrom': body['dateFrom'],
                'dateTo': body['dateTo'],
                'buildingName': body.get('buildingName', '图书馆'),
                'roomName': body.get('roomName', ''),
                'roomId': body['roomId'],
                'startMinute': body['startMinute'],
                'endMinute': body['endMinute'],
                'startTime': body.get('startTime', ''),
                'endTime': body.get('endTime', ''),
                'preferredSeats': body.get('preferredSeats', []),
                'encryptedUsername': body['encryptedUsername'],
                'encryptedPassword': body['encryptedPassword'],
                'createdAt': school_now().isoformat(),
                'results': {},
            }
            with TASK_LOCK:
                tasks = load_tasks()
                tasks.append(task)
                save_tasks(tasks)
            self._send({'status': True, 'data': public_task(task)})

        elif self.path == '/api/schedules/execute':
            if not execute_scheduled_tasks():
                raise ApiError('任务正在执行，请稍后重试', 409)
            self._send({'status': True, 'message': '执行完成'})

    def do_DELETE(self):
        self._run(self._delete)

    def _delete(self):
        task_id = self._task_id()
        with TASK_LOCK:
            tasks = load_tasks()
            remaining = [t for t in tasks if t.get('id') != task_id]
            if len(remaining) == len(tasks):
                raise ApiError('not found', 404)
            save_tasks(remaining)
        self._send({'status': True})

    def do_PATCH(self):
        self._run(self._patch)

    def _patch(self):
        task_id = self._task_id()
        body = self._read_body()
        if not body or set(body) - {'enabled', 'dateFrom', 'dateTo', 'preferredSeats'}:
            raise ApiError('PATCH 只支持 enabled、dateFrom、dateTo、preferredSeats')
        with TASK_LOCK:
            tasks = load_tasks()
            for task in tasks:
                if task.get('id') == task_id:
                    updated = {**task, **body}
                    validate_task(updated)
                    task.update(body)
                    save_tasks(tasks)
                    self._send({'status': True})
                    return
        raise ApiError('not found', 404)

def main(argv=None):
    global TASK_FILE
    parser = argparse.ArgumentParser(description='学校定时预约服务')
    parser.add_argument('--host', default=os.getenv('SCHEDULE_HOST', HOST))
    parser.add_argument('--port', type=int, default=int(os.getenv('SCHEDULE_PORT', str(PORT))))
    parser.add_argument('--task-file', default=TASK_FILE)
    parser.add_argument('--no-scheduler', action='store_true', help='仅启动 API，关闭自动预约')
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('port 必须为 0 至 65535')
    TASK_FILE = os.path.abspath(args.task_file)
    os.makedirs(os.path.dirname(TASK_FILE), exist_ok=True)
    # Fail visibly on corrupt storage before starting a scheduler or serving CRUD.
    load_tasks()
    with ThreadingHTTPServer((args.host, args.port), Handler) as service:
        print(f'Schedule server on {args.host}:{service.server_port}', flush=True)
        if not args.no_scheduler:
            threading.Thread(target=scheduler_loop, daemon=True).start()
        try:
            service.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
