import json, pathlib

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
TR_ADDR = "tb1p8xk2p0hz9q5m4vd7l3c6t8s2e5x9m3a0v6u2j5f7g4k1b0d9h8csqx7r2w"

setup = page(head("Setup", "Network and Esplora endpoint. Stored locally; no secrets.") + f'''
<section class="card" style="gap: 16px;">
  {field("Network", chips(["Bitcoin","Testnet3","Testnet4","Signet","Regtest"], "Signet"))}
  {field("Esplora URL", '<span class="input mono">https://mempool.space/signet/api</span>', "Any Esplora-compatible API — mempool.space, blockstream.info, electrs, bitcoin-rs.")}
  {field("Address type", chips(["P2PKH (legacy)","P2WPKH (segwit)","P2SH-P2WPKH (nested)","P2TR (taproot)","P2PK (bare)"], "P2WPKH (segwit)"), "P2PK funds are not discoverable by public indexers.")}
</section>
<div style="display: flex; justify-content: flex-end; gap: 8px;">
  <span class="btn btn-primary">Continue {icon("arrow", 16, "#FFFFFF")}</span>
</div>''', step=0)

key = page(head("Key", "Signet · mempool.space") + f'''
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
</section>''', step=1)

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
def _hrow(dirn, txid, amt, conf, when, action=""):
    up = dirn == "out"
    col = "#1A1A1A" if up else "#166534"
    sign = "\u2212" if up else "+"
    ic = icon("arrow", 14, "#6B6B66") if up else icon("arrow", 14, "#166534")
    rot = ' style="display: inline-flex;"' if up else ' style="display: inline-flex; transform: rotate(180deg);"'
    cst = ' style="color: #6B6B66;"' if conf == "pending" else ""
    act = f'<span class="btn btn-sm">{icon("refresh", 12)} Bump fee</span>' if action else ""
    return (f'<tr><td><span{rot}>{ic}</span></td><td class="mono">{txid}</td>'
            f'<td class="num mono" style="color: {col}; font-weight: 500;">{sign}{amt}</td>'
            f'<td class="num mono"{cst}>{conf}</td><td class="num" style="color: #6B6B66;">{when}</td>'
            f'<td class="num">{act}</td></tr>')

hrows = "".join([
    _hrow("out", "e19f4a7d05…b2c8d4a0", "40,141",  "pending", "2 min ago", action="bump"),
    _hrow("out", "3b9d1e7f2a…b3c4d5e6", "150,141", "3",       "Today 14:02"),
    _hrow("in",  "7c02d8b1e4…9a6f0c3b", "120,000", "31",      "Aug 27"),
    _hrow("in",  "a41e9c2f7b…3d08e1f2", "250,000", "142",     "Aug 24"),
])

dash = page(head("Wallet", "Signet · P2WPKH (segwit) · signet-p2wpkh-3f0c9a1b") + f'''
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
  <span class="label">Receiving address</span>
  <div style="display: flex; align-items: center; gap: 8px;">
    <span class="input mono" style="flex: 1; background: #F4F4F2;">{ADDR}</span>
    <span class="btn">{icon("copy", 16)} Copy</span>
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
    <span class="hint">4 · newest first · unconfirmed sends can be bumped</span>
  </div>
  <table>
    <thead><tr><th style="width: 24px;"></th><th>Txid</th><th class="num">Amount (sat)</th><th class="num">Conf.</th><th class="num">When</th><th class="num"></th></tr></thead>
    <tbody>{hrows}</tbody>
  </table>
</section>
<div style="display: flex; justify-content: flex-end;">
  <span class="btn btn-danger">Close wallet</span>
</div>''', step=2, minh=980)

send = page(head("Send", f"From {ADDR}") + f'''
<section class="card">
  <div style="display: flex; align-items: center; justify-content: space-between;">
    <span class="label">Recipients</span>
    <span class="btn btn-sm">{icon("plus", 14)} Add recipient</span>
  </div>
  <div style="display: grid; grid-template-columns: 1fr 210px 34px; gap: 8px; align-items: end;">
    {field("Address", '<span class="input mono">' + TR_ADDR + '</span>')}
    {field("Amount", '<div style="display: flex; gap: 4px;"><span class="input mono" style="flex: 1; justify-content: flex-end;">150,000</span><span class="chip on" style="min-height: 34px; padding: 6px 8px; font-size: 12px;">sat</span><span class="chip" style="min-height: 34px; padding: 6px 8px; font-size: 12px;">BTC</span></div>')}
    <span class="btn btn-quiet" style="width: 34px; padding: 0;">{icon("x", 16, "#6B6B66")}</span>
  </div>
  <div style="display: grid; grid-template-columns: 1fr 210px 34px; gap: 8px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <span class="label">Address</span>
      <span class="input mono" style="border-color: #B91C1C;">tb1qbroken0address</span>
      <span style="font-size: 12px; color: #B91C1C;">Not a valid signet address.</span>
    </div>
    {field("Amount", '<div style="display: flex; gap: 4px;"><span class="input mono placeholder" style="flex: 1; justify-content: flex-end;">0</span><span class="btn btn-sm" style="min-height: 34px;">Max</span></div>', "Max spends the whole balance minus the fee.")}
    <span class="btn btn-quiet" style="width: 34px; padding: 0;">{icon("x", 16, "#6B6B66")}</span>
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
    <dt>Total out</dt><dd class="mono">150,000 sat</dd>
    <dt>Fee</dt><dd class="mono">141 sat <span style="color: #6B6B66;">(141 vB · 1 in)</span></dd>
    <dt>Change</dt><dd class="mono">99,859 sat <span style="color: #6B6B66;">→ back to this wallet</span></dd>
    <dt>Total spent</dt><dd class="mono" style="font-weight: 600;">150,141 sat</dd>
  </dl>
  <div style="display: flex; justify-content: flex-end; gap: 8px;">
    <span class="btn">Edit</span>
    <span class="btn btn-primary">Confirm &amp; broadcast</span>
  </div>
</section>''', step=2, minh=760)

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

files = {"Setup.dc.html": setup, "Key.dc.html": key, "Main.dc.html": dash, "Send.dc.html": send, "Sent.dc.html": result, "Unlock.dc.html": unlock, "Icon.dc.html": iconboard}
for n, c in files.items(): pathlib.Path(n).write_text(c)

canvas = {
  "artboards": [
    {"file": "Setup.dc.html", "title": "1 · Setup", "x": 0, "y": 0, "w": 960, "h": 640},
    {"file": "Key.dc.html", "title": "2 · Key", "x": 1040, "y": 0, "w": 960, "h": 640},
    {"file": "Main.dc.html", "title": "3 · Wallet", "x": 2080, "y": 0, "w": 960, "h": 1100},
    {"file": "Send.dc.html", "title": "4 · Send + Review", "x": 0, "y": 1200, "w": 960, "h": 760},
    {"file": "Sent.dc.html", "title": "5 · Sent", "x": 1040, "y": 1200, "w": 960, "h": 640},
    {"file": "Icon.dc.html", "title": "App icon", "x": 2080, "y": 1200, "w": 720, "h": 480},
    {"file": "Unlock.dc.html", "title": "2b · Unlock (returning user)", "x": 0, "y": 2080, "w": 960, "h": 640},
  ],
  "annotations": [
    {"id": "bump-note", "x": 3120, "y": 1180, "w": 380, "text": "Roadmap 7 + 8\n\nHistory: an unconfirmed OUTGOING row gets a \"Bump fee\" button (BDK signals RBF on everything we build). Confirmed and incoming rows show nothing.\n\nSend: amount takes sat or BTC via the unit chips; \"Max\" fills the spendable balance minus fee. An address that fails validation turns the field red with the reason underneath, and Review stays disabled."},
    {"id": "history-note", "x": 3120, "y": 0, "w": 380, "text": "Roadmap item 4 — Transaction history\n\nNew \"Transactions\" card under Unspent outputs: direction arrow (in = green, down; out = up), short txid, signed net amount (sent amounts include the fee), confirmations, relative/short date. Newest first. Click a row → explorer (later)."},
    {"id": "unlock-note", "x": 1040, "y": 2080, "w": 420, "text": "Keystore flow (roadmap item 1)\n\nKey screen gains \"Remember on this device\" (OS keychain).\nOn later launches the app opens on Unlock instead of Key when a wallet is remembered.\nUnlock → Wallet. \"Use a different key\" → Key screen. \"Forget this wallet\" removes the keychain entry after a confirm."},
    {"id": "brief", "x": 0, "y": -200, "w": 520, "text": "Warm-minimal refinement of the current app tokens.\nSame palette (#FAFAF9 / #1A1A1A / accent #C2410C), 4px radius, 34px controls.\nType: IBM Plex Sans + IBM Plex Mono (tabular numerals for sats).\nAddresses/txids are sample values."}
  ],
  "launch": {"view": "canvas"}
}
pathlib.Path("canvas.json").write_text(json.dumps(canvas, indent=2))
svg = mark(1024, 232).replace('<svg width="1024" height="1024"', '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"')
pathlib.Path("app-icon.svg").write_text(svg)
print("written", list(files))
