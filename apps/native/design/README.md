# Design

Every screen is designed on a canvas before it is written as code. This
directory holds that canvas's source, and the canvas is what the screens are
built from.

| File | What it is |
|---|---|
| `*.dc.html` | One artboard per screen: desktop (`Setup`, `Key`, `Main`, …) and phone (`M…`). |
| `canvas.json` | Where each artboard sits on the canvas, and the design notes beside them. |
| `gen.py` | Writes all of the above and `app-icon.svg`. Shared tokens (colours, type, spacing) live at its top. |
| `app-icon.svg`, `app-icon.png` | The app icon, a keyhole in a coin; `Icon.dc.html` shows it at 256 and 128. |

## Changing a screen

1. Change the artboard in `gen.py` and run it here: `python3 gen.py`. It
   rewrites the `*.dc.html` files and `canvas.json`.
2. Republish the canvas, and have the change reviewed there, before any code
   changes. The canvas is a private Claude Design artifact owned by the
   maintainers, and the seeded bundle published to it (`bitcoin-wallet-app.html`,
   about 2.6 MB) is built from these files and is not committed.
3. **Before republishing, download the live canvas and diff it against what
   `gen.py` produces.** Edits can be made in the canvas itself, and
   republishing over them would discard them silently. Carry any differences
   back into `gen.py` first.
4. Implement from the reviewed canvas, matching its values exactly.

The canvas loads its fonts from Google Fonts. The app cannot: its content
security policy allows neither remote fonts nor inline styles, so IBM Plex is
self-hosted through `@fontsource` and every style lives in a stylesheet. A value
taken from the canvas goes into those stylesheets, never inline.
