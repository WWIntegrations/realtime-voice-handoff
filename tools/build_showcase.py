"""Build the standalone lab from repository-owned ES modules. No network or npm."""
from pathlib import Path
import base64
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
IMPORT = re.compile(r"(\bfrom\s*|\bimport\s*)(['\"])(\.{1,2}/[^'\"]+)\2")

def build():
    modules = sorted((ROOT / 'src').glob('*.js')) + [ROOT / 'showcase/controller.mjs', ROOT / 'showcase/main.js']
    paths = {p.resolve() for p in modules}
    imports = {}
    for path in modules:
        def replace(match):
            target = (path.parent / match.group(3)).resolve()
            if target not in paths:
                raise ValueError(f'Unbundled import: {path.name}: {match.group(3)}')
            return match.group(1) + match.group(2) + 'voice/' + target.relative_to(ROOT).as_posix() + match.group(2)
        source = IMPORT.sub(replace, path.read_text())
        imports['voice/' + path.relative_to(ROOT).as_posix()] = 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()
    script = '<script type="importmap">' + json.dumps({'imports': imports}, separators=(',', ':')).replace('<', '\\u003c') + '</script>\n<script type="module">import "voice/showcase/main.js";</script>'
    html = (ROOT / 'showcase/template.html').read_text().replace('/*__STYLE__*/', (ROOT / 'showcase/style.css').read_text()).replace('<!--__MODULES__-->', script).replace('<!--__DIAGRAM__-->', (ROOT / 'docs/architecture.svg').read_text())
    if '__MODULES__' in html or '__DIAGRAM__' in html:
        raise ValueError('Unresolved template placeholder')
    output = ROOT / 'docs/index.html'
    output.write_text(html)
    print(f'docs/index.html: {len(html.encode())} bytes sha256={hashlib.sha256(html.encode()).hexdigest()}')

if __name__ == '__main__':
    build()
