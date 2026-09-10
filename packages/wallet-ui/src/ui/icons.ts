const SVG_NS = "http://www.w3.org/2000/svg";

export type IconName =
  | "copy"
  | "refresh"
  | "external"
  | "check"
  | "plus"
  | "x"
  | "eye"
  | "key"
  | "chevron"
  | "arrow"
  | "back"
  | "wallet"
  | "scan"
  | "gear"
  | "up"
  | "down"
  | "share"
  | "faceid";

type Shape =
  | readonly ["path", string]
  | readonly ["circle", string, string, string]
  | readonly ["rect", string, string, string, string, string];

/** Path data mirrors `icon()` in design/gen.py exactly. */
const SHAPES: Record<IconName, readonly Shape[]> = {
  copy: [
    ["rect", "9", "9", "11", "11", "2"],
    ["path", "M5 15V5a2 2 0 0 1 2-2h10"],
  ],
  refresh: [
    ["path", "M20 11a8 8 0 0 0-14.5-4.5L4 8"],
    ["path", "M4 4v4h4"],
    ["path", "M4 13a8 8 0 0 0 14.5 4.5L20 16"],
    ["path", "M20 20v-4h-4"],
  ],
  external: [
    ["path", "M14 4h6v6"],
    ["path", "M20 4l-9 9"],
    ["path", "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"],
  ],
  check: [["path", "M5 12l5 5L20 7"]],
  plus: [
    ["path", "M12 5v14"],
    ["path", "M5 12h14"],
  ],
  x: [
    ["path", "M6 6l12 12"],
    ["path", "M18 6L6 18"],
  ],
  eye: [
    ["path", "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"],
    ["circle", "12", "12", "3"],
  ],
  key: [
    ["circle", "8", "15", "4"],
    ["path", "M10.9 12.1L20 3"],
    ["path", "M16 7l3 3"],
  ],
  chevron: [["path", "M9 6l6 6-6 6"]],
  back: [["path", "M15 6l-6 6 6 6"]],
  wallet: [
    ["path", "M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2"],
    ["path", "M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2z"],
    ["circle", "17", "14", "1.2"],
  ],
  scan: [
    ["path", "M4 8V5a1 1 0 0 1 1-1h3"],
    ["path", "M16 4h3a1 1 0 0 1 1 1v3"],
    ["path", "M20 16v3a1 1 0 0 1-1 1h-3"],
    ["path", "M8 20H5a1 1 0 0 1-1-1v-3"],
    ["path", "M4 12h16"],
  ],
  gear: [
    ["circle", "12", "12", "3"],
    [
      "path",
      "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
    ],
  ],
  up: [
    ["path", "M12 19V5"],
    ["path", "M6 11l6-6 6 6"],
  ],
  down: [
    ["path", "M12 5v14"],
    ["path", "M18 13l-6 6-6-6"],
  ],
  share: [
    ["path", "M12 16V4"],
    ["path", "M8 8l4-4 4 4"],
    ["path", "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"],
  ],
  faceid: [
    ["path", "M4 8V6a2 2 0 0 1 2-2h2"],
    ["path", "M16 4h2a2 2 0 0 1 2 2v2"],
    ["path", "M20 16v2a2 2 0 0 1-2 2h-2"],
    ["path", "M8 20H6a2 2 0 0 1-2-2v-2"],
    ["path", "M9 10v1.5"],
    ["path", "M15 10v1.5"],
    ["path", "M9.5 15.5a3.5 3.5 0 0 0 5 0"],
  ],
  arrow: [
    ["path", "M5 12h14"],
    ["path", "M13 6l6 6-6 6"],
  ],
};

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Inline stroke icon (24-unit viewBox, `currentColor`), sized in px. */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = svgEl("svg", {
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  svg.classList.add("icon");
  for (const shape of SHAPES[name]) {
    switch (shape[0]) {
      case "path":
        svg.appendChild(svgEl("path", { d: shape[1] }));
        break;
      case "circle":
        svg.appendChild(svgEl("circle", { cx: shape[1], cy: shape[2], r: shape[3] }));
        break;
      case "rect":
        svg.appendChild(
          svgEl("rect", {
            x: shape[1],
            y: shape[2],
            width: shape[3],
            height: shape[4],
            rx: shape[5],
          }),
        );
        break;
    }
  }
  return svg;
}

/** Keyhole brand mark used in the top bar (from gen.py `topbar()`). */
export function brandMark(): SVGSVGElement {
  const svg = svgEl("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
  }) as SVGSVGElement;
  svg.appendChild(
    svgEl("circle", { cx: "12", cy: "9", r: "5.5", stroke: "#FFFFFF", "stroke-width": "2.4" }),
  );
  svg.appendChild(svgEl("path", { d: "M9.5 13.5h5L16 22H8z", fill: "#FFFFFF" }));
  return svg;
}
