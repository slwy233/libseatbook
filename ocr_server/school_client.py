"""School transport with current signatures and bounded read-only rate-limit retry."""
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from collections import OrderedDict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CONFIG_PATH = '/static/public/cg/getSysSet/PC'
READ_ONLY_PATHS = {
    '/static/frontApi/user/getUserInfo', '/static/frontApi/user/currentUseMake',
    '/static/frontApi/user/lastMake', '/static/frontApi/res/buildingFloorDate',
}
READ_ONLY_PREFIXES = tuple('/static/frontApi/res/' + name + '/' for name in (
    'findRoomDuration', 'freeSeatIdsDuration', 'querySeatLayout',
    'getStartTimes', 'getEndTimes', 'getTimeLine',
))
PACED_PREFIXES = tuple('/static/frontApi/res/' + name + '/' for name in (
    'freeSeatIdsDuration', 'querySeatLayout',
))


class SchoolError(RuntimeError):
    """Only safe error categories; no upstream bodies or credentials."""


def sign_headers(info, method):
    if info.get('hmac') != 1:
        return {}
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad
    try:
        key = (info.get('makePrefix') or 'server_date_time').encode('utf-8')
        iv = (info.get('makeSuffix') or 'client_date_time').encode('utf-8')
        if len(key) not in (16, 24, 32) or len(iv) != 16:
            raise ValueError()
        secret = unpad(AES.new(key, AES.MODE_CBC, iv).decrypt(
            base64.b64decode(info['hmacKey'], validate=True)), 16).decode('utf-8')
        if not secret:
            raise ValueError()
    except (KeyError, ValueError, TypeError, UnicodeError, AttributeError):
        raise SchoolError('学校签名配置无效') from None
    chars = list(secrets.token_hex(18))
    chars[14], chars[19] = '4', str(secrets.randbelow(4))
    nonce, timestamp = ''.join(chars), str(int(time.time() * 1000))
    message = f'seat::{nonce}::{timestamp}::{method.upper()}'
    digest = hmac.new(secret.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).hexdigest()
    return {'x-request-id': nonce, 'x-request-date': timestamp, 'x-hmac-request-key': digest}


class SchoolClient:
    def __init__(self, base_url, timeout=15, config_ttl=900, min_interval=2,
                 opener=None, signer=None, clock=None, sleep=None):
        if timeout <= 0 or config_ttl <= 0 or min_interval < 0:
            raise ValueError('学校请求超时和缓存时长必须为正数，间隔不得为负数')
        self.base_url = base_url.rstrip('/')
        self.timeout, self.config_ttl, self.min_interval = timeout, config_ttl, min_interval
        self.opener, self.signer = opener or urlopen, signer or sign_headers
        self.clock, self.sleep = clock or time.monotonic, sleep or time.sleep
        self._config, self._expires = None, 0
        self._config_lock, self._pace_lock = threading.Lock(), threading.Lock()
        self._next_request = OrderedDict()
        self.max_response_bytes = 2 * 1024 * 1024

    def _request(self, path, data, headers):
        request = Request(self.base_url + path, data=json.dumps(data or {}).encode('utf-8'),
                          headers=headers, method='POST')
        try:
            response = self.opener(request, timeout=self.timeout)
        except HTTPError as error:
            code = error.code
            error.close()
            if code == 429:
                return {'status': False, 'code': 429, 'message': '访问过于频繁'}
            raise SchoolError(f'学校返回 HTTP {code}') from None
        except (URLError, TimeoutError, OSError):
            raise SchoolError('学校请求连接失败或超时') from None
        try:
            with response:
                raw = response.read(self.max_response_bytes + 1)
            if len(raw) > self.max_response_bytes:
                raise SchoolError('学校响应过大')
            result = json.loads(raw)
        except SchoolError:
            raise
        except (ValueError, UnicodeError):
            raise SchoolError('学校返回无效 JSON') from None
        except (TimeoutError, OSError):
            raise SchoolError('学校响应读取失败或超时') from None
        if not isinstance(result, dict):
            raise SchoolError('学校返回格式错误')
        return result

    def _system_config(self):
        with self._config_lock:
            if self._config is not None and self.clock() < self._expires:
                return self._config
            result = self._request(CONFIG_PATH, {}, {'Content-Type': 'application/json', 'logintype': 'PC'})
            if result.get('status') is not True or not isinstance(result.get('data'), dict):
                raise SchoolError('获取学校配置失败')
            self._config = dict(result['data'])
            self._expires = self.clock() + self.config_ttl
            return self._config

    def _pace(self, path, token):
        prefix = next((p for p in PACED_PREFIXES if path.startswith(p)), None)
        if prefix is None or not self.min_interval:
            return
        key = (prefix, hashlib.sha256((token or '').encode('utf-8')).digest())
        with self._pace_lock:
            now = self.clock()
            wait = max(0, self._next_request.get(key, now) - now)
            self._next_request[key] = now + wait + self.min_interval
            self._next_request.move_to_end(key)
            while len(self._next_request) > 256:
                self._next_request.popitem(last=False)
        if wait:
            self.sleep(wait)

    def post(self, path, data=None, token=None):
        if not isinstance(path, str) or not path.startswith('/static/'):
            raise SchoolError('学校接口路径无效')
        public = path == CONFIG_PATH or path.startswith('/static/public/cg/generateCaptcha/')
        readonly = path in READ_ONLY_PATHS or path.startswith(READ_ONLY_PREFIXES)
        for attempt in range(2 if readonly else 1):
            self._pace(path, token)
            headers = {'Content-Type': 'application/json', 'logintype': 'PC'}
            if not public:
                headers.update(self.signer(self._system_config(), 'POST'))
            if token:
                headers['token'] = token
            result = self._request(path, data, headers)
            limited = result.get('status') is False and (
                str(result.get('code')) == '429' or '频繁' in str(result.get('message', ''))
            )
            if not limited or not readonly or attempt:
                return result
            self.sleep(max(2, self.min_interval))
        return result
