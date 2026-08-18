import { config } from "../../package.json";

/**
 * One stylesheet for all plugin UI, injected per main window.
 *
 * Design rules (they are what makes things look native — keep them):
 * - Zotero CSS variables only (--fill-*, --accent-*, --material-*,
 *   --zotero-font-size); never hardcode greys. Light/dark come for free.
 * - Icons are context-fill/context-stroke SVGs.
 * - Secondary text one notch smaller: calc(var(--zotero-font-size) * .923).
 * - Buttons set background-COLOR, never the `background` shorthand (it
 *   resets background-image and blanks icons).
 * - Never move DOM under a hovering pointer; keep hint rows always present.
 */
export function registerStyles(win: Window) {
  const doc = win.document;
  const id = `${config.addonRef}-styles`;
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `
    /* ---------- item-tree cells ---------- */
    .virtualized-table .cell.zest-cell { display: flex; align-items: center; position: relative; overflow: hidden; }
    .virtualized-table .cell.zest-cell > .cell-text { position: relative; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .zest-visually-hidden { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* Reading: heat strip under the duration text */
    .virtualized-table .cell.zest-reading .zest-heat {
      position: absolute; inset: 3px 6px; border-radius: 3px; pointer-events: none;
      background-repeat: no-repeat; background-size: 100% 100%;
    }
    .virtualized-table .cell.zest-reading > .cell-text { font-variant-numeric: tabular-nums; }

    /* Title decoration (optional): heat as cell background, unread bold */
    .virtualized-table .cell.primary.zest-heat-cell { background-repeat: no-repeat; background-size: 100% 100%; background-origin: padding-box; }
    .virtualized-table .cell.primary.zest-unread .cell-text { font-weight: 600; }

    /* Status dot */
    .virtualized-table .cell.zest-status .zest-status-dot {
      flex: 0 0 auto; width: 9px; height: 9px; margin-inline-end: 6px; border-radius: 50%;
      box-sizing: border-box; border: 1px solid transparent; cursor: pointer;
    }
    .zest-status-dot.zest-status-none        { border-color: var(--fill-quinary); }
    .zest-status-dot.zest-status-new         { background-color: var(--fill-tertiary); }
    .zest-status-dot.zest-status-to-read     { background-color: var(--accent-azure); }
    .zest-status-dot.zest-status-in-progress { background-color: var(--accent-blue); }
    .zest-status-dot.zest-status-read        { background-color: var(--accent-green); }
    .zest-status-dot.zest-status-not-reading { border-color: var(--fill-tertiary); }
    .zest-status-dot.zest-status-custom      { background-color: var(--accent-teal); }
    .zest-status-dot:hover { outline: 2px solid var(--fill-quinary); outline-offset: 1px; }

    /* Rating stars: CSS-only hover preview */
    .virtualized-table .cell.zest-rating .zest-stars { display: inline-flex; flex: 0 0 auto; gap: 0; line-height: 1; letter-spacing: 0; }
    .virtualized-table .cell.zest-rating .zest-star { color: var(--fill-quinary); cursor: pointer; font-size: calc(var(--zotero-font-size, 13px) * .9); }
    .virtualized-table .cell.zest-rating .zest-star.on { color: var(--zest-star-color, var(--accent-blue)); }
    .virtualized-table .row:not(:hover):not(.selected) .cell.zest-rating .zest-stars-empty { opacity: 0; }
    .virtualized-table .cell.zest-rating .zest-stars:hover .zest-star { color: var(--fill-quinary); }
    .virtualized-table .cell.zest-rating .zest-stars:hover .zest-star:hover,
    .virtualized-table .cell.zest-rating .zest-stars:hover .zest-star:has(~ .zest-star:hover) { color: var(--zest-star-color, var(--accent-blue)); }

    /* Annotations: histogram / colour stack / dots */
    .virtualized-table .cell.zest-annots .zest-annot-bars {
      flex: 0 0 auto; width: 44px; height: 11px; margin-inline-end: 5px; overflow: visible;
      fill: var(--accent-blue); opacity: .85;
    }
    .virtualized-table .cell.zest-annots .zest-annot-stack {
      flex: 0 0 auto; width: 44px; height: 8px; margin-inline-end: 5px; border-radius: 2px;
      background-repeat: no-repeat; background-size: 100% 100%;
    }
    .virtualized-table .cell.zest-annots .zest-annot-dots { display: inline-flex; gap: 2px; margin-inline-end: 5px; }
    .virtualized-table .cell.zest-annots .zest-annot-dot { width: 7px; height: 7px; border-radius: 50%; }
    .virtualized-table .cell.zest-annots > .cell-text { font-variant-numeric: tabular-nums; }

    /* Tags (native swatch markup) */
    .virtualized-table .cell.zest-tags .tag-swatch { margin-inline-end: 3px; }
    .virtualized-table .cell.zest-tags .tag-swatch.emoji { font-size: calc(var(--zotero-font-size, 13px) * .923); }

    /* #Tags badges */
    .virtualized-table .cell.zest-texttags .zest-badges { display: inline-flex; gap: 4px; min-width: 0; overflow: hidden; }
    .zest-badge {
      display: inline-block; padding: 0 5px; border-radius: 4px; line-height: 1.45;
      font-size: calc(var(--zotero-font-size, 13px) * .923); white-space: nowrap;
      background-color: var(--fill-quinary); color: var(--fill-primary);
    }

    /* ---------- nested tag tree ---------- */
    /* Zotero styles #zotero-tag-selector with display:flex, which beats the
       UA sheet's [hidden]{display:none} — so hiding it needs our own rule. */
    #zotero-tag-selector[hidden] { display: none !important; }
    .zest-tagtree { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; overflow: hidden; }
    .zest-tagtree[hidden] { display: none; }
    .zest-tagtree-bar {
      display: flex; align-items: center; gap: 2px; padding: 3px 6px;
      border-bottom: 1px solid var(--material-border-quinary, var(--fill-quinary));
    }
    .zest-tagtree-btn {
      appearance: none; border: 0; border-radius: 4px; padding: 1px 6px; cursor: pointer;
      background-color: transparent; color: var(--fill-secondary);
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-tagtree-btn:hover { background-color: var(--fill-quinary); }
    .zest-tagtree-search {
      flex: 1 1 auto; min-width: 40px; margin: 0 4px; padding: 1px 6px;
      border: 1px solid var(--material-border-quinary, var(--fill-quinary));
      border-radius: 4px; background-color: var(--material-background, transparent);
      color: var(--fill-primary); font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-tagtree-count { color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .846); }
    .zest-tagtree-body { flex: 1 1 auto; overflow: auto; padding: 2px 0 6px; }
    .zest-tagtree-row {
      display: flex; align-items: center; gap: 4px; padding: 1px 6px 1px 0;
      cursor: pointer; border-radius: 4px; white-space: nowrap;
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-tagtree-row:hover { background-color: var(--fill-quinary); }
    .zest-tagtree-row.selected { background-color: var(--accent-blue); color: var(--accent-white, #fff); }
    .zest-tagtree-row.dim { opacity: .55; }
    .zest-tagtree-row.disabled { opacity: .35; cursor: default; }
    .zest-tagtree-twisty { width: 12px; flex: 0 0 auto; text-align: center; color: var(--fill-secondary); }
    .zest-tagtree-row.selected .zest-tagtree-twisty { color: inherit; }
    .zest-tagtree-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .zest-tagtree-emoji { flex: 0 0 auto; }
    .zest-tagtree-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
    .zest-tagtree-num { flex: 0 0 auto; color: var(--fill-secondary); font-variant-numeric: tabular-nums; }
    .zest-tagtree-row.selected .zest-tagtree-num { color: inherit; opacity: .8; }
    .zest-tagtree-empty { padding: 12px; color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .923); }

    /* ---------- graph pane ---------- */
    .zest-graph-splitter { border: 0; background-color: var(--material-border-quinary, var(--fill-quinary)); min-height: 1px; }
    .zest-graph-pane { display: flex; flex-direction: column; min-height: 160px; overflow: hidden; background-color: var(--material-background, transparent); }
    .zest-graph-header {
      display: flex; align-items: center; gap: 8px; padding: 4px 12px;
      border-bottom: 1px solid var(--material-border-quinary, var(--fill-quinary));
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-graph-title { font-weight: 600; }
    .zest-graph-modes { display: inline-flex; gap: 2px; }
    .zest-graph-mode {
      appearance: none; border: 0; border-radius: 4px; padding: 2px 8px; cursor: pointer;
      background-color: transparent; color: var(--fill-secondary);
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-graph-mode:hover { background-color: var(--fill-quinary); }
    .zest-graph-mode.active { background-color: var(--accent-blue); color: var(--accent-white, #fff); }
    .zest-graph-status { flex: 1 1 auto; color: var(--fill-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zest-graph-btn {
      appearance: none; border: 0; border-radius: 4px; padding: 2px 8px; cursor: pointer;
      background-color: var(--fill-quinary); color: var(--fill-primary);
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-graph-btn:hover { background-color: var(--fill-quarternary, var(--fill-quinary)); }
    .zest-graph-close { background-color: transparent; }
    .zest-graph-canvas { flex: 1 1 auto; min-height: 0; position: relative; }

    /* Optional: hide swatches in the Title cell when the Tags column shows them */
    :root.zest-hide-title-swatches #zotero-items-tree .cell.primary .tag-swatch,
    :root.zest-hide-title-swatches #zotero-items-tree .cell.primary .colored-tag-swatches { display: none !important; }
  `;
  doc.documentElement?.appendChild(style);
}

export function unregisterStyles(win: Window) {
  win.document.getElementById(`${config.addonRef}-styles`)?.remove();
  win.document.documentElement?.classList.remove("zest-hide-title-swatches");
}

export function applyRootFlags(win: Window, hideTitleSwatches: boolean) {
  win.document.documentElement?.classList.toggle(
    "zest-hide-title-swatches",
    hideTitleSwatches,
  );
}
