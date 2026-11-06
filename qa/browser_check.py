"""Run the actual WebRTC/PCM checks against a temporary loopback HTTP server."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *args):
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chrome', required=True, help='Path to an installed Chrome executable')
    parser.add_argument('--port', type=int, default=3405)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 3400 <= args.port <= 3499:
        parser.error('Use a loopback test port from 3400 through 3499')
    if not Path(args.chrome).is_file():
        parser.error('Chrome executable does not exist')
    if args.output.exists():
        parser.error('Output already exists; choose a new evidence file')

    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(QuietHandler, directory=str(ROOT)))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    errors, external = [], []
    result = None
    started = time.monotonic()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chrome)
            try:
                context = browser.new_context(viewport={'width': 1440, 'height': 900})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: external.append(request.url)
                        if urlsplit(request.url).scheme in ('http', 'https')
                        and urlsplit(request.url).hostname != '127.0.0.1' else None)
                page.goto(f'http://127.0.0.1:{args.port}/tests/browser-harness.html', timeout=10000)
                page.get_by_role('button', name='Start check', exact=True).click()
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    result = page.evaluate('window.qaResult || null')
                    if result and result.get('done'):
                        break
                    page.wait_for_timeout(100)
                if not result or not result.get('done'):
                    raise RuntimeError('Browser checks did not complete in 120 seconds')
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        evidence = {'result': result, 'page_errors': errors, 'external_requests': external,
                    'elapsed_seconds': round(time.monotonic() - started, 3),
                    'scope': 'Local Chromium loopback and PCM graph; no hardware audibility claim'}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x') as stream:
            json.dump(evidence, stream, indent=2)
            stream.write('\n')
    passed = bool(result and result.get('ok') and not errors and not external)
    print(json.dumps({'ok': passed, 'evidence': str(args.output), 'elapsed_seconds': evidence['elapsed_seconds'],
                      'checks': (result or {}).get('checks', []), 'error': (result or {}).get('error'),
                      'page_errors': errors, 'external_request_count': len(external)}))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
