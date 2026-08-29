import http.server, socketserver, urllib.request, urllib.error, os

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')
BACKEND = 'http://localhost:3100'
PORT = 5190
PROXY_PREFIXES = ('/api/', '/uploads/', '/files/', '/health')

EXT_CT = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
}

class H(http.server.BaseHTTPRequestHandler):
    def _proxy(self):
        target = BACKEND + self.path
        length = int(self.headers.get('Content-Length', 0) or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ('host', 'content-length', 'connection')}
        req = urllib.request.Request(target, data=body, headers=headers, method=self.command)
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in ('transfer-encoding', 'connection'):
                    continue
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() in ('transfer-encoding', 'connection'):
                    continue
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def _static(self):
        path = self.path.split('?', 1)[0]
        if path == '/':
            path = '/index.html'
        fp = os.path.normpath(os.path.join(DIST, path.lstrip('/')))
        if not fp.startswith(DIST):
            self.send_response(403); self.end_headers(); return
        if os.path.isdir(fp):
            fp = os.path.join(fp, 'index.html')
        if not os.path.exists(fp):
            fp = os.path.join(DIST, 'index.html')  # SPA 兜底
        ext = os.path.splitext(fp)[1]
        self.send_response(200)
        self.send_header('Content-Type', EXT_CT.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(os.path.getsize(fp)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        with open(fp, 'rb') as f:
            self.wfile.write(f.read())

    def do_GET(self):
        if self.path.startswith(PROXY_PREFIXES):
            return self._proxy()
        return self._static()

    def do_POST(self):
        if self.path.startswith(PROXY_PREFIXES):
            return self._proxy()
        self.send_response(405); self.end_headers()

    def do_PUT(self):
        if self.path.startswith(PROXY_PREFIXES):
            return self._proxy()
        self.send_response(405); self.end_headers()

    def do_DELETE(self):
        if self.path.startswith(PROXY_PREFIXES):
            return self._proxy()
        self.send_response(405); self.end_headers()

    def log_message(self, *a):
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), H) as httpd:
    print(f'static+proxy server on {PORT}, backend {BACKEND}')
    httpd.serve_forever()
