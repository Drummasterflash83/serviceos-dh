#!/usr/bin/env python3
"""Build local-only publication wording candidates; never publishes policy pages."""
from pathlib import Path
import runpy, json, hashlib
ROOT = Path(__file__).resolve().parents[2]
rendering = runpy.run_path(str(ROOT / 'scripts/legal/build-approval-pack.py'))
OUT = ROOT / 'outputs/quickbooks-approval'
NAMES = ['PRIVACY', 'TERMS', 'REVIEW']
for name in NAMES:
    text = (ROOT / f'docs/legal/publication-candidates/{name}.md').read_text()
    nav = '<nav><a href="candidate-review.html">Changes to review</a><a href="candidate-privacy.html">Privacy candidate</a><a href="candidate-terms.html">Terms candidate</a><a href="index.html">Original approval pack</a></nav>'
    page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>Publication candidate · Drummonds ServiceOS</title><style>' + rendering['CSS'] + '</style></head><body><header><div><div class="brand">openfolk.</div><div class="status">Publication wording · owner review</div>' + nav + '</div></header><main><aside class="notice">New publication candidate. Not approved, published or effective. The original drafts and private agreement remain unchanged.</aside><article>' + rendering['render'](text) + '</article></main></body></html>'
    (OUT / f'candidate-{name.lower()}.html').write_text(page)
manifest = {'state': 'prepared_not_approved_or_published', 'preparedAt': '2026-10-13', 'sources': {name: hashlib.sha256((ROOT / f'docs/legal/publication-candidates/{name}.md').read_bytes()).hexdigest() for name in NAMES}}
(ROOT / 'docs/legal/publication-candidates/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Rendered {len(NAMES)} local publication candidates to {OUT}')
