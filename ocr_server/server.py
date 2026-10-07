"""Captcha OCR HTTP service. Run: python server.py --host 127.0.0.1 --port 8910."""
import argparse
import os
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from backend_runtime import ApiError, LazyOCR, captcha_result, decode_image, read_json_body, send_json

ocr = LazyOCR()
MAX_BODY_BYTES = 2 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    timeout = 15

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        try:
            if self.path != '/':
                raise ApiError('not found', 404)
            body = read_json_body(self, MAX_BODY_BYTES)
            image = decode_image(body.get('image'))
            try:
                raw = ocr.classification(image)
            except Exception:
                # Model errors may include filesystem or input details.
                raise ApiError('验证码识别服务暂不可用', 503) from None
            self.respond(captcha_result(raw))
        except ApiError as error:
            self.respond({'status': False, 'error': str(error), 'message': str(error)}, error.code)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond({'status': False, 'error': 'internal error', 'message': '服务内部错误'}, 500)

    def do_GET(self):
        if self.path == '/health':
            self.respond({'status': 'ok', 'ocr': 'ddddocr',
                          'modelLoaded': ocr._engine is not None})
        else:
            self.respond({'status': False, 'error': 'not found'}, 404)

    def respond(self, data, code=200):
        send_json(self, data, code)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST,GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()


def main(argv=None):
    parser = argparse.ArgumentParser(description='学校验证码 OCR 服务')
    parser.add_argument('--host', default=os.getenv('OCR_HOST', '0.0.0.0'))
    parser.add_argument('--port', type=int, default=int(os.getenv('OCR_PORT', '8910')))
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('port 必须为 0 至 65535')
    with ThreadingHTTPServer((args.host, args.port), Handler) as service:
        print(f'OCR server on {args.host}:{service.server_port}', flush=True)
        try:
            service.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
