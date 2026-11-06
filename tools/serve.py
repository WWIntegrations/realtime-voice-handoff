"""Serve this checkout on loopback without exposing hidden files or external links."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_head(self):
        relative = unquote(urlsplit(self.path).path).lstrip("/")
        candidate = (ROOT / relative).resolve()
        if (any(part.startswith(".") for part in Path(relative).parts)
                or not candidate.is_relative_to(ROOT)):
            self.send_error(403)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Permissions-Policy", "microphone=(self), camera=()")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3405)
    args = parser.parse_args()
    if not 3400 <= args.port <= 3499:
        parser.error("Choose a loopback test port from 3400 through 3499")
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"Local lab: http://127.0.0.1:{args.port}/docs/index.html", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
