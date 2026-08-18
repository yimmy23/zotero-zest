import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import {
  requestSummary,
  getSummary,
  type AnnotSummary,
} from "../annots/density";
import { makeCell, numKey, rowItem, type ColumnSpec } from "./registry";

/**
 * "Annotations" column — how much of a paper you actually marked up.
 *
 * Three styles (the original plugin's, minus its blocking recomputation):
 *   bar    a mini histogram of annotations across the document
 *   stack  one bar split by annotation colour
 *   circle one dot per annotation colour, sized by share
 * plus the count as text in every style.
 *
 * The column is OFF by default: a library with thousands of annotated PDFs
 * pays for the first sort, and most people do not need it in the list.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export function annotStyle(): "bar" | "stack" | "circle" {
  const v = String(getPref("annots.style") || "bar");
  return v === "stack" || v === "circle" ? v : "bar";
}

export function annotColor(): string {
  return (getPref("annots.color") as string) || "";
}

function histogramPath(hist: number[], w: number, h: number): string {
  const max = Math.max(...hist);
  if (!max) return "";
  const n = hist.length;
  const bw = w / n;
  let d = "";
  for (let i = 0; i < n; i++) {
    if (!hist[i]) continue;
    const bh = Math.max(1, (hist[i] / max) * h);
    const x = (i * bw).toFixed(2);
    const y = (h - bh).toFixed(2);
    d += `M${x} ${y}h${Math.max(0.8, bw - 0.6).toFixed(2)}v${bh.toFixed(2)}h-${Math.max(0.8, bw - 0.6).toFixed(2)}z`;
  }
  return d;
}

function renderBar(doc: Document, sum: AnnotSummary): Element | null {
  const d = histogramPath(sum.histogram, 100, 10);
  if (!d) return null;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "zest-annot-bars");
  svg.setAttribute("viewBox", "0 0 100 10");
  svg.setAttribute("preserveAspectRatio", "none");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  const color = annotColor();
  if (color) path.setAttribute("fill", color);
  svg.appendChild(path);
  return svg;
}

function renderStack(doc: Document, sum: AnnotSummary): Element | null {
  if (!sum.colors.length) return null;
  const total = sum.colors.reduce((a, c) => a + c.count, 0) || 1;
  const stops: string[] = [];
  let at = 0;
  for (const c of sum.colors) {
    const next = at + (c.count / total) * 100;
    stops.push(`${c.color} ${at.toFixed(2)}% ${next.toFixed(2)}%`);
    at = next;
  }
  const span = doc.createElement("span");
  span.className = "zest-annot-stack";
  span.style.backgroundImage = `linear-gradient(to right, ${stops.join(", ")})`;
  return span;
}

function renderCircles(doc: Document, sum: AnnotSummary): Element | null {
  if (!sum.colors.length) return null;
  const wrap = doc.createElement("span");
  wrap.className = "zest-annot-dots";
  for (const c of sum.colors.slice(0, 6)) {
    const dot = doc.createElement("span");
    dot.className = "zest-annot-dot";
    dot.style.backgroundColor = c.color;
    dot.title = `${c.count}`;
    wrap.appendChild(dot);
  }
  return wrap;
}

export function annotationsColumn(): ColumnSpec {
  return {
    key: "annots",
    label: getString("column-annots"),
    width: 90,
    enabledPref: "extensions.zotero.zest.column.annots.enable",
    dataProvider: (item) => {
      if (!item.isRegularItem()) return "";
      const sum = requestSummary(item);
      if (!sum) return "";
      return sum.count ? numKey(sum.count) : "";
    },
    renderCell: (index, data, column, _first, doc) => {
      const { cell, textSpan } = makeCell(doc, column, "annots");
      if (!data) return cell;
      const item = rowItem(doc, index);
      const sum = item ? getSummary(item.id) : undefined;
      if (!sum || !sum.count) return cell;
      textSpan.textContent = String(sum.count);
      let vis: Element | null;
      switch (annotStyle()) {
        case "stack":
          vis = renderStack(doc, sum);
          break;
        case "circle":
          vis = renderCircles(doc, sum);
          break;
        default:
          vis = renderBar(doc, sum);
      }
      if (vis) cell.insertBefore(vis, textSpan);
      cell.title = getString("annots-cell-tip", {
        args: { count: sum.count, chars: sum.chars },
      });
      return cell;
    },
  };
}
