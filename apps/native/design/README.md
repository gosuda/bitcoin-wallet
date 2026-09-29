# Design

Every screen is designed on a canvas before it is written as code. This
directory holds that canvas's source, and the canvas is what the screens are
built from.

| File | What it is |
|---|---|
| `*.dc.html` | One artboard per screen: desktop (`Setup`, `Key`, `Main`, …) and phone (`M…`). Each ends with the logic block the canvas reads, which gives the size it previews at. |
| `canvas.json` | The canvas's index, in the Design type's format 3: where each artboard sits, and the design notes beside them. |
| `gen.py` | Writes all of the above and `app-icon.svg`. Shared tokens (colours, type, spacing) live at its top. |
| `app-icon.svg`, `app-icon.png` | The app icon, a keyhole in a coin; `Icon.dc.html` shows it at 256 and 128. |

## Changing a screen

1. Change the artboard in `gen.py` and run it here: `python3 gen.py`. It
   rewrites the `*.dc.html` files and `canvas.json`.
2. Republish the canvas, and have the change reviewed there, before any code
   changes. The canvas is a private artifact made from Claude's Design type
   and owned by the maintainers. It holds these files unchanged, under
   `project/`: `project/canvas.json`, `project/Main.dc.html` and so on.
   Publish only the files that changed, and the index only when an artboard
   is added, moved or resized or a note changes.
3. **Before republishing, read the live files back and diff them against what
   `gen.py` produces.** Edits can be made in the canvas itself, and
   republishing over them would discard them silently. Carry any differences
   back into `gen.py` first.
4. Implement from the reviewed canvas, matching its values exactly.

The canvas loads its fonts from Google Fonts. The app cannot: its content
security policy allows neither remote fonts nor inline styles, so IBM Plex is
self-hosted through `@fontsource` and every style lives in a stylesheet. A value
taken from the canvas goes into those stylesheets, never inline.
