from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

OUTPUT = Path(__file__).resolve().parent.parent / "qa-captures"
OUTPUT.mkdir(exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        name = parse_qs(urlparse(self.path).query).get("name", ["capture.png"])[0]
        if not name.endswith(".png") or "/" in name or ".." in name:
            self.send_error(400)
            return
        length = int(self.headers.get("Content-Length", "0"))
        (OUTPUT / name).write_bytes(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args):
        pass


HTTPServer(("127.0.0.1", 5175), Handler).serve_forever()
