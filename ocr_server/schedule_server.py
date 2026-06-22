"""
定时预约服务 API + 执行引擎
运行: /opt/ocr_venv/bin/python3 /opt/schedule_server.py --port 8911
"""
import json, os, re, sys, time, hashlib, hmac, base64, uuid, random, threading
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
import ddddocr

# ===== 配置 =====
HOST = '0.0.0.0'
PORT = 8911
SCHOOL_BASE = 'https://libseat.tjcu.edu.cn/jsq'
TASK_FILE = '/opt/schedule_tasks.json'
HMAC_KEY = 'fkJlSwDn467GnoE4nWHNlg=='
AES_KEY = b'server_date_time'
AES_IV = b'client_date_time'
ocr = ddddocr.DdddOcr(show_ad=False)

# ===== 加密工具 =====
def aes_encrypt(text):
    cipher = AES.new(AES_KEY, AES.MODE_CBC, AES_IV)
    return base64.b64encode(cipher.encrypt(pad(text.encode(), 16))).decode()

def aes_decrypt(cipher_text):
    cipher = AES.new(AES_KEY, AES.MODE_CBC, AES_IV)
    raw = unpad(cipher.decrypt(base64.b64decode(cipher_text)), 16)
    return raw.decode()

def gen_nonce():
    chars = '0123456789abcdef'
    r = [chars[random.randint(0, 15)] for _ in range(36)]
    r[14] = '4'; r[19] = chars[random.randint(0, 3)]
    return ''.join(r)

def hmac_key_real():
    return aes_decrypt(HMAC_KEY)

def make_hmac_headers(method='POST'):
    rid = gen_nonce()
    date = str(int(time.time() * 1000))
    sign_str = f'seat::{rid}::{date}::{method.upper()}'
    sig = hmac.new(hmac_key_real().encode(), sign_str.encode(), hashlib.sha256).hexdigest()
    return {'x-request-id': rid, 'x-request-date': date, 'x-hmac-request-key': sig}

def school_post(path, data=None, token=None):
    url = f'{SCHOOL_BASE}{path}'
    headers = {'Content-Type': 'application/json', 'logintype': 'PC'}
    headers.update(make_hmac_headers('POST'))
    if token:
        headers['token'] = token
    body = json.dumps(data or {}).encode()
    req = Request(url, data=body, headers=headers, method='POST')
    return json.loads(urlopen(req, timeout=15).read())

def ocr_captcha(b64_image):
    if ',' in b64_image:
        b64_image = b64_image.split(',')[1]
    raw = ocr.classification(base64.b64decode(b64_image)).strip()
    clean = raw.replace(' ', '').replace('?', '').replace('=', '')
    if re.search(r'[+\-*x×÷/]', clean):
        expr = clean.replace('x', '*').replace('×', '*').replace('÷', '/')
        m = re.match(r'(-?\d+)([+\-*/])(-?\d+)', expr)
        if m:
            a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
            return str({'/':a//b if b else 0,'*':a*b,'+':a+b,'-':a-b}[op])
    return re.sub(r'[^a-zA-Z0-9]', '', raw)

# ===== 登录&预约 =====
def login(username_enc, password_enc):
    """登录直到成功（无限OCR重试）"""
    for attempt in range(200):
        try:
            cap = school_post(f'/static/public/cg/generateCaptcha/20253659', {})
            if not cap.get('status'):
                time.sleep(0.5); continue
            cid = cap['data']['captchaId']
            b64 = cap['data']['captchaText']
            captcha_text = ocr_captcha(b64)
            if not captcha_text:
                time.sleep(0.5); continue
            resp = school_post('/static/public/auth/user', {
                'username': username_enc, 'password': password_enc,
                'sysCaptchaRes': {'captchaId': cid, 'captchaText': captcha_text}
            })
            if resp.get('status') and resp['data'].get('token'):
                return resp['data']['token'], f'{attempt+1}次OCR'
            time.sleep(0.5)
        except Exception as e:
            time.sleep(1)
    raise Exception('OCR重试200次仍无法登录')

def book_seat(token, seat_id, date, start_min, end_min):
    return school_post(
        f'/static/frontApi/make/freeBook/{seat_id}/{date}/{start_min}/{end_min}?capToken=capToken',
        {}, token=token
    )

def get_free_seats(token, room_id, date):
    return school_post(f'/static/frontApi/res/freeSeatIdsDuration/{room_id}/{date}', {}, token=token)

def get_current_make(token):
    return school_post('/static/frontApi/user/currentUseMake', {}, token=token)

def cancel_booking(token, booking_id):
    return school_post(f'/static/frontApi/make/cancel/{booking_id}', {}, token=token)

# ===== 任务存储 =====
def load_tasks():
    if not os.path.exists(TASK_FILE): return []
    with open(TASK_FILE, 'r') as f: return json.load(f)

def save_tasks(tasks):
    with open(TASK_FILE, 'w') as f: json.dump(tasks, f, ensure_ascii=False, indent=2)

# ===== 任务执行引擎 =====
def execute_scheduled_tasks():
    tasks = load_tasks()
    today = datetime.now().strftime('%Y-%m-%d')
    token_cache = None
    results_changed = False

    for task in tasks:
        if not task.get('enabled'): continue
        if not (task['dateFrom'] <= today <= task['dateTo']): continue
        results = task.get('results', {})
        if results.get(today, '').startswith('✅') or results.get(today, '').startswith('⚠️'):
            continue  # 今天已成功

        try:
            # 登录
            if not token_cache:
                token_cache, ocr_info = login(task['encryptedUsername'], task['encryptedPassword'])

            # 检查当天是否已有预约，有则取消
            cur = get_current_make(token_cache)
            if cur.get('status') and cur['data'] and cur['data'].get('id'):
                existing_id = cur['data']['id']
                cancel_booking(token_cache, existing_id)

            # 获取空闲座位
            seats_resp = get_free_seats(token_cache, task['roomId'], today)
            if not seats_resp.get('status') or not seats_resp.get('data'):
                results[today] = '❌ 获取空闲座位失败'
                results_changed = True
                continue

            free_seats = {k: v for k, v in seats_resp['data'].items() if v.get('status') == 'FREE'}
            if not free_seats:
                results[today] = '❌ 房间无空闲座位'
                results_changed = True
                continue

            # 选座位：优先偏好，否则随机
            prefs = task.get('preferredSeats', [])
            chosen = None
            picked_name = ''

            if prefs:
                for s in free_seats.values():
                    if s['label'] in prefs:
                        chosen = s
                        picked_name = f'{s["label"]}号'
                        break

            if not chosen:
                chosen = list(free_seats.values())[0]
                picked_name = f'{chosen["label"]}号'
                if prefs:
                    picked_name = f'偏好座位已被他人占用，改选 {chosen["label"]}号'

            # 预约
            book_resp = book_seat(token_cache, chosen['id'], today,
                                   task['startMinute'], task['endMinute'])
            if book_resp.get('status'):
                results[today] = f'✅ {picked_name}'
            else:
                results[today] = f'❌ 预约失败: {book_resp.get("message", "未知")}'
            results_changed = True

        except Exception as e:
            results[today] = f'❌ 执行异常: {str(e)[:40]}'
            results_changed = True

    if results_changed:
        save_tasks(tasks)

def scheduler_loop():
    """每分钟检查一次"""
    while True:
        now = datetime.now()
        if now.hour >= 5:  # 5点后才检查
            try:
                execute_scheduled_tasks()
            except Exception as e:
                print(f'[Scheduler] error: {e}')
        time.sleep(60)

# ===== REST API =====
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def _send(self, data, code=200):
        resp = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self._send({'status': 'ok'})
        elif self.path == '/api/schedules':
            tasks = load_tasks()
            for t in tasks:
                t.pop('encryptedUsername', None)
                t.pop('encryptedPassword', None)
            self._send({'status': True, 'data': tasks})
        else:
            self._send({'error': 'not found'}, 404)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}

        if self.path == '/api/schedules':
            task = {
                'id': datetime.now().strftime('%Y%m%d%H%M%S') + str(random.randint(100, 999)),
                'enabled': True,
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
                'createdAt': datetime.now().isoformat(),
                'results': {},
            }
            tasks = load_tasks()
            tasks.append(task)
            save_tasks(tasks)
            task.pop('encryptedUsername', None)
            task.pop('encryptedPassword', None)
            self._send({'status': True, 'data': task})

        elif self.path == '/api/schedules/execute':
            execute_scheduled_tasks()
            self._send({'status': True, 'message': '执行完成'})

        else:
            self._send({'error': 'not found'}, 404)

    def do_DELETE(self):
        task_id = self.path.replace('/api/schedules/', '')
        tasks = load_tasks()
        tasks = [t for t in tasks if t['id'] != task_id]
        save_tasks(tasks)
        self._send({'status': True})

    def do_PATCH(self):
        task_id = self.path.replace('/api/schedules/', '').split('/')[0]
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}
        tasks = load_tasks()
        for t in tasks:
            if t['id'] == task_id:
                if 'enabled' in body: t['enabled'] = body['enabled']
                if 'dateFrom' in body: t['dateFrom'] = body['dateFrom']
                if 'dateTo' in body: t['dateTo'] = body['dateTo']
                if 'preferredSeats' in body: t['preferredSeats'] = body['preferredSeats']
                save_tasks(tasks)
                self._send({'status': True})
                return
        self._send({'error': 'not found'}, 404)

if __name__ == '__main__':
    port = int(sys.argv[2]) if len(sys.argv) > 2 else PORT
    print(f'Schedule server on {HOST}:{port}')

    # 启动后台调度线程
    threading.Thread(target=scheduler_loop, daemon=True).start()

    HTTPServer((HOST, port), Handler).serve_forever()
