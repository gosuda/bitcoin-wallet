import json, pathlib, random

HEAD = '''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
  <style>
    body { margin: 0; background: #FAFAF9; color: #1A1A1A; font-family: "IBM Plex Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
    a { color: #C2410C; } a:hover { color: #A3360A; }
    .mono { font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
    .label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #6B6B66; }
    .card { background: #FFFFFF; border: 1px solid #E4E3DF; border-radius: 4px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 34px; padding: 6px 12px; border: 1px solid #E4E3DF; border-radius: 4px; background: #FFFFFF; color: #1A1A1A; font-weight: 500; font-size: 14px; white-space: nowrap; }
    .btn-primary { background: #C2410C; border-color: #C2410C; color: #FFFFFF; }
    .btn-quiet { border-color: transparent; background: transparent; color: #6B6B66; }
    .btn-danger { color: #B91C1C; border-color: #E4E3DF; }
    .btn-sm { min-height: 28px; padding: 4px 8px; font-size: 12px; }
    .input { display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 34px; padding: 6px 12px; border: 1px solid #E4E3DF; border-radius: 4px; background: #FFFFFF; color: #1A1A1A; }
    .input.placeholder { color: #A19F97; }
    .seg { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 6px 12px; border: 1px solid #E4E3DF; border-radius: 4px; background: #FFFFFF; }
    .chip.on { border-color: #1A1A1A; background: #F4F4F2; }
    .dot { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid #A19F97; background: #FFFFFF; box-sizing: border-box; }
    .chip.on .dot { border: 4px solid #C2410C; }
    .hint { font-size: 12px; color: #6B6B66; }
    .kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 24px; align-items: baseline; }
    .kv dt { color: #6B6B66; font-size: 12px; } .kv dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 8px; border-bottom: 1px solid #E4E3DF; white-space: nowrap; }
    th { color: #6B6B66; font-weight: 600; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
    td.num, th.num { text-align: right; }
    tr:last-child td { border-bottom: none; }
  </style>
</helmet>
'''
TAIL = '''</x-dc>
</body>
</html>
'''

def icon(name, size=16, color="currentColor"):
    paths = {
      "copy": '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
      "refresh": '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"></path><path d="M4 4v4h4"></path><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"></path><path d="M20 20v-4h-4"></path>',
      "external": '<path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path>',
      "check": '<path d="M5 12l5 5L20 7"></path>',
      "plus": '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
      "x": '<path d="M6 6l12 12"></path><path d="M18 6L6 18"></path>',
      "eye": '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>',
      "key": '<circle cx="8" cy="15" r="4"></circle><path d="M10.9 12.1L20 3"></path><path d="M16 7l3 3"></path>',
      "chevron": '<path d="M9 6l6 6-6 6"></path>',
      "arrow": '<path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path>',
      # mobile
      "back": '<path d="M15 6l-6 6 6 6"></path>',
      "wallet": '<path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2"></path><path d="M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z"></path><circle cx="17" cy="14" r="1.2"></circle>',
      "scan": '<path d="M4 8V5a1 1 0 0 1 1-1h3"></path><path d="M16 4h3a1 1 0 0 1 1 1v3"></path><path d="M20 16v3a1 1 0 0 1-1 1h-3"></path><path d="M8 20H5a1 1 0 0 1-1-1v-3"></path><path d="M4 12h16"></path>',
      "gear": '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"></path>',
      "up": '<path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path>',
      "down": '<path d="M12 5v14"></path><path d="M18 13l-6 6-6-6"></path>',
      "share": '<path d="M12 16V4"></path><path d="M8 8l4-4 4 4"></path><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path>',
      "faceid": '<path d="M4 8V6a2 2 0 0 1 2-2h2"></path><path d="M16 4h2a2 2 0 0 1 2 2v2"></path><path d="M20 16v2a2 2 0 0 1-2 2h-2"></path><path d="M8 20H6a2 2 0 0 1-2-2v-2"></path><path d="M9 10v1.5"></path><path d="M15 10v1.5"></path><path d="M9.5 15.5a3.5 3.5 0 0 0 5 0"></path>',
    }
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>'

def topbar(step=None, meta="Signet · mempool.space"):
    steps = ""
    if step is not None:
        items = ["Setup", "Key", "Wallet"]
        parts = []
        for i, s in enumerate(items):
            on = i == step
            done = i < step
            col = "#1A1A1A" if on else ("#6B6B66" if done else "#A19F97")
            w = "600" if on else "500"
            parts.append(f'<span style="font-size: 12px; font-weight: {w}; color: {col};">{s}</span>')
            if i < 2:
                parts.append(icon("chevron", 12, "#C9C7C1"))
        steps = f'<div style="display: flex; align-items: center; gap: 8px;">{"".join(parts)}</div>'
    return f'''<header style="display: flex; align-items: center; justify-content: space-between; height: 44px; padding: 0 16px; border-bottom: 1px solid #E4E3DF; background: #FFFFFF;">
  <div style="display: flex; align-items: center; gap: 12px;">
    <div style="width: 20px; height: 20px; border-radius: 5px; background: #C2410C; display: flex; align-items: center; justify-content: center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="9" r="5.5" stroke="#FFFFFF" stroke-width="2.4"></circle><path d="M9.5 13.5h5L16 22H8z" fill="#FFFFFF"></path></svg></div>
    <span style="font-weight: 600; font-size: 14px;">Bitcoin Wallet</span>
  </div>
  {steps}
  <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6B6B66;">
    <span style="display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid #E4E3DF; border-radius: 999px; background: #F4F4F2;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #166534;"></span>{meta}</span>
  </div>
</header>'''

def page(body, step=None, meta="Signet · mempool.space", minh=640):
    return HEAD + f'<div style="width: 960px; min-height: {minh}px; background: #FAFAF9; display: flex; flex-direction: column;">\n{topbar(step, meta)}\n<main style="width: 100%; max-width: 880px; margin: 0 auto; padding: 24px 16px 32px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">\n{body}\n</main>\n</div>\n' + TAIL

def head(title, sub):
    return f'''<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px;">
  <h1 style="margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em;">{title}</h1>
  <p style="margin: 0; font-size: 12px; color: #6B6B66;">{sub}</p>
</div>'''

def chips(opts, on):
    return '<div class="seg">' + "".join(f'<span class="chip{" on" if o == on else ""}"><span class="dot"></span><span>{o}</span></span>' for o in opts) + '</div>'

def field(label, inner, hint=None):
    h = f'<span class="hint">{hint}</span>' if hint else ""
    return f'<div style="display: flex; flex-direction: column; gap: 6px;"><span class="label">{label}</span>{inner}{h}</div>'

ADDR = "tb1q4xp7va00fsud6u5yca6qs6ntaj62a83dv378jc"
TR_ADDR = "tb1p5n82a6xmp47yhkkc007dxstutv23cce37xqg0n2ugwsmfnu98h2szr4k32"
TXID = "e19f4a7d05c3b8a2f6d1e0c9b7a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b2c8d4a0"
XPUB = "tpubDDkV5G9Hn3mYvXG7QxgqqRuAVkLpzPHPbCowHTEBb2ap9VwBKjHcSMMdzGqJDDyUhkgyxSpRnYPKgQ4wPfjoT9ZEwD4uYzRQVe6RqPmDCXm"

def fake_qr(px=210):
    """A stand-in QR: real finder patterns, deterministic noise for the payload."""
    rnd = random.Random(20260904)
    n, out = 25, []
    cell = px / n
    def reserved(x, y):
        return (x < 8 and y < 8) or (x > n - 9 and y < 8) or (x < 8 and y > n - 9)
    for y in range(n):
        for x in range(n):
            if not reserved(x, y) and rnd.random() < 0.46:
                out.append(f'<rect x="{x*cell:.2f}" y="{y*cell:.2f}" width="{cell:.2f}" height="{cell:.2f}" fill="#1A1A1A"></rect>')
    for ox, oy in ((0, 0), (n - 7, 0), (0, n - 7)):
        out.append(f'<rect x="{ox*cell:.2f}" y="{oy*cell:.2f}" width="{7*cell:.2f}" height="{7*cell:.2f}" fill="#1A1A1A"></rect>')
        out.append(f'<rect x="{(ox+1)*cell:.2f}" y="{(oy+1)*cell:.2f}" width="{5*cell:.2f}" height="{5*cell:.2f}" fill="#FFFFFF"></rect>')
        out.append(f'<rect x="{(ox+2)*cell:.2f}" y="{(oy+2)*cell:.2f}" width="{3*cell:.2f}" height="{3*cell:.2f}" fill="#1A1A1A"></rect>')
    return f'<svg width="{px}" height="{px}" viewBox="0 0 {px} {px}" aria-hidden="true"><rect width="{px}" height="{px}" fill="#FFFFFF"></rect>{"".join(out)}</svg>'


setup = page(head("Setup", "Network and Esplora endpoint. Stored locally; no secrets.") + f'''
<section class="card" style="gap: 16px;">
  {field("Network", chips(["Bitcoin","Testnet3","Testnet4","Signet","Regtest"], "Signet"))}
  {field("Esplora URL", '<span class="input mono">https://mempool.space/signet/api</span>', "Any Esplora-compatible API — mempool.space, blockstream.info, electrs, bitcoin-rs.")}
  {field("Address type", chips(["P2PKH (legacy)","P2WPKH (segwit)","P2SH-P2WPKH (nested)","P2TR (taproot)","P2PK (bare)"], "P2WPKH (segwit)"), "P2PK funds are not discoverable by public indexers.")}
</section>
<div style="display: flex; justify-content: flex-end; gap: 8px;">
  <span class="btn btn-primary">Continue {icon("arrow", 16, "#FFFFFF")}</span>
</div>''', step=0)

key = page(head("Key", "Signet · mempool.space") + f"""
<section class="card" style="gap: 16px;">
  {field("Private key", '<span class="input mono" style="justify-content: space-between;"><span style="letter-spacing: 0.18em;">••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••</span>' + icon("eye", 16, "#6B6B66") + '</span>', "Hex (64 chars) or WIF. Used for this session only — never written to disk.")}
  <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px;"><span style="width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid #1A1A1A; background: #1A1A1A; display: inline-flex; align-items: center; justify-content: center;">{icon("check", 12, "#FFFFFF")}</span><span>Remember on this device</span><span class="hint">· stored in the macOS Keychain, unlocked with your login</span></label>
  <div style="display: flex; gap: 8px; align-items: center;">
    <span class="btn btn-primary">{icon("key", 16, "#FFFFFF")} Open wallet</span>
    <span class="btn">Generate new key</span>
    <span class="btn btn-quiet">Back</span>
  </div>
</section>
<section class="card" style="border-color: #C2410C; background: #FFF7ED; gap: 12px;">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label" style="color: #9A3412;">New key — shown once</span>
    <span style="font-size: 12px; color: #9A3412;">Copy it now; it is not stored anywhere.</span>
  </div>
  <dl class="kv" style="margin: 0;">
    <dt>Address</dt><dd class="mono">{ADDR}</dd>
    <dt>Private key (hex)</dt><dd class="mono">5f1c…a9e3 <span class="hint">(hidden)</span></dd>
    <dt>WIF</dt><dd class="mono">cV3m…Qk7t <span class="hint">(hidden)</span></dd>
  </dl>
  <div style="display: flex; gap: 8px;">
    <span class="btn btn-sm">{icon("copy", 14)} Copy hex</span>
    <span class="btn btn-sm">{icon("copy", 14)} Copy WIF</span>
    <span class="btn btn-sm">Use this key</span>
  </div>
</section>
<section class="card" style="gap: 12px;">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Watch-only</span>
    <span class="hint">Follows a wallet without its keys: balance, history and receiving, no sending.</span>
  </div>
  {field("xpub or descriptor", '<span class="input mono placeholder">wpkh([fingerprint/84h/1h/0h]tpub…/0/*) — or just the tpub</span>', "A bare xpub is expanded with the address type chosen in Setup.")}
  <div style="display: flex; gap: 8px; align-items: center;">
    <span class="btn">{icon("eye", 16)} Follow this wallet</span>
  </div>
</section>""", step=1, minh=840)

def word_grid(words, blanks=()):
    cells = []
    for i, w in enumerate(words, start=1):
        if i in blanks:
            body = '<span style="flex: 1; border-bottom: 1px solid #C2410C; min-height: 18px;"></span>'
        else:
            body = f'<span class="mono" style="flex: 1;">{w}</span>'
        cells.append(
            '<div style="display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; border: 1px solid #E4E3DF; border-radius: 4px; background: #FFFFFF;">'
            f'<span class="hint" style="width: 16px; text-align: right;">{i}</span>{body}</div>'
        )
    return '<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;">' + "".join(cells) + '</div>'

WORDS = ['ridge', 'olive', 'spider', 'canyon', 'fabric', 'velvet', 'hazard', 'meadow', 'tunnel', 'orbit', 'cactus', 'spoon']

create = page(head("New wallet", "Signet · mempool.space") + f'''
<section class="card" style="border-color: #C2410C; background: #FFF7ED; gap: 12px;">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label" style="color: #9A3412;">Recovery phrase — shown once</span>
    <span style="font-size: 12px; color: #9A3412;">Anyone with these words can spend your bitcoin.</span>
  </div>
  {word_grid(WORDS)}
  <div style="display: flex; gap: 8px; align-items: center;">
    <span class="btn btn-sm">{icon("copy", 14)} Copy</span>
    <span class="hint">Write them down in order. This wallet cannot show them again.</span>
  </div>
</section>
<section class="card" style="gap: 12px;">
  <span class="label">Confirm your backup</span>
  <span class="hint">Fill in the missing words to continue.</span>
  {word_grid(WORDS, blanks=(3, 7, 11))}
</section>
<div style="display: flex; justify-content: space-between; align-items: center;">
  <span class="btn btn-quiet">Back</span>
  <div style="display: flex; gap: 8px;">
    <span class="btn">Advanced: use a single key</span>
    <span class="btn btn-primary">Create wallet {icon("arrow", 16, "#FFFFFF")}</span>
  </div>
</div>''', step=1, minh=760)

restore = page(head("Restore wallet", "Signet · mempool.space") + f'''
<section class="card" style="gap: 16px;">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Recovery phrase</span>
    <div class="seg">
      <span class="chip on"><span class="dot"></span><span>12 words</span></span>
      <span class="chip"><span class="dot"></span><span>24 words</span></span>
    </div>
  </div>
  {word_grid(WORDS[:8] + ["spooon", "orbit", "cactus", "spoon"])}
  <div style="display: flex; align-items: center; gap: 8px;">
    <span style="font-size: 12px; color: #B91C1C;">Word 9 &quot;spooon&quot; is not in the word list.</span>
  </div>
  {field("Passphrase (optional)", '<span class="input placeholder">Leave empty unless you added one</span>', "A passphrase creates a different wallet from the same words.")}
</section>
<div style="display: flex; justify-content: space-between; align-items: center;">
  <span class="btn btn-quiet">Back</span>
  <span class="btn btn-primary" style="opacity: 0.55;">{icon("key", 16, "#FFFFFF")} Restore wallet</span>
</div>''', step=1, minh=700)


unlock = page(head("Unlock", "Signet · mempool.space") + f'''
<section class="card" style="gap: 16px; padding: 24px;">
  <div style="display: flex; align-items: center; gap: 12px;">
    <span style="width: 36px; height: 36px; border-radius: 50%; background: #F4F4F2; border: 1px solid #E4E3DF; display: inline-flex; align-items: center; justify-content: center;">{icon("key", 18, "#1A1A1A")}</span>
    <div style="display: flex; flex-direction: column; gap: 2px;">
      <span style="font-weight: 600; font-size: 16px;">Wallet saved on this device</span>
      <span class="hint">The key is kept in the macOS Keychain. Unlocking may ask for your login password.</span>
    </div>
  </div>
  <dl class="kv" style="margin: 0;">
    <dt>Address</dt><dd class="mono">{ADDR}</dd>
    <dt>Network</dt><dd>Signet · P2WPKH (segwit)</dd>
    <dt>Wallet id</dt><dd class="mono">signet-p2wpkh-3f0c9a1b</dd>
  </dl>
  <div style="display: flex; gap: 8px; align-items: center;">
    <span class="btn btn-primary">{icon("key", 16, "#FFFFFF")} Unlock</span>
    <span class="btn">Use a different key</span>
    <span class="btn btn-quiet" style="margin-left: auto; color: #B91C1C;">Forget this wallet</span>
  </div>
</section>''', step=1)

rows = [
  ("a41e9c2f7b…3d08e1f2:0", ADDR, "250,000", "142"),
  ("7c02d8b1e4…9a6f0c3b:1", ADDR, "120,000", "31"),
  ("e19f4a7d05…b2c8d4a0:0", ADDR, "18,420", "pending"),
]
def _tr(o,a,v,c):
    st = ' style="color: #6B6B66;"' if c=="pending" else ""
    return f'<tr><td class="mono">{o}</td><td class="mono" style="color: #6B6B66;">{a}</td><td class="num mono">{v}</td><td class="num mono"{st}>{c}</td></tr>'
trs = "".join(_tr(*r) for r in rows)
def _hrow(dirn, txid, amt, conf, when, expanded=False):
    up = dirn == "out"
    col = "#1A1A1A" if up else "#166534"
    sign = "\u2212" if up else "+"
    ic = icon("arrow", 14, "#6B6B66") if up else icon("arrow", 14, "#166534")
    rot = ' style="display: inline-flex;"' if up else ' style="display: inline-flex; transform: rotate(180deg);"'
    cst = ' style="color: #6B6B66;"' if conf == "pending" else ""
    chev = ' style="display: inline-flex; transform: rotate(90deg);"' if expanded else ' style="display: inline-flex;"'
    row = (f'<tr><td><span{rot}>{ic}</span></td><td class="mono">{txid}</td>'
           f'<td class="num mono" style="color: {col}; font-weight: 500;">{sign}{amt}</td>'
           f'<td class="num mono"{cst}>{conf}</td><td class="num" style="color: #6B6B66;">{when}</td>'
           f'<td class="num"><span{chev}>{icon("chevron", 14, "#A19F97")}</span></td></tr>')
    if not expanded:
        return row
    # Click a row and it opens in place — the same detail the phone shows on its
    # own screen, with the fee bump living inside it rather than on the row.
    detail = f"""<tr><td colspan="6" style="padding: 0 8px 12px 32px; white-space: normal; border-bottom: 1px solid #E4E3DF;">
  <div style="display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; background: #F4F4F2; border-radius: 4px;">
    <dl class="kv" style="margin: 0;">
      <dt>Txid</dt><dd class="mono" style="font-size: 12px;">{TXID}</dd>
      <dt>Fee</dt><dd class="mono">141 sat · 1.0 sat/vB · 141 vB</dd>
      <dt>To</dt><dd class="mono">{TR_ADDR[:24]}… <span style="font-weight: 500;">50,000 sat</span></dd>
      <dt>Change</dt><dd class="mono">{ADDR[:24]}… <span style="font-weight: 500;">199,859 sat</span> <span class="hint">back to this wallet</span></dd>
    </dl>
    <div style="display: flex; align-items: center; gap: 8px;">
      <span class="btn btn-sm">{icon("copy", 14)} Copy txid</span>
      <span class="btn btn-sm">{icon("external", 14)} Open in explorer</span>
      <span style="margin-left: auto; display: flex; align-items: center; gap: 8px;"><span class="hint">Bump to</span><span class="input mono" style="width: 56px; min-height: 28px; padding: 4px 8px; font-size: 12px; justify-content: flex-end;">2.4</span><span class="hint">sat/vB</span><span class="btn btn-sm btn-primary">{icon("refresh", 12, "#FFFFFF")} Bump fee</span></span>
    </div>
  </div>
</td></tr>"""
    return row + detail

hrows = "".join([
    _hrow("out", "e19f4a7d05…b2c8d4a0", "50,141",  "pending", "2 min ago", expanded=True),
    _hrow("out", "3b9d1e7f2a…b3c4d5e6", "150,141", "3",       "Today 14:02"),
    _hrow("in",  "7c02d8b1e4…9a6f0c3b", "120,000", "31",      "Aug 27"),
    _hrow("in",  "a41e9c2f7b…3d08e1f2", "250,000", "142",     "Aug 24"),
])

dash = page(head("Wallet", "Signet · P2WPKH (segwit) · signet-p2wpkh-3f0c9a1b") + f"""
<section class="card" style="gap: 8px;">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Balance</span>
    <div style="display: flex; align-items: center; gap: 8px;">
      <span class="hint">Last synced 14:32:07</span>
      <span class="btn">{icon("refresh", 16)} Sync</span>
      <span class="btn btn-primary">Send {icon("arrow", 16, "#FFFFFF")}</span>
    </div>
  </div>
  <div style="display: flex; align-items: baseline; gap: 8px;">
    <span class="mono" style="font-size: 32px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.1;">388,420</span>
    <span style="font-size: 14px; color: #6B6B66;">sat</span>
    <span class="mono" style="font-size: 13px; color: #6B6B66; margin-left: 8px;">0.00388420 BTC</span>
  </div>
  <div style="display: flex; gap: 32px;">
    <div style="display: flex; flex-direction: column; gap: 2px;"><span class="hint">Confirmed</span><span class="mono" style="font-size: 14px;">370,000</span></div>
    <div style="display: flex; flex-direction: column; gap: 2px;"><span class="hint">Pending</span><span class="mono" style="font-size: 14px; color: #6B6B66;">18,420</span></div>
  </div>
</section>
<section class="card">
  <span class="label">Receive</span>
  <div style="display: flex; gap: 16px; align-items: flex-start;">
    <div style="padding: 8px; background: #FFFFFF; border: 1px solid #E4E3DF; border-radius: 4px; flex: none;">{fake_qr(120)}</div>
    <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="input mono" style="flex: 1; background: #F4F4F2;">{ADDR}</span>
        <span class="btn">{icon("copy", 16)} Copy</span>
        <span class="btn">{icon("plus", 16)} New address</span>
      </div>
      {field("Request amount (optional)", '<div style="display: flex; gap: 4px; align-items: center;"><span class="input mono" style="width: 140px; justify-content: flex-end;">10,000</span><span class="chip on" style="min-height: 34px; padding: 6px 8px; font-size: 12px;">sat</span><span class="chip" style="min-height: 34px; padding: 6px 8px; font-size: 12px;">BTC</span><span class="hint mono" style="margin-left: 8px;">bitcoin:' + ADDR[:12] + '…?amount=0.0001</span></div>', "With an amount the QR is a bitcoin: link; without one it is the bare address.")}
    </div>
  </div>
</section>
<section class="card">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Unspent outputs</span>
    <span class="hint">3 outputs</span>
  </div>
  <table>
    <thead><tr><th>Outpoint</th><th>Address</th><th class="num">Value (sat)</th><th class="num">Conf.</th></tr></thead>
    <tbody>{trs}</tbody>
  </table>
</section>
<section class="card">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Transactions</span>
    <span class="hint">4 · newest first · click a row for detail</span>
  </div>
  <table>
    <thead><tr><th style="width: 24px;"></th><th>Txid</th><th class="num">Amount (sat)</th><th class="num">Conf.</th><th class="num">When</th><th class="num" style="width: 24px;"></th></tr></thead>
    <tbody>{hrows}</tbody>
  </table>
</section>
<section class="card">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Public keys</span>
    <span class="hint">Reveal your history, not your funds — for a watch-only copy elsewhere.</span>
  </div>
  <dl class="kv" style="margin: 0;">
    <dt>Account xpub</dt><dd class="mono" style="font-size: 12px; word-break: break-all;">{XPUB}</dd>
    <dt>Receive</dt><dd class="mono" style="font-size: 12px; word-break: break-all;">wpkh([a83832f2/84h/1h/0h]{XPUB[:18]}…{XPUB[-6:]}/0/*)#q4xp7va0</dd>
    <dt>Change</dt><dd class="mono" style="font-size: 12px; word-break: break-all;">wpkh([a83832f2/84h/1h/0h]{XPUB[:18]}…{XPUB[-6:]}/1/*)#v378jcm2</dd>
  </dl>
  <div style="display: flex; gap: 8px;">
    <span class="btn btn-sm">{icon("copy", 14)} Copy xpub</span>
    <span class="btn btn-sm">{icon("copy", 14)} Copy descriptors</span>
  </div>
</section>
<div style="display: flex; justify-content: space-between; align-items: center;">
  <div style="display: flex; gap: 8px; align-items: center;">
    <span class="btn">{icon("refresh", 16)} Rescan</span>
    <span class="seg"><span class="chip on" style="min-height: 34px; padding: 6px 10px; font-size: 12px;">gap 20</span><span class="chip" style="min-height: 34px; padding: 6px 10px; font-size: 12px;">100</span><span class="chip" style="min-height: 34px; padding: 6px 10px; font-size: 12px;">500</span></span>
    <span class="hint">Looks further past the last used address — for a restore that shows too little.</span>
  </div>
  <span class="btn btn-danger">Close wallet</span>
</div>""", step=2, minh=1520)

send = page(head("Send", f"From {ADDR}") + f"""
<section class="card">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Recipients</span>
    <span class="btn btn-sm" style="opacity: 0.45;">{icon("plus", 14)} Add recipient</span>
  </div>
  <div style="display: grid; grid-template-columns: 1fr 270px 34px; gap: 8px; align-items: start;">
    {field("Address", '<span class="input mono">' + TR_ADDR + '</span>')}
    {field("Amount", '<div style="display: flex; gap: 4px;"><span class="input mono" style="flex: 1; justify-content: flex-end;">411,859</span><span class="chip on" style="min-height: 34px; padding: 6px 8px; font-size: 12px;">sat</span><span class="chip" style="min-height: 34px; padding: 6px 8px; font-size: 12px;">BTC</span><span class="chip on" style="min-height: 34px; padding: 6px 8px; font-size: 12px; border-color: #C2410C; color: #C2410C;">Max</span></div>', "Everything: 412,000 sat minus the 141 sat fee. Editing the amount leaves Max. Max needs a single recipient.")}
    <span class="btn btn-quiet" style="width: 34px; padding: 0; margin-top: 22px;">{icon("x", 16, "#6B6B66")}</span>
  </div>
</section>
<section class="card">
  <span class="label">Fee</span>
  <div style="display: grid; grid-template-columns: max-content 160px 1fr; gap: 16px; align-items: end;">
    {field("Target", chips(["1 block","3 blocks","6 blocks"], "6 blocks"))}
    {field("Rate (sat/vB)", '<span class="input mono" style="justify-content: flex-end;">1.0</span>')}
    {field("Source", '<span class="hint" style="min-height: 34px; display: flex; align-items: center;">mempool.space estimate for 6 blocks · floor 1 sat/vB</span>')}
  </div>
</section>
<section class="card" style="border-color: #1A1A1A;">
  <span class="label">Review</span>
  <dl class="kv" style="margin: 0; font-size: 14px;">
    <dt>Total out</dt><dd class="mono">411,859 sat</dd>
    <dt>Fee</dt><dd class="mono">141 sat <span style="color: #6B6B66;">(141 vB · 1 in)</span></dd>
    <dt>Change</dt><dd class="mono">0 sat <span style="color: #6B6B66;">— nothing comes back</span></dd>
    <dt>Total spent</dt><dd class="mono" style="font-weight: 600;">412,000 sat</dd>
  </dl>
  <div style="display: flex; justify-content: flex-end; gap: 8px;">
    <span class="btn">Edit</span>
    <span class="btn btn-primary">Confirm &amp; broadcast</span>
  </div>
</section>""", step=2, minh=1000)

result = page(head("Sent", "Signet · mempool.space") + f'''
<section class="card" style="align-items: flex-start; gap: 16px; padding: 24px;">
  <div style="display: flex; align-items: center; gap: 12px;">
    <span style="width: 36px; height: 36px; border-radius: 50%; background: #F0FDF4; border: 1px solid #BBE5C8; display: inline-flex; align-items: center; justify-content: center;">{icon("check", 18, "#166534")}</span>
    <div style="display: flex; flex-direction: column; gap: 2px;">
      <span style="font-weight: 600; font-size: 16px;">Transaction broadcast</span>
      <span class="hint">It will show as pending until it confirms.</span>
    </div>
  </div>
  <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
    <span class="label">Transaction id</span>
    <div style="display: flex; align-items: center; gap: 8px;">
      <span class="input mono" style="flex: 1; background: #F4F4F2; font-size: 13px;">3b9d1e7f2a64c05d8e1f9a2b7c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6</span>
      <span class="btn">{icon("copy", 16)} Copy</span>
    </div>
    <span class="hint mono">https://mempool.space/signet/tx/3b9d1e7f…d5e6</span>
  </div>
  <div style="display: flex; gap: 8px;">
    <span class="btn btn-primary">{icon("external", 16, "#FFFFFF")} Open in explorer</span>
    <span class="btn">Back to wallet</span>
  </div>
</section>''', step=2)

def mark(size, r):
    return f'''<svg width="{size}" height="{size}" viewBox="0 0 512 512" aria-hidden="true">
  <rect width="512" height="512" rx="{r}" fill="#C2410C"></rect>
  <circle cx="256" cy="204" r="112" fill="none" stroke="#FAFAF9" stroke-width="48"></circle>
  <path d="M206 296h100L342 448H170z" fill="#FAFAF9"></path>
</svg>'''
iconboard = HEAD + f'''<div style="width: 720px; min-height: 480px; background: #FAFAF9; padding: 32px; box-sizing: border-box; display: flex; flex-direction: column; gap: 24px;">
  <div style="display: flex; align-items: baseline; justify-content: space-between;">
    <h1 style="margin: 0; font-size: 20px; font-weight: 600;">App icon</h1>
    <p style="margin: 0; font-size: 12px; color: #6B6B66;">Keyhole-in-coin mark · terracotta on warm white</p>
  </div>
  <div style="display: flex; gap: 32px; align-items: flex-end;">
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">{mark(256, 58)}<span class="hint">macOS · 256</span></div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">{mark(128, 29)}<span class="hint">128</span></div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">{mark(64, 14)}<span class="hint">64</span></div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">{mark(32, 7)}<span class="hint">32</span></div>
    <div style="display: flex; flex-direction: column; gap: 8px; align-items: center;">{mark(16, 4)}<span class="hint">16</span></div>
  </div>
  <div style="display: flex; gap: 16px;">
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 1px solid #E4E3DF; border-radius: 4px; background: #FFFFFF;">{mark(40, 9)}<span style="font-weight: 500;">Bitcoin Wallet</span></div>
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 4px; background: #131312; color: #ECEAE4;">{mark(40, 9)}<span style="font-weight: 500;">Bitcoin Wallet</span></div>
  </div>
</div>
''' + TAIL

# ---------------------------------------------------------------- mobile
#
# 390x844 is the iPhone 14/15/16 logical size and close enough to a modern
# Android phone. Same palette and type as the desktop boards; everything else
# is re-scaled for a thumb: 48px controls, 16px input text (below that iOS
# zooms the page on focus), 12px card radius, 999px chips. The status bar,
# bottom tab bar and home indicator are drawn in so the usable height is
# judged honestly rather than assumed.

MOBILE_CSS = '''
    .m-frame { width: 390px; height: 844px; background: #FAFAF9; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; position: relative; }
    .m-status { flex: none; height: 54px; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 24px 6px; font-size: 15px; font-weight: 600; }
    .m-sig { display: flex; gap: 6px; align-items: center; }
    .m-head { flex: none; min-height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 6px; }
    .m-head h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    .m-ico { width: 44px; height: 44px; flex: none; display: inline-flex; align-items: center; justify-content: center; }
    .m-body { flex: 1; min-height: 0; padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
    .m-card { background: #FFFFFF; border: 1px solid #E4E3DF; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .m-hero { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; font-size: 34px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.1; }
    .m-sub { font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; font-size: 15px; color: #6B6B66; }
    .m-btn { flex: 1; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid #E4E3DF; border-radius: 12px; background: #FFFFFF; color: #1A1A1A; font-size: 16px; font-weight: 500; box-sizing: border-box; }
    .m-btn-primary { background: #C2410C; border-color: #C2410C; color: #FFFFFF; }
    .m-btn-quiet { border-color: transparent; background: transparent; color: #6B6B66; }
    .m-btn-danger { color: #B91C1C; }
    .m-input { min-height: 48px; display: flex; align-items: center; padding: 0 14px; border: 1px solid #E4E3DF; border-radius: 12px; background: #FFFFFF; font-size: 16px; box-sizing: border-box; }
    .m-input.placeholder { color: #A19F97; }
    .m-chip { min-height: 40px; display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; border: 1px solid #E4E3DF; border-radius: 999px; background: #FFFFFF; font-size: 15px; }
    .m-chip.on { border-color: #1A1A1A; background: #F4F4F2; font-weight: 500; }
    .m-chip.on .dot { border: 4px solid #C2410C; }
    .m-tabs { flex: none; height: 83px; border-top: 1px solid #E4E3DF; background: #FFFFFF; display: flex; padding-bottom: 21px; }
    .m-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #6B6B66; font-size: 11px; font-weight: 500; }
    .m-tab.on { color: #C2410C; }
    .m-txrow { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid #E4E3DF; }
    .m-txrow:last-child { border-bottom: none; }
    .m-dirdot { width: 36px; height: 36px; flex: none; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: #F4F4F2; }
    .m-amt { margin-left: auto; text-align: right; font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; font-size: 15px; font-weight: 500; }
    .m-home { position: absolute; left: 50%; transform: translateX(-50%); bottom: 8px; width: 140px; height: 5px; border-radius: 3px; background: rgba(26,26,26,0.18); }
    .m-word { display: flex; align-items: center; gap: 8px; padding: 9px 10px; background: #F4F4F2; border-radius: 8px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid #E4E3DF; border-radius: 999px; background: #F4F4F2; font-size: 12px; color: #6B6B66; }
    .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: #166534; }
    .m-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; min-height: 48px; box-sizing: border-box; border-bottom: 1px solid #E4E3DF; font-size: 16px; }
    .m-item:last-child { border-bottom: none; }
    .m-item .v { display: flex; align-items: center; gap: 6px; font-size: 15px; color: #6B6B66; }
    .m-err { font-size: 13px; color: #B91C1C; }
    .m-input.err { border-color: #B91C1C; }
    .m-lede { margin: 0; font-size: 15px; line-height: 1.5; color: #6B6B66; }
'''

MHEAD = HEAD.replace("  </style>", MOBILE_CSS + "  </style>")

def m_status():
    bars = '<svg width="17" height="11" viewBox="0 0 17 11" aria-hidden="true"><rect x="0" y="7" width="3" height="4" rx="1" fill="#1A1A1A"></rect><rect x="4.7" y="5" width="3" height="6" rx="1" fill="#1A1A1A"></rect><rect x="9.4" y="2.5" width="3" height="8.5" rx="1" fill="#1A1A1A"></rect><rect x="14" y="0" width="3" height="11" rx="1" fill="#1A1A1A"></rect></svg>'
    batt = '<svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true"><rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="#1A1A1A" stroke-opacity="0.35"></rect><rect x="2" y="2" width="16" height="8" rx="1.5" fill="#1A1A1A"></rect><path d="M23 4.2v3.6a2 2 0 0 0 0-3.6z" fill="#1A1A1A" fill-opacity="0.35"></path></svg>'
    return f'<div class="m-status"><span>9:41</span><span class="m-sig">{bars}{batt}</span></div>'

def m_head(title, left=None, right=None):
    l = f'<span class="m-ico">{icon(left, 24)}</span>' if left else '<span class="m-ico"></span>'
    r = f'<span class="m-ico">{icon(right, 24)}</span>' if right else '<span class="m-ico"></span>'
    return f'<div class="m-head">{l}<h1>{title}</h1>{r}</div>'

def m_tabs(active):
    out = []
    for name, label in (("wallet", "Wallet"), ("scan", "Scan"), ("gear", "Settings")):
        on = " on" if label == active else ""
        out.append(f'<span class="m-tab{on}">{icon(name, 24, "#C2410C" if label == active else "#6B6B66")}<span>{label}</span></span>')
    return '<div class="m-tabs">' + "".join(out) + '</div><div class="m-home"></div>'

def phone(body, tabs=None):
    return MHEAD + f'<div class="m-frame">{m_status()}{body}' + (m_tabs(tabs) if tabs else '<div class="m-home"></div>') + '</div>' + TAIL

def m_tx(dirn, amt, meta, when, chevron=False):
    up = dirn == "out"
    glyph = icon("up" if up else "down", 18, "#B45309" if up else "#166534")
    color = "#1A1A1A" if up else "#166534"
    ch = f'<span style="flex:none;display:inline-flex;margin-left:4px;">{icon("chevron", 16, "#A19F97")}</span>' if chevron else ""
    return f'''<div class="m-txrow">
  <span class="m-dirdot">{glyph}</span>
  <span style="display:flex;flex-direction:column;gap:2px;min-width:0;">
    <span style="font-size:15px;font-weight:500;">{"Sent" if up else "Received"}</span>
    <span style="font-size:13px;color:#6B6B66;">{meta} · {when}</span>
  </span>
  <span class="m-amt" style="color:{color};">{amt}<br><span style="font-size:12px;color:#A19F97;font-weight:400;">sat</span></span>{ch}
</div>'''

def m_words(words, blanks=()):
    cells = []
    for i, w in enumerate(words, 1):
        inner = ('<span style="flex:1;height:22px;border-bottom:1.5px solid #C2410C;"></span>' if i in blanks
                 else f'<span style="font-size:15px;font-weight:500;">{w}</span>')
        cells.append(f'<div class="m-word"><span class="mono" style="font-size:12px;color:#A19F97;width:16px;flex:none;">{i}</span>{inner}</div>')
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + "".join(cells) + '</div>'

def m_dot():
    return '<span class="dot"></span>'

def m_item(k, v=None, chevron=True, color=None):
    ch = icon("chevron", 17, "#A19F97") if chevron else ""
    st = f' style="color:{color};"' if color else ""
    return f'<div class="m-item"><span{st}>{k}</span><span class="v">{v if v is not None else ""}{ch}</span></div>'

def m_list(*items):
    return '<div class="m-card" style="gap:0;padding:0;">' + "".join(items) + '</div>'

msetup = phone(f'''{m_head("Setup")}
<div class="m-body">
  <p style="margin:0;font-size:15px;color:#6B6B66;">Which chain, and where to read it from. Both can change later.</p>
  <div class="m-card">
    <span class="label">Network</span>
    <div style="display:flex;flex-wrap:wrap;gap:8px;"><span class="m-chip on">{m_dot()}Signet</span><span class="m-chip">{m_dot()}Testnet4</span><span class="m-chip">{m_dot()}Mainnet</span></div>
  </div>
  <div class="m-card">
    <span class="label">Esplora server</span>
    <span class="m-input mono" style="font-size:14px;">https://mempool.space/signet/api</span>
  </div>
  <div class="m-card">
    <span class="label">Address type</span>
    <div style="display:flex;flex-wrap:wrap;gap:8px;"><span class="m-chip on">{m_dot()}Native segwit</span><span class="m-chip">{m_dot()}Taproot</span></div>
  </div>
  <div style="margin-top:auto;display:flex;"><span class="m-btn m-btn-primary">Continue</span></div>
</div>''')

mkey = phone(f"""{m_head("Start a wallet", left="back")}
<div class="m-body" style="gap:12px;">
  <div class="m-card" style="gap:8px;">
    <span style="font-size:17px;font-weight:600;">New wallet</span>
    <span style="font-size:14px;color:#6B6B66;line-height:1.5;">Generates a 12-word recovery phrase. Write it down — it is the only way back in.</span>
    <span class="m-btn m-btn-primary" style="flex:none;">Create new wallet</span>
  </div>
  <div class="m-card" style="gap:8px;">
    <span style="font-size:17px;font-weight:600;">Restore</span>
    <span style="font-size:14px;color:#6B6B66;line-height:1.5;">Already have a recovery phrase from this or another wallet.</span>
    <span class="m-btn" style="flex:none;">Restore from phrase</span>
  </div>
  <div class="m-card" style="gap:8px;">
    <span style="font-size:17px;font-weight:600;">Watch-only</span>
    <span style="font-size:14px;color:#6B6B66;line-height:1.5;">Follow a wallet by its xpub or descriptor. It shows balance and history and can receive, but cannot send.</span>
    <span class="m-btn" style="flex:none;">{icon("eye", 19)} Add watch-only wallet</span>
  </div>
  <div style="margin-top:auto;display:flex;"><span class="m-btn m-btn-quiet">Advanced: use a single key</span></div>
</div>""")

mcreate = phone(f'''{m_head("Recovery phrase", left="back")}
<div class="m-body" style="gap:12px;">
  <p style="margin:0;font-size:14px;color:#6B6B66;line-height:1.5;">Write these 12 words down in order and keep them offline. Anyone with them owns this wallet.</p>
  {m_words(WORDS)}
  <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#FFF7ED;border:1px solid #E4E3DF;border-radius:12px;">
    <span style="width:18px;height:18px;border:1.5px solid #A19F97;border-radius:4px;flex:none;"></span>
    <span style="font-size:14px;">I have written them down</span>
  </div>
  <div style="margin-top:auto;display:flex;"><span class="m-btn m-btn-primary">Continue</span></div>
</div>''')

mrestore = phone(f'''{m_head("Restore wallet", left="back")}
<div class="m-body" style="gap:12px;">
  <div style="display:flex;gap:8px;"><span class="m-chip on">12 words</span><span class="m-chip">24 words</span></div>
  {m_words(WORDS[:6] + ["", "", "", "", "", ""], blanks=(7, 8, 9, 10, 11, 12))}
  <span style="font-size:13px;color:#6B6B66;">Each word is checked against the BIP39 list as you type.</span>
  <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;">
    <span class="m-btn m-btn-quiet" style="flex:none;">Add a passphrase (optional)</span>
    <span class="m-btn m-btn-primary" style="flex:none;opacity:0.45;">Restore</span>
  </div>
</div>''')

munlock = phone(f"""<div class="m-body" style="justify-content:center;align-items:center;gap:18px;padding:0 24px 32px;">
  <span style="width:76px;height:76px;border-radius:999px;background:#FFFFFF;border:1px solid #E4E3DF;display:flex;align-items:center;justify-content:center;">{icon("faceid", 36, "#C2410C")}</span>
  <div style="display:flex;flex-direction:column;gap:6px;align-items:center;text-align:center;">
    <span style="font-size:20px;font-weight:600;">Unlock wallet</span>
    <span class="mono" style="font-size:13px;color:#6B6B66;">{ADDR[:14]}…{ADDR[-6:]}</span>
    <span style="font-size:13px;color:#6B6B66;">Signet · native segwit</span>
  </div>
  <div style="width:100%;display:flex;flex-direction:column;gap:10px;">
    <span class="m-btn m-btn-primary" style="flex:none;">{icon("faceid", 20, "#FFFFFF")} Unlock with Face ID</span>
    <span class="m-btn m-btn-quiet" style="flex:none;">Use a different wallet</span>
  </div>
  <div class="m-card" style="width:100%;box-sizing:border-box;border-color:#B91C1C;gap:10px;">
    <span style="font-size:15px;line-height:1.5;color:#6B6B66;">The saved key and this device's copy of the wallet history will be deleted. Your recovery phrase still restores it.</span>
    <span class="m-btn m-btn-danger" style="flex:none;">Delete it</span>
    <span class="m-btn m-btn-quiet" style="flex:none;">Keep it</span>
  </div>
</div>""")

mwallet = phone(f"""{m_head("Wallet", right="gear")}
<div class="m-body" style="gap:14px;">
  <div class="m-card" style="gap:6px;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="display:flex;gap:6px;"><span class="pill"><span class="pill-dot"></span>Signet · HD</span></span>
      <span style="display:flex;align-items:center;gap:5px;font-size:12px;color:#6B6B66;">{icon("refresh", 13, "#6B6B66")} Synced 14:32</span>
    </div>
    <span class="m-hero">412,000</span>
    <span class="m-sub">0.00412000 BTC</span>
    <span style="font-size:13px;color:#B45309;">18,420 sat pending</span>
  </div>
  <div style="display:flex;gap:10px;">
    <span class="m-btn m-btn-primary">{icon("up", 19, "#FFFFFF")} Send</span>
    <span class="m-btn">{icon("down", 19)} Receive</span>
  </div>
  <div class="m-card" style="gap:0;padding:4px 16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0 4px;">
      <span class="label">Transactions</span><span style="font-size:13px;color:#6B6B66;">3 · newest first</span>
    </div>
    {m_tx("out", "−50,141", "Pending", "2 min ago", chevron=True)}
    {m_tx("in", "+120,000", "3 confirmations", "Aug 30", chevron=True)}
    {m_tx("in", "+342,000", "12 confirmations", "Aug 28", chevron=True)}
  </div>
</div>""", tabs="Wallet")

mreceive = phone(f"""{m_head("Receive", left="back")}
<div class="m-body" style="gap:12px;">
  <div class="m-card" style="align-items:center;gap:12px;">
    <div style="padding:10px;background:#FFFFFF;border-radius:12px;">{fake_qr(190)}</div>
    <span class="mono" style="font-size:12px;text-align:center;word-break:break-all;line-height:1.6;">{ADDR}</span>
    <span class="mono" style="font-size:12px;color:#6B6B66;text-align:center;word-break:break-all;">bitcoin:{ADDR[:10]}…?amount=0.0001</span>
  </div>
  <div style="display:flex;gap:10px;">
    <span class="m-btn">{icon("copy", 19)} Copy</span>
    <span class="m-btn">{icon("plus", 19)} New address</span>
  </div>
  <div class="m-card" style="gap:8px;">
    <span class="label">Request an amount <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></span>
    <div style="display:flex;gap:8px;">
      <span class="m-input mono" style="flex:1;font-size:18px;">10,000</span>
      <span style="display:flex;gap:4px;flex:none;"><span class="m-chip on" style="min-height:48px;">sat</span><span class="m-chip" style="min-height:48px;">BTC</span></span>
    </div>
    <span class="hint">The QR becomes a bitcoin: link with the amount filled in.</span>
  </div>
</div>""", tabs="Wallet")

msend = phone(f"""{m_head("Send", left="back")}
<div class="m-body" style="gap:12px;">
  <div class="m-card" style="gap:8px;">
    <span class="label">To</span>
    <div style="display:flex;gap:8px;">
      <span class="m-input mono err" style="flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4</span>
      <span class="m-btn" style="flex:none;width:48px;padding:0;">{icon("scan", 22)}</span>
    </div>
    <span class="m-err">Not a Signet address — this one is for Bitcoin mainnet.</span>
  </div>
  <div class="m-card" style="gap:8px;">
    <span class="label">Amount</span>
    <div style="display:flex;gap:8px;">
      <span class="m-input mono err" style="flex:1;font-size:18px;min-width:0;">0.123456789</span>
      <span style="display:flex;gap:4px;flex:none;"><span class="m-chip" style="min-height:48px;">sat</span><span class="m-chip on" style="min-height:48px;">BTC</span><span class="m-chip" style="min-height:48px;">Max</span></span>
    </div>
    <span class="m-err">BTC has 8 decimals at most — 1 sat is 0.00000001.</span>
  </div>
  <div class="m-card">
    <span class="label">Fee</span>
    <div style="display:flex;gap:6px;"><span class="m-chip" style="padding:0 12px;font-size:14px;">1 block</span><span class="m-chip" style="padding:0 12px;font-size:14px;">3 blocks</span><span class="m-chip" style="padding:0 12px;font-size:14px;">6 blocks</span><span class="m-chip on" style="padding:0 12px;font-size:14px;">Custom</span></div>
    <div style="display:flex;gap:8px;align-items:center;"><span class="m-input mono" style="width:120px;">2.4</span><span style="font-size:15px;color:#6B6B66;">sat/vB · floor 1</span></div>
  </div>
  <div style="margin-top:auto;display:flex;"><span class="m-btn m-btn-primary" style="opacity:0.45;">Review</span></div>
</div>""")

msendmax = phone(f"""{m_head("Send", left="back")}
<div class="m-body" style="gap:12px;">
  <div class="m-card">
    <span class="label">To</span>
    <div style="display:flex;gap:8px;">
      <span class="m-input mono" style="flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{TR_ADDR}</span>
      <span class="m-btn" style="flex:none;width:48px;padding:0;">{icon("scan", 22)}</span>
    </div>
  </div>
  <div class="m-card">
    <span class="label">Amount</span>
    <div style="display:flex;gap:8px;">
      <span class="m-input mono" style="flex:1;font-size:18px;min-width:0;">411,859</span>
      <span style="display:flex;gap:4px;flex:none;"><span class="m-chip on" style="min-height:48px;">sat</span><span class="m-chip" style="min-height:48px;">BTC</span><span class="m-chip on" style="min-height:48px;border-color:#C2410C;color:#C2410C;">Max</span></span>
    </div>
    <span style="font-size:13px;color:#6B6B66;">Everything: 412,000 sat minus the 141 sat fee. Edit the amount to leave Max.</span>
  </div>
  <div class="m-card">
    <span class="label">Fee</span>
    <div style="display:flex;gap:6px;"><span class="m-chip" style="padding:0 12px;font-size:14px;">1 block</span><span class="m-chip on" style="padding:0 12px;font-size:14px;">3 blocks</span><span class="m-chip" style="padding:0 12px;font-size:14px;">6 blocks</span><span class="m-chip" style="padding:0 12px;font-size:14px;">Custom</span></div>
    <span style="font-size:13px;color:#6B6B66;">1.0 sat/vB · 141 sat</span>
  </div>
  <div class="m-card" style="border-color:#1A1A1A;gap:8px;">
    <span class="label">Review</span>
    <div style="display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:15px;">
      <span style="color:#6B6B66;">Amount</span><span class="mono">411,859 sat</span>
      <span style="color:#6B6B66;">Fee</span><span class="mono">141 sat · 141 vB</span>
      <span style="color:#6B6B66;">Change</span><span class="mono">0 sat</span>
      <span style="color:#6B6B66;font-weight:600;">Total</span><span class="mono" style="font-weight:600;">412,000 sat</span>
    </div>
  </div>
  <div style="margin-top:auto;display:flex;"><span class="m-btn m-btn-primary">Confirm and send</span></div>
</div>""")

mscan = phone(f'''<div style="flex:1;position:relative;background:#131312;display:flex;flex-direction:column;">
  <div class="m-head" style="color:#ECEAE4;"><span class="m-ico">{icon("x", 24, "#ECEAE4")}</span><h1 style="color:#ECEAE4;">Scan</h1><span class="m-ico"></span></div>
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;">
    <div style="position:relative;width:250px;height:250px;">
      <span style="position:absolute;inset:0;border-radius:20px;background:rgba(236,234,228,0.05);"></span>
      <span style="position:absolute;left:0;top:0;width:44px;height:44px;border-top:3px solid #C2410C;border-left:3px solid #C2410C;border-radius:20px 0 0 0;"></span>
      <span style="position:absolute;right:0;top:0;width:44px;height:44px;border-top:3px solid #C2410C;border-right:3px solid #C2410C;border-radius:0 20px 0 0;"></span>
      <span style="position:absolute;left:0;bottom:0;width:44px;height:44px;border-bottom:3px solid #C2410C;border-left:3px solid #C2410C;border-radius:0 0 0 20px;"></span>
      <span style="position:absolute;right:0;bottom:0;width:44px;height:44px;border-bottom:3px solid #C2410C;border-right:3px solid #C2410C;border-radius:0 0 20px 0;"></span>
    </div>
    <span style="color:#ECEAE4;font-size:15px;">Point at an address or bitcoin: QR</span>
  </div>
  <div style="padding:0 16px 28px;display:flex;"><span class="m-btn" style="background:rgba(236,234,228,0.12);border-color:transparent;color:#ECEAE4;">Paste from clipboard</span></div>
</div>''', tabs="Scan")

msettings = phone(f"""{m_head("Settings")}
<div class="m-body" style="gap:12px;">
  {m_list(m_item("Network", "Signet"), m_item("Esplora server", "mempool.space"), m_item("Address type", "Native segwit"))}
  <div class="m-card" style="gap:0;padding:0;">
    <div class="m-item" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;"><span>Rescan the chain</span><span class="v">gap</span></div>
      <div style="display:flex;gap:8px;align-items:center;"><span class="m-chip on">20</span><span class="m-chip">100</span><span class="m-chip">500</span><span class="m-btn" style="min-height:40px;margin-left:auto;flex:none;padding:0 14px;">{icon("refresh", 16)} Rescan</span></div>
      <span class="hint">For a restored wallet that shows less than it should.</span>
    </div>
    {m_item("Export public keys", "xpub · descriptors")}
  </div>
  {m_list(m_item("Wallet", "Recovery phrase (HD)", chevron=False), m_item("Remembered on this device", "Yes", chevron=False))}
  {m_list(m_item("Close wallet", None, chevron=False))}
  <span class="m-btn m-btn-danger" style="margin-top:auto;flex:none;">Forget this wallet</span>
  <span class="mono" style="text-align:center;font-size:12px;color:#A19F97;">signet-p2wpkh-a83832f28a8b4e14</span>
</div>""", tabs="Settings")

# ---------------------------------------------------------------- mobile: new boards (round 3)

mtx = phone(f"""{m_head("Transaction", left="back")}
<div class="m-body" style="gap:10px;">
  <div class="m-card" style="align-items:center;gap:4px;padding:12px 16px;">
    <span class="m-dirdot" style="width:44px;height:44px;">{icon("up", 22, "#B45309")}</span>
    <span class="m-hero" style="font-size:30px;">−50,141 <span style="font-size:15px;color:#A19F97;font-weight:400;">sat</span></span>
    <span class="pill"><span class="pill-dot" style="background:#B45309;"></span>Pending · seen 2 min ago</span>
  </div>
  {m_list(m_item("Fee", "141 sat · 1.0 sat/vB · 141 vB", chevron=False), m_item("Confirmations", "0 — in the mempool", chevron=False))}
  {m_list(m_item("To", TR_ADDR[:8] + "…" + TR_ADDR[-6:] + " · 50,000 sat", chevron=False), m_item("Change", ADDR[:8] + "…" + ADDR[-6:] + " · 199,859 sat", chevron=False))}
  <div class="m-card" style="gap:8px;">
    <span class="label">Transaction id</span>
    <span class="mono" style="font-size:12px;word-break:break-all;line-height:1.6;color:#6B6B66;">{TXID}</span>
    <div style="display:flex;gap:8px;">
      <span class="m-btn" style="min-height:44px;">{icon("copy", 18)} Copy</span>
      <span class="m-btn" style="min-height:44px;">{icon("external", 18)} Explorer</span>
    </div>
  </div>
  <div class="m-card" style="border-color:#C2410C;gap:10px;">
    <div style="display:flex;align-items:center;justify-content:space-between;"><span class="label" style="color:#9A3412;">Bump fee</span><span class="hint">1-block estimate 2.4 sat/vB</span></div>
    <div style="display:flex;gap:8px;align-items:center;"><span class="m-input mono" style="flex:1;">2.4</span><span style="font-size:15px;color:#6B6B66;">sat/vB</span></div>
    <span class="m-btn m-btn-primary" style="flex:none;">Bump to 2.4 sat/vB</span>
  </div>
</div>""")

mexport = phone(f"""{m_head("Public keys", left="back")}
<div class="m-body" style="gap:12px;">
  <p class="m-lede">These reveal your history, not your funds. Share them only with a watch-only wallet you trust.</p>
  <div class="m-card" style="align-items:center;gap:10px;">
    <span class="label" style="align-self:flex-start;">Account xpub · m/84'/1'/0'</span>
    <div style="padding:10px;background:#FFFFFF;border-radius:12px;">{fake_qr(150)}</div>
    <span class="mono" style="font-size:12px;word-break:break-all;line-height:1.6;color:#6B6B66;">{XPUB}</span>
    <span class="m-btn" style="min-height:44px;align-self:stretch;">{icon("copy", 18)} Copy xpub</span>
  </div>
  <div class="m-card" style="gap:8px;">
    <span class="label">Receive descriptor</span>
    <span class="mono" style="font-size:12px;word-break:break-all;line-height:1.6;color:#6B6B66;">wpkh([a83832f2/84h/1h/0h]{XPUB[:18]}…{XPUB[-6:]}/0/*)#q4xp7va0</span>
    <span class="label" style="margin-top:4px;">Change descriptor</span>
    <span class="mono" style="font-size:12px;word-break:break-all;line-height:1.6;color:#6B6B66;">wpkh([a83832f2/84h/1h/0h]{XPUB[:18]}…{XPUB[-6:]}/1/*)#v378jcm2</span>
    <div style="display:flex;gap:8px;"><span class="m-btn" style="min-height:44px;">{icon("copy", 18)} Copy both</span></div>
  </div>
</div>""")

files = {"Setup.dc.html": setup, "Key.dc.html": key, "Main.dc.html": dash, "Send.dc.html": send, "Sent.dc.html": result, "Unlock.dc.html": unlock, "Create.dc.html": create, "Restore.dc.html": restore, "Icon.dc.html": iconboard,
         "MSetup.dc.html": msetup, "MKey.dc.html": mkey, "MCreate.dc.html": mcreate, "MRestore.dc.html": mrestore, "MUnlock.dc.html": munlock,
         "MWallet.dc.html": mwallet, "MReceive.dc.html": mreceive, "MSend.dc.html": msend, "MScan.dc.html": mscan, "MSettings.dc.html": msettings,
         "MTx.dc.html": mtx, "MExport.dc.html": mexport, "MSendMax.dc.html": msendmax}
for n, c in files.items(): pathlib.Path(n).write_text(c)

canvas = {
  "artboards": [
    {"file": "Setup.dc.html", "title": "1 · Setup", "x": 0, "y": 0, "w": 960, "h": 640},
    {"file": "Key.dc.html", "title": "2 · Key", "x": 1040, "y": 0, "w": 960, "h": 840},
    {"file": "Main.dc.html", "title": "3 · Wallet", "x": 2080, "y": 0, "w": 960, "h": 1520},
    {"file": "Send.dc.html", "title": "4 · Send + Review", "x": 0, "y": 1200, "w": 960, "h": 1000},
    {"file": "Sent.dc.html", "title": "5 · Sent", "x": 1040, "y": 1200, "w": 960, "h": 640},
    {"file": "Icon.dc.html", "title": "App icon", "x": 2080, "y": 1660, "w": 720, "h": 480},
    {"file": "Unlock.dc.html", "title": "2b · Unlock (returning user)", "x": 0, "y": 2320, "w": 960, "h": 640},
    {"file": "Create.dc.html", "title": "2c · New wallet (recovery phrase)", "x": 1040, "y": 2320, "w": 960, "h": 760},
    {"file": "Restore.dc.html", "title": "2d · Restore wallet", "x": 2080, "y": 2320, "w": 960, "h": 700},
    # Mobile row 1 — getting in. 390x844, spaced 470/964 so the name strips and
    # tweak chips above each frame never collide.
    {"file": "MSetup.dc.html", "title": "M1 · Setup", "x": 0, "y": 3400, "w": 390, "h": 844},
    {"file": "MKey.dc.html", "title": "M2 · Start a wallet", "x": 470, "y": 3400, "w": 390, "h": 844},
    {"file": "MCreate.dc.html", "title": "M3 · Recovery phrase", "x": 940, "y": 3400, "w": 390, "h": 844},
    {"file": "MRestore.dc.html", "title": "M4 · Restore", "x": 1410, "y": 3400, "w": 390, "h": 844},
    {"file": "MUnlock.dc.html", "title": "M5 · Unlock", "x": 1880, "y": 3400, "w": 390, "h": 844},
    # Mobile row 2 — using it.
    {"file": "MWallet.dc.html", "title": "M6 · Wallet (home)", "x": 0, "y": 4364, "w": 390, "h": 844},
    {"file": "MReceive.dc.html", "title": "M7 · Receive", "x": 470, "y": 4364, "w": 390, "h": 844},
    {"file": "MSend.dc.html", "title": "M8 · Send", "x": 940, "y": 4364, "w": 390, "h": 844},
    {"file": "MScan.dc.html", "title": "M9 · Scan", "x": 1410, "y": 4364, "w": 390, "h": 844},
    {"file": "MSettings.dc.html", "title": "M10 · Settings", "x": 1880, "y": 4364, "w": 390, "h": 844},
    # Mobile row 3 — round 3: what a finished wallet still needed.
    {"file": "MTx.dc.html", "title": "M11 · Transaction", "x": 0, "y": 5328, "w": 390, "h": 844},
    {"file": "MExport.dc.html", "title": "M12 · Public keys", "x": 470, "y": 5328, "w": 390, "h": 844},
    {"file": "MSendMax.dc.html", "title": "M8b · Send (Max)", "x": 940, "y": 5328, "w": 390, "h": 844},
  ],
  "annotations": [
    {"id": "round3-brief", "x": 0, "y": 5100, "w": 700, "text": "ROUND 3 — finishing the wallet. One batch, please review it all at once.\n\nNEW: M11 Transaction (tap any history row; fee bump lives here now, so a stuck send is fixable from a phone) · M12 Public keys (xpub + descriptors, for a watch-only copy elsewhere) · M8b Send in Max state (Max now asks the core to drain, so the amount shown is exactly what leaves).\n\nUPDATED: M2 Key gains Watch-only · M5 Unlock gets the two-step Forget the phone was missing · M6 Wallet rows are tappable and show pending sats · M7 Receive can request an amount (QR becomes a bitcoin: link) · M8 Send shows inline errors and a Custom fee rate · M10 Settings rows open Setup (after a 'this closes the wallet' confirm, same block as Forget), plus Rescan and Export.\n\nDesktop: 3 Wallet gets a receive QR + amount, click-to-expand tx detail with the bump inside, a Public keys card and Rescan; 4 Send shows Max state; 2 Key gains Watch-only.\n\nNothing else moved. Same tokens throughout."},
    {"id": "round3-tx-note", "x": 1410, "y": 5328, "w": 380, "text": "M11 — what the row knows\n\nEverything comes from the wallet's own view of the tx: fee and rate (null when an input is not ours, then the row just omits them), which outputs are ours (Change), confirmations from the local tip.\n\nBump card appears only for an unconfirmed OUTGOING tx. Rate is prefilled from the 1-block estimate; the node rejects a bump below the replacement minimum and we show its wording."},
    {"id": "round3-export-note", "x": 1410, "y": 5640, "w": 380, "text": "M12 — public, not secret\n\nThe xpub and descriptors let another wallet follow this one (balance, history, receiving) without being able to spend. They do reveal the whole address history, hence the lede.\n\nSingle-key wallets show one descriptor and no xpub."},
    {"id": "round3-max-note", "x": 1410, "y": 5900, "w": 380, "text": "M8b — Max is a mode, not a number\n\nTapping Max needs the address first (the exact size depends on it), then asks the core to build a drain: the amount field fills with what actually leaves and Review's Change is 0. Editing the amount drops out of Max. Same on desktop 4."},
    {"id": "round3-mobile-updates", "x": 2350, "y": 4760, "w": 400, "text": "Round 3 changes to existing phone boards\n\nM5 Unlock — the red card is what appears after tapping Forget this wallet (the button sits where the card is). Delete it / Keep it, like Settings already does.\n\nM6 Wallet — hero is total incl. pending (matches desktop now; the two disagreed). Rows open M11.\n\nM7 Receive — Copy + New address (Share was never built). Amount is optional.\n\nM8 Send — errors inline under the field, wording shared with desktop. Custom fee chip reveals a sat/vB field.\n\nM10 Settings — Network / Esplora / Address type rows open a confirm ('Changing this closes the wallet') then Setup. Unit and Show-phrase rows removed: neither exists."},
    {"id": "round3-desktop-note", "x": 3120, "y": 320, "w": 380, "text": "Round 3 on desktop 3 · Wallet\n\nReceive card: QR beside the address, optional amount → bitcoin: link.\n\nTransactions: click a row to expand it in place (first row shown open). Bump fee moved into the expansion.\n\nPublic keys card + Rescan (gap 20 / 100 / 500) at the bottom. Rescan exists because a restored wallet that used more than 20 addresses in a row shows too little until it looks further."},
    {"id": "hd-note", "x": 3120, "y": 2320, "w": 400, "text": "Roadmap 6 - HD wallet\n\nKey screen becomes a choice: New wallet (BIP39 phrase), Restore wallet, or Advanced: single key (what the app does today).\n\nNew wallet shows the 12 words once, then makes you fill three back in before it will continue. Restore validates each word against the BIP39 list and can take an optional passphrase.\n\nOnce HD, the dashboard's receive address is the next UNUSED one and change goes to a separate internal keychain."},
    {"id": "bump-note", "x": 3120, "y": 1180, "w": 380, "text": "Roadmap 7 + 8\n\nHistory: an unconfirmed OUTGOING row gets a \"Bump fee\" button (BDK signals RBF on everything we build). Confirmed and incoming rows show nothing.\n\nSend: amount takes sat or BTC via the unit chips; \"Max\" fills the spendable balance minus fee. An address that fails validation turns the field red with the reason underneath, and Review stays disabled."},
    {"id": "history-note", "x": 3120, "y": 0, "w": 380, "text": "Roadmap item 4 — Transaction history\n\nNew \"Transactions\" card under Unspent outputs: direction arrow (in = green, down; out = up), short txid, signed net amount (sent amounts include the fee), confirmations, relative/short date. Newest first. Click a row → explorer (later)."},
    {"id": "unlock-note", "x": 1040, "y": 2080, "w": 420, "text": "Keystore flow (roadmap item 1)\n\nKey screen gains \"Remember on this device\" (OS keychain).\nOn later launches the app opens on Unlock instead of Key when a wallet is remembered.\nUnlock → Wallet. \"Use a different key\" → Key screen. \"Forget this wallet\" removes the keychain entry after a confirm."},
    {"id": "brief", "x": 0, "y": -200, "w": 520, "text": "Warm-minimal refinement of the current app tokens.\nSame palette (#FAFAF9 / #1A1A1A / accent #C2410C), 4px radius, 34px controls.\nType: IBM Plex Sans + IBM Plex Mono (tabular numerals for sats).\nAddresses/txids are sample values."},
    {"id": "mobile-brief", "x": 0, "y": 3140, "w": 620, "text": "MOBILE — iOS + Android (Tauri). 390x844 frames.\n\nSame palette and type as the desktop boards; everything else re-scaled for a thumb: 48px controls, 16px input text (anything smaller makes iOS zoom the page on focus), 12px card radius, 999px chips. Status bar, tab bar and home indicator are drawn in so the real usable height is visible.\n\nHome is a balance card over a transaction list, with a fixed bottom tab bar — Wallet / Scan / Settings. Send and Receive are the two buttons under the balance, not tabs, because they are actions rather than places.\n\nThese are ADDITIVE: no desktop screen changes. Labels stay English to match the rest of the app.\n\nThings worth arguing about before I build it:\n- Wallet / Scan / Settings as the three tabs, or drop Scan into the Send screen and make the third tab something else?\n- M6: BTC as the big number with sats underneath, or the reverse?\n- M3: 12 words in two columns fits without scrolling; a 24-word restore will scroll. OK?\n- M9 Scan is the only dark screen. Deliberate (camera), or make it light?"},
    {"id": "mobile-native-note", "x": 2350, "y": 4364, "w": 400, "text": "What each mobile-only affordance costs\n\nM7 Receive QR — pure JS, no native plugin.\nM9 Scan — tauri-plugin-barcode-scanner, camera permission string in Info.plist and AndroidManifest.\nM5 Unlock — tauri-plugin-biometric; it authenticates, it does not hold the key, so the key still sits in iOS Keychain / Android Keystore and Face ID gates the read.\nM8 Send also opens from a bitcoin: deep link (tauri-plugin-deep-link), prefilled.\n\nM10 'Show recovery phrase' is behind the same biometric gate."}
  ],
  "launch": {"view": "canvas"}
}
pathlib.Path("canvas.json").write_text(json.dumps(canvas, indent=2))
svg = mark(1024, 232).replace('<svg width="1024" height="1024"', '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"')
pathlib.Path("app-icon.svg").write_text(svg)
print("written", list(files))
