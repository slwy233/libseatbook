"""Shared HTTP validation and lazy, serialized OCR inference."""
import base64
import binascii
import json
import re
import threading


class ApiError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


def read_json_body(handler, limit):
    if handler.headers.get('Transfer-Encoding'):
        raise ApiError('不支持 Transfer-Encoding')
    content_type = handler.headers.get('Content-Type', '').split(';')[0].strip().lower()
    if content_type and content_type != 'application/json':
        raise ApiError('Content-Type 必须为 application/json', 415)
    try:
        length = int(handler.headers.get('Content-Length', 0))
    except (ValueError, TypeError):
        raise ApiError('Content-Length 无效')
    if length < 0:
        raise ApiError('Content-Length 无效')
    if length > limit:
        raise ApiError('请求体过大', 413)
    try:
        raw = handler.rfile.read(length)
        if len(raw) != length:
            raise ApiError('请求体长度与 Content-Length 不符')
        body = json.loads(raw) if length else {}
    except TimeoutError:
        raise ApiError('读取请求体超时', 408)
    except (ValueError, UnicodeDecodeError):
        raise ApiError('请求体必须为有效 JSON')
    if not isinstance(body, dict):
        raise ApiError('请求体必须为 JSON 对象')
    return body


def send_json(handler, data, code=200):
    raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
    handler.send_response(code)
    for name, value in [('Content-Type', 'application/json; charset=utf-8'),
                        ('Content-Length', str(len(raw))),
                        ('Access-Control-Allow-Origin', '*'), ('Cache-Control', 'no-store')]:
        handler.send_header(name, value)
    handler.end_headers()
    handler.wfile.write(raw)


class LazyOCR:
    def __init__(self):
        self._engine = None
        self._lock = threading.Lock()

    def classification(self, image):
        with self._lock:
            if self._engine is None:
                import ddddocr
                self._engine = ddddocr.DdddOcr(show_ad=False)
            return self._engine.classification(image)


def decode_image(value, max_bytes=1024 * 1024):
    if not isinstance(value, str) or not value:
        raise ApiError('image 必须为非空 base64 字符串')
    if value.startswith('data:'):
        header, separator, value = value.partition(',')
        if not separator or not header.startswith('data:image/') or ';base64' not in header:
            raise ApiError('image data URL 无效')
    if len(value) > ((max_bytes + 2) // 3) * 4:
        raise ApiError('验证码图片过大', 413)
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ApiError('image 必须为有效 base64')
    if not raw:
        raise ApiError('验证码图片不能为空')
    if len(raw) > max_bytes:
        raise ApiError('验证码图片过大', 413)
    return raw


def captcha_result(raw):
    raw = str(raw).strip()
    result = {'raw': raw, 'text': '', 'isMath': False, 'answer': ''}
    clean = re.sub(r'\s+', '', raw).replace('?', '').replace('=', '')
    expr = clean.replace('x', '*').replace('X', '*').replace('×', '*').replace('÷', '/')
    match = re.fullmatch(r'(-?\d{1,9})([+\-*/])(-?\d{1,9})', expr)
    if match:
        a, op, b = int(match[1]), match[2], int(match[3])
        if op == '/' and b == 0:
            raise ApiError('验证码算式除数不能为零', 422)
        answer = {'+': lambda: a + b, '-': lambda: a - b,
                  '*': lambda: a * b, '/': lambda: a // b}[op]()
        result.update(text=str(answer), answer=str(answer), isMath=True)
    else:
        result['text'] = re.sub(r'[^a-zA-Z0-9]', '', raw)
    if not result['text']:
        raise ApiError('未识别到有效验证码', 422)
    return result
