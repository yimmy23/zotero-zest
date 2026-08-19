/**
 * One small inline-SVG icon set for every Zest surface.
 *
 * Inline rather than files: these are used in the main window AND in two
 * plain dialog windows, where a `chrome://` icon URL is awkward, and inline
 * paths inherit `currentColor` so they follow the host theme with no extra
 * CSS. Everything is drawn on a 16-unit grid with a 1.5 stroke so the set
 * looks like one family.
 */

export type IconName =
  | "sort"
  | "collapse"
  | "expand"
  | "clear"
  | "list"
  | "tagnest"
  | "tree"
  | "refresh"
  | "close"
  | "copy"
  | "download"
  | "search"
  | "menu"
  | "star"
  | "chart"
  | "tag"
  | "graph"
  | "book";

const SVG_NS = "http://www.w3.org/2000/svg";

/** path data (stroked) per icon */
const PATHS: Record<IconName, string[]> = {
  sort: [
    "M4 5h8",
    "M4 8h5",
    "M4 11h3",
    "M12.5 8.5v4.5",
    "M11 11.5l1.5 1.5 1.5-1.5",
  ],
  collapse: ["M4.5 6.5L8 3l3.5 3.5", "M4.5 9.5L8 13l3.5-3.5"],
  expand: ["M4.5 4.5L8 8l3.5-3.5", "M4.5 8.5L8 12l3.5-3.5"],
  clear: ["M4 4l8 8", "M12 4l-8 8"],
  list: ["M3 4.5h10", "M3 8h10", "M3 11.5h10"],
  // the nested/flat pair differs only in indentation — which is exactly what
  // separates the two tag views, so the tabs need no words
  tagnest: ["M3 4.5h10", "M6.5 8h6.5", "M6.5 11.5h6.5"],
  tree: [
    "M3 4h4",
    "M6 4v7h4",
    "M6 7.5h4",
    "M10.5 2.5h2.5v3h-2.5z",
    "M10.5 6h2.5v3h-2.5z",
    "M10.5 9.5h2.5v3h-2.5z",
  ],
  refresh: ["M13 8a5 5 0 1 1-1.6-3.7", "M13 2.5v3h-3"],
  close: ["M4 4l8 8", "M12 4l-8 8"],
  copy: ["M5.5 5.5h7v7h-7z", "M3.5 10.5v-7h7"],
  download: ["M8 3v7", "M5 7.5L8 10.5l3-3", "M3.5 12.5h9"],
  search: [
    "M7.2 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z",
    "M10.4 10.4L13.5 13.5",
  ],
  menu: ["M4 8h.01", "M8 8h.01", "M12 8h.01"],
  star: [
    "M8 2.6l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.3l-3.4 1.8.7-3.8L2.5 6.6l3.8-.5z",
  ],
  chart: ["M3 13h10", "M5 13V8", "M8 13V4.5", "M11 13v-3"],
  tag: ["M3 3h5l5 5-5 5-5-5z", "M5.6 5.6h.01"],
  graph: [
    "M4 11.5a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
    "M12 6.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
    "M12 13.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
    "M5.4 9.2l5.2-3.4",
    "M5.4 10.4l5.2 1.4",
  ],
  book: [
    "M3.5 3.5h4a2 2 0 0 1 2 2v7a1.6 1.6 0 0 0-1.6-1.6H3.5z",
    "M12.5 3.5h-2a2 2 0 0 0-1 .3v8.4a1.6 1.6 0 0 1 1.6-1.6h1.4z",
  ],
};

/** filled icons look wrong at this weight, so everything is stroked */
export function icon(doc: Document, name: IconName, size = 14): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as unknown as SVGElement;
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("zest-icon");
  for (const d of PATHS[name]) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/** replace a button's text with an icon, keeping the label as its tooltip */
export function iconButton(
  doc: Document,
  name: IconName,
  tooltip: string,
  className = "",
  size = 14,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.className = className;
  button.title = tooltip;
  button.setAttribute("aria-label", tooltip);
  button.appendChild(icon(doc, name, size));
  return button;
}

/** icon + text, for buttons where the word carries the meaning */
export function iconLabelButton(
  doc: Document,
  name: IconName,
  label: string,
  className = "",
  size = 14,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.className = className;
  button.appendChild(icon(doc, name, size));
  const span = doc.createElement("span");
  span.textContent = label;
  button.appendChild(span);
  return button;
}

/** shared CSS for the set (used by the dialogs, which have no plugin stylesheet) */
export const ICON_CSS = `
  .zest-icon { flex: 0 0 auto; vertical-align: -2px; }
  button:has(> .zest-icon) { display: inline-flex; align-items: center; gap: 5px; }
`;
