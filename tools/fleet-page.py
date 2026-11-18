#!/usr/bin/env python3
# Usage: python3 tools/fleet-page.py [project-dir]
# Builds <project>/pm/docs/fleet.html from docs/fleet/index.html with the crew's pictures
# inlined, because the page server serves only plain .html files from pm/docs/.
import base64, pathlib, re, sys
here = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'fleet'
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.') / 'pm' / 'docs' / 'fleet.html'
html = (here / 'index.html').read_text()
def inline(m):
    data = base64.b64encode((here / m.group(1)).read_bytes()).decode()
    return f'src="data:image/webp;base64,{data}"'
html = re.sub(r'src="([a-z-]+\.webp)"', inline, html)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print(out)
