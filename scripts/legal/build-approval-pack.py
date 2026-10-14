#!/usr/bin/env python3
"""Render the repository's legal drafts into a local-only review pack.
No deployment/public directory output and no external requests or JavaScript.
"""
from pathlib import Path
import html, re, hashlib, json
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'outputs/quickbooks-approval'
PAGES = {
 'SERVICEOS-QUICKBOOKS-APPROVAL.md': 'index.html',
 'SERVICEOS-PRIVACY-POLICY-DRAFT.md': 'privacy.html',
 'SERVICEOS-TERMS-DRAFT.md': 'terms.html',
 'SERVICEOS-DRUMMONDS-PILOT-AGREEMENT-DRAFT.md': 'agreement.html',
 'SERVICEOS-LEGAL-PUBLICATION-REVIEW.md': 'release-review.html',
}
def inline(text):
    text = html.escape(text)
    def link(m):
        title, href = m.groups()
        href = PAGES.get(href, href)
        if not (href in PAGES.values() or href.startswith('https://') or href.startswith('mailto:')):
            return title
        return '<a href="'+href+'">'+title+'</a>'
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    return text

def render(text):
    out=[]; lines=text.strip().splitlines(); i=0
    while i<len(lines):
        line=lines[i]
        if not line.strip(): i+=1; continue
        h=re.match(r'^(#{1,6}) (.+)$',line)
        if h:
            n=len(h[1]); out.append(f'<h{n}>{inline(h[2])}</h{n}>'); i+=1; continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=[c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+',c) for c in cells):rows.append(cells)
                i+=1
            out.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in rows[0])+'</tr></thead><tbody>')
            for row in rows[1:]:out.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>')
            out.append('</tbody></table></div>'); continue
        li=re.match(r'^(?:- |\d+\. )(.+)$',line)
        if li:
            tag='ul' if line.startswith('- ') else 'ol'; items=[]
            while i<len(lines) and re.match(r'^(?:- |\d+\. )',lines[i]):
                item=re.sub(r'^(?:- |\d+\. )','',lines[i]);i+=1
                while i<len(lines) and lines[i].startswith('  '):item+=' '+lines[i].strip();i+=1
                items.append('<li>'+inline(item)+'</li>')
            out.append('<'+tag+'>'+''.join(items)+'</'+tag+'>');continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(?:#|\||- |\d+\. )',lines[i]):paragraph.append(lines[i]);i+=1
        out.append('<p>'+inline(' '.join(paragraph))+'</p>')
    return '\n'.join(out)
CSS='''*{box-sizing:border-box}body{margin:0;background:#faf9f6;color:#292335;font:16px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{border-bottom:1px solid #e3deea;background:#fff}header>div,main,footer{max-width:1040px;margin:auto;padding:24px 28px}.brand{font-weight:700;letter-spacing:-.04em;font-size:26px}.status{font-size:12px;color:#766289;letter-spacing:.1em;text-transform:uppercase;margin-top:4px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}nav a{border:1px solid #e3deea;border-radius:999px;padding:7px 14px;text-decoration:none;font-size:14px;color:#514268}nav a[aria-current]{background:#514268;color:white;border-color:#514268}.notice{background:#f1ebf6;border-left:4px solid #8c729f;padding:18px 22px;border-radius:4px 16px 16px 4px;font-size:14px;margin:8px 0 28px}article{max-width:820px}h1{font-size:clamp(30px,5vw,48px);letter-spacing:-.035em;line-height:1.15;margin:20px 0 26px}h2{font-size:23px;line-height:1.3;margin:40px 0 14px;padding-top:22px;border-top:1px solid #e3deea}h3{font-size:18px;margin:24px 0 8px}p{margin:14px 0}a{color:#62497b;text-underline-offset:3px;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #a28bb8;outline-offset:4px}li{margin:10px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd4e5;padding:12px;text-align:left;vertical-align:top}th{background:#f1ebf6}.table-wrap{overflow:auto}code{overflow-wrap:anywhere;font-size:.9em}footer{font-size:13px;color:#776e80;border-top:1px solid #e3deea;margin-top:40px}@media(max-width:520px){header>div,main,footer{padding:20px}nav a{padding:7px 10px;font-size:13px}body{font-size:15px}}@media print{nav,.notice{display:none}body{background:white;font-size:11pt}header>div,main,footer{max-width:none;padding:0}h1{font-size:24pt}h2{break-after:avoid}p,li{orphans:3;widows:3}a{color:inherit}footer{margin-top:20px}}'''
OUT.mkdir(parents=True,exist_ok=True)
approval_path=ROOT/'docs/legal/SERVICEOS-QUICKBOOKS-DRAFT-APPROVAL.json'
approval=json.loads(approval_path.read_text()) if approval_path.exists() else {}
expected_approval_sources={'SERVICEOS-PRIVACY-POLICY-DRAFT.md','SERVICEOS-TERMS-DRAFT.md','SERVICEOS-DRUMMONDS-PILOT-AGREEMENT-DRAFT.md'}
approved=approval.get('status')=='draft_text_and_targets_approved' and set(approval.get('sourceHashes',{}))==expected_approval_sources and all(hashlib.sha256((ROOT/'docs/legal'/name).read_bytes()).hexdigest()==digest for name,digest in approval['sourceHashes'].items())
manifest={'status':'draft_not_approved_not_published','publicPolicyPaths':['/privacy/drummonds','/terms/drummonds'],'privateAgreement':'agreement.html','sources':{}}
if approved: manifest['status']='draft_text_approved_not_published_or_signed'
for source,target in PAGES.items():
    text=(ROOT/'docs/legal'/source).read_text(); title=text.splitlines()[0].removeprefix('# ')
    nav=''.join(f'<a href="{f}"'+(' aria-current="page"' if target==f else '')+f'>{label}</a>' for f,label in [('index.html','Approval summary'),('privacy.html','Privacy notice'),('terms.html','User terms'),('agreement.html','Pilot agreement')])
    private='Private agreement review. This document must not be published as an Intuit policy page.' if target=='agreement.html' else ('Draft text approved by Chris; operational verification and publication remain outstanding. The agreement is unsigned.' if approved else 'Approval preview. No policy is effective, agreement signed, or production access authorised by this page.')
    content=f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>{html.escape(title)} · OpenFolk review</title><style>{CSS}</style></head><body><header><div><div class="brand">openfolk.</div><div class="status">Drummonds · QuickBooks launch review</div><nav aria-label="Approval documents">{nav}</nav></div></header><main><aside class="notice">{private}</aside><article>{render(text)}</article></main><footer>Prepared 13 October 2026 · Chris Drummond · chris@drummondheating.co.uk<br>Drafts for business review. No sign-in, tracking scripts or external fonts are loaded by this review pack.</footer></body></html>'
    (OUT/target).write_text(content)
    manifest['sources'][source]={'sha256':hashlib.sha256(text.encode()).hexdigest(),'preview':target}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Rendered {len(PAGES)} draft pages to {OUT}')
