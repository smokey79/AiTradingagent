"""Local read-only research viewer with an explicit file allowlist."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import json,threading,time
ROOT=Path(__file__).resolve().parent
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        routes={'/':'orderbook_heatmap.html','/heatmap':'orderbook_heatmap.html','/report':'strategy_report.html','/status':'progress.json'}
        name=routes.get(self.path.split('?')[0])
        if name is None:self.send_error(404);return
        target=ROOT/name
        if not target.exists():self.send_error(404,'Research output not ready');return
        raw=target.read_bytes();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8' if name.endswith('.html') else 'application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',8769),Handler)
threading.Thread(target=lambda:(time.sleep(100*60),server.shutdown()),daemon=True).start()
print(json.dumps({'viewer':'http://127.0.0.1:8769','read_only':True}),flush=True)
server.serve_forever()
