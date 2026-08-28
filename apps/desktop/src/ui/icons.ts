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
  | "arrow";

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
