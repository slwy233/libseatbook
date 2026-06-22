"""
验证码OCR服务 - 基于ddddocr
启动: python server.py --port 8910
"""
import base64, re, io, sys, json
from http.server import HTTPServer, BaseHTTPRequestHandler
import ddddocr

ocr = ddddocr.DdddOcr(show_ad=False)

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        b64 = body.get('image', '')

        if ',' in b64:
            b64 = b64.split(',')[1]

        try:
            img = base64.b64decode(b64)
            raw = ocr.classification(img).strip()
        except Exception as e:
            self.respond({'error': str(e), 'raw': ''})
            return

        result = {'raw': raw, 'text': '', 'isMath': False, 'answer': ''}

        # 判断算式类型
        if re.search(r'[+\-*x×÷/]', raw.replace('?','').replace('=','')):
            result['isMath'] = True
            expr = raw.replace(' ', '').replace('?', '').replace('=', '')
            expr = expr.replace('x', '*').replace('×', '*').replace('÷', '/')
            m = re.match(r'(-?\d+)([+\-*/])(-?\d+)', expr)
            if m:
                a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
                ops = {'+': a+b, '-': a-b, '*': a*b, '/': a//b if b else 0}
                result['answer'] = str(ops[op])
                result['text'] = result['answer']
        else:
            # 字母数字: 去噪
            cleaned = re.sub(r'[^a-zA-Z0-9]', '', raw)
            result['text'] = cleaned

        self.respond(result)

    def do_GET(self):
        if self.path == '/health':
            self.respond({'status': 'ok', 'ocr': 'ddddocr'})
        else:
            self.respond({'error': 'POST only'}, 404)

    def respond(self, data, code=200):
        resp = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8910
    print(f'ddddocr OCR server on http://localhost:{port}')
    HTTPServer(('0.0.0.0', port), Handler).serve_forever()
