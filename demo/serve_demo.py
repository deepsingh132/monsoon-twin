"""Serves the demo site and passes the twin's two routes on to the twin server, so one address serves both.

Used for hosting (see the Dockerfile). The twin server itself (serve.py) stays unchanged and runs next to this.

  python serve.py --port 8000 &
  python demo/serve_demo.py --port 8080 --twin http://127.0.0.1:8000
"""
import argparse
import functools
import gzip
import http.server
import urllib.error
import urllib.request
from pathlib import Path

ROUTES = {"/health", "/simulate"}
MAX_BODY = 20 * 1024 * 1024                                   # a 3-day window is about 0.5 MB of JSON


class Handler(http.server.SimpleHTTPRequestHandler):
    twin = "http://127.0.0.1:8000"

    def do_POST(self):
        if self.path not in ROUTES:
            self.send_error(404); return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_error(413); return
        req = urllib.request.Request(self.twin + self.path, data=self.rfile.read(length), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                code, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, data = e.code, e.read()
        except OSError:
            self.send_error(503, "The twin is starting. Try again in a few seconds."); return
        encoded = "gzip" in (self.headers.get("Accept-Encoding") or "").lower() and len(data) >= 512
        if encoded:                                           # a 10-day rollout is 1.2 MB of JSON; phones get it compressed
            data = gzip.compress(data, compresslevel=5, mtime=0)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if encoded:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):                                    # the map data changes only with a new release
        path = self.path.split("?", 1)[0]
        if self.command == "GET" and path not in ("/", "/index.html", "/how.html", "/results.html"):
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def log_message(self, *args):                             # keep the host's logs quiet
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--twin", default="http://127.0.0.1:8000")
    a = ap.parse_args()
    Handler.twin = a.twin.rstrip("/")
    handler = functools.partial(Handler, directory=str(Path(__file__).parent))
    http.server.ThreadingHTTPServer(("0.0.0.0", a.port), handler).serve_forever()
