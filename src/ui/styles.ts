import { config } from "../../package.json";
import { getPref } from "../utils/prefs";
import { createDOMOwnership } from "../utils/domOwnership";

const ownership = createDOMOwnership();
const styles = new WeakMap<Window, { node: HTMLElement; root: HTMLElement }>();
const ACCENT_KEY = "style:--zest-accent";
const FLAGS_KEY = "class:zest-hide-title-swatches";

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
/** used until the preference is read (and by the two dialog windows) */
export const ACCENT_FALLBACK = "#40c463";

/** the accent the user picked, or the GitHub green Zest ships with */
export function accentColor(): string {
  const raw = String(getPref("ui.accent") || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : ACCENT_FALLBACK;
}

/** write the accent onto the root element; the stylesheet derives the rest */
export function applyAccent(win: Window) {
  const root = styles.get(win)?.root;
  if (root && ownership.owns(root, ACCENT_KEY))
    root.style.setProperty("--zest-accent", accentColor());
}

/** re-read the preference into every open main window */
export function syncAccent() {
  for (const win of Zotero.getMainWindows()) {
    try {
      applyAccent(win as unknown as Window);
    } catch {
      // window closing
    }
  }
}

export function registerStyles(win: Window) {
  const doc = win.document;
  const id = `${config.addonRef}-styles`;
  const existing = styles.get(win);
  if (existing && doc.getElementById(id) === existing.node) return;
  if (existing && !ownership.owns(existing.root, ACCENT_KEY)) return;
  const root = doc.documentElement as HTMLElement | null;
  if (!root) return;
  // Replace the old node; its owner retains that exact reference for teardown.
  const previousNode = doc.getElementById(id);
  previousNode?.remove();
  // Before ownership tracking (1.0.10), these values belonged to the old
  // stylesheet. Its teardown removed them; they are not Zotero's baseline.
  // Modern copies pass their original baseline through ownership.claim().
  const accent = previousNode
    ? ""
    : root.style.getPropertyValue("--zest-accent");
  const priority = root.style.getPropertyPriority("--zest-accent");
  ownership.claim(root, ACCENT_KEY, () => {
    if (accent) root.style.setProperty("--zest-accent", accent, priority);
    else root.style.removeProperty("--zest-accent");
  });
  const hideSwatches =
    !previousNode && root.classList.contains("zest-hide-title-swatches");
  ownership.claim(root, FLAGS_KEY, () => {
    root.classList.toggle("zest-hide-title-swatches", hideSwatches);
  });
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `
    /* ---------- accent ----------
       Zotero paints the selected row with the system selection colour, which
       is blue on a default macOS/Windows theme — so the plugin's own accent
       has to sit away from it or it disappears the moment a row is selected.
       Every Zest surface below is drawn from these tokens; --zest-accent
       itself is written onto the root element from the ui.accent preference
       (see applyAccent), so the user can retune the whole plugin from one
       colour picker. */
    :root {
      --zest-accent: ${ACCENT_FALLBACK};
      /* one step away from the background: mixing toward the theme's TEXT
         colour darkens it in the light theme and lightens it in the dark one,
         so a histogram bar or a hover outline stays visible in both. Nothing
         puts white text on this token — filled surfaces use the washes below,
         which keep the row's own text colour. */
      --zest-accent-strong: color-mix(in srgb, var(--zest-accent) 72%, var(--fill-primary, #000));
      /* the translucent wash: selected rows and other filled surfaces let the
         row underneath show through instead of covering it */
      --zest-accent-wash: color-mix(in srgb, var(--zest-accent) 26%, transparent);
      --zest-accent-wash-strong: color-mix(in srgb, var(--zest-accent) 42%, transparent);
    }

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

    /* Status dot: filled = set by the user, ring = read from the data.
       The visible dot is 10px; a pseudo-element widens the click target so the
       picker opens without pixel-hunting. Every colour rule carries the same
       prefix as the base rule — a shorter selector would lose to the base
       rule's border shorthand and the ring would never show. */
    .virtualized-table .cell.zest-status .zest-status-dot {
      flex: 0 0 auto; width: 10px; height: 10px; margin-inline-end: 6px; border-radius: 50%;
      box-sizing: border-box; border: 2px solid var(--fill-quinary); cursor: pointer; position: relative;
    }
    .virtualized-table .cell.zest-status .zest-status-dot::before {
      content: ""; position: absolute; inset: -6px; border-radius: 50%;
    }
    /* New uses the SECONDARY grey: the tertiary one is a 30 % white in the
       dark theme, and a 2px ring of it disappears into the row */
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-new         { background-color: var(--fill-secondary); border-color: var(--fill-secondary); }
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-to-read     { background-color: var(--accent-teal); border-color: var(--accent-teal); }
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-in-progress { background-color: var(--accent-wood); border-color: var(--accent-wood); }
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-read        { background-color: var(--zest-accent); border-color: var(--zest-accent); }
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-not-reading { border-color: var(--fill-tertiary); }
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-custom      { background-color: var(--accent-yellow); border-color: var(--accent-yellow); }
    .virtualized-table .cell.zest-status .zest-status-dot.zest-status-auto        { background-color: transparent; }
    .virtualized-table .cell.zest-status .zest-status-dot:hover { outline: 2px solid var(--fill-quinary); outline-offset: 1px; }
    .virtualized-table .cell.zest-status .zest-status-auto-text { color: var(--fill-secondary); }

    /* Rating stars: CSS-only hover preview */
    .virtualized-table .cell.zest-rating .zest-stars { display: inline-flex; flex: 0 0 auto; gap: 0; line-height: 1; letter-spacing: 0; }
    .virtualized-table .cell.zest-rating .zest-star { color: var(--fill-quinary); cursor: pointer; font-size: calc(var(--zotero-font-size, 13px) * .9); }
    .virtualized-table .cell.zest-rating .zest-star.on { color: var(--zest-star-color, var(--accent-yellow)); }
    .virtualized-table .row:not(:hover):not(.selected) .cell.zest-rating .zest-stars-empty { opacity: 0; }
    .virtualized-table .cell.zest-rating .zest-stars:hover .zest-star { color: var(--fill-quinary); }
    .virtualized-table .cell.zest-rating .zest-stars:hover .zest-star:hover,
    .virtualized-table .cell.zest-rating .zest-stars:hover .zest-star:has(~ .zest-star:hover) { color: var(--zest-star-color, var(--accent-yellow)); }

    /* Annotations: histogram / colour stack / dots */
    .virtualized-table .cell.zest-annots .zest-annot-bars {
      flex: 0 0 auto; width: 44px; height: 11px; margin-inline-end: 5px; overflow: visible;
      fill: var(--zest-accent-strong); opacity: .85;
    }
    .virtualized-table .cell.zest-annots .zest-annot-stack {
      flex: 0 0 auto; width: 44px; height: 8px; margin-inline-end: 5px; border-radius: 2px;
      background-repeat: no-repeat; background-size: 100% 100%;
    }
    .virtualized-table .cell.zest-annots .zest-annot-dots { display: inline-flex; gap: 2px; margin-inline-end: 5px; }
    .virtualized-table .cell.zest-annots .zest-annot-dot { width: 7px; height: 7px; border-radius: 50%; }
    .virtualized-table .cell.zest-annots > .cell-text { font-variant-numeric: tabular-nums; }

    /* Author marks: decoration only, never part of the sort key */
    .virtualized-table .cell.zest-authors .zest-author-self,
    .virtualized-table .cell.zest-firstauthor .zest-author-self,
    .virtualized-table .cell.zest-lastauthor .zest-author-self { font-weight: 600; }
    .virtualized-table .cell .zest-author-mark { color: var(--fill-secondary); }

    /* Citations: a count we have not refreshed in a while is dimmed, not hidden */
    .virtualized-table .cell.zest-citations > .cell-text { font-variant-numeric: tabular-nums; }
    .virtualized-table .cell.zest-citations .zest-stale { opacity: .55; }

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

    /* Journal rank badges + impact factor (heat wash behind the number, or a bar) */
    .virtualized-table .cell.zest-pubtags .zest-rank-badge { font-variant-numeric: tabular-nums; }
    .virtualized-table .cell.zest-if .zest-if-heat {
      position: absolute; inset: 3px 6px; border-radius: 3px; pointer-events: none;
    }
    .virtualized-table .cell.zest-if .zest-if-track {
      flex: 0 0 auto; width: 34px; height: 6px; margin-inline-end: 6px; border-radius: 1em;
      background-color: var(--fill-quinary); overflow: hidden;
    }
    .virtualized-table .cell.zest-if .zest-if-bar {
      display: block; height: 100%; border-radius: 1em; background-color: var(--zest-accent);
    }
    .virtualized-table .cell.zest-if > .cell-text { font-variant-numeric: tabular-nums; }

    /* Collection count badge */
    #collection-tree .cell.primary .zest-count {
      margin-inline-start: auto; padding-inline-start: 6px;
      color: var(--fill-secondary); font-variant-numeric: tabular-nums;
      font-size: calc(var(--zotero-font-size, 13px) * .846);
    }

    /* icons: stroked, inherit the text colour, never add a shadow */
    .zest-icon { flex: 0 0 auto; }
    .zest-graph-title, .zest-graph-btn, .zest-info-btn, .zest-annot-copy,
    .zest-tabbar-btn, .zest-tabbar-close, .zest-tagtree-btn {
      display: inline-flex; align-items: center; gap: 5px; box-shadow: none;
    }

    /* ---------- nested tag tree ---------- */
    /* Zotero styles #zotero-tag-selector with display:flex, which beats the
       UA sheet's [hidden]{display:none} — so hiding it needs our own rule. */
    #zotero-tag-selector[hidden] { display: none !important; }
    .zest-tagtree { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; overflow: hidden; }
    .zest-tagtree[hidden] { display: none; }
    /* on the "All" tab our root is only the tab row — the native tag list
       below it needs every remaining pixel */
    .zest-tagtree.zest-tagtree-baronly { flex: 0 0 auto; }
    /* the bar's children set display themselves, which outranks the UA rule
       for [hidden] — without this the tree-only controls keep painting on the
       flat tab */
    .zest-tagtree-bar > [hidden], .zest-tagtree-body[hidden] { display: none; }
    .zest-tagtree-tabs {
      display: flex; flex: 0 0 auto; margin-inline-end: 4px; padding: 1px;
      gap: 1px; border-radius: 5px; background-color: var(--fill-quinary);
    }
    /* icon tabs: the glyphs differ only in indentation (nested vs flat), and
       both are stroked in currentColor, so they read on either theme */
    .zest-tagtree-tab {
      appearance: none; border: 0; background-color: transparent; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 18px; padding: 0; border-radius: 4px;
      color: var(--fill-secondary);
    }
    .zest-tagtree-tab:hover { color: var(--fill-primary); }
    .zest-tagtree-tab.selected {
      background-color: var(--material-background, var(--fill-quarternary));
      color: var(--zest-accent-strong);
    }
    .zest-tagtree-tab:focus-visible {
      outline: 2px solid var(--zest-accent); outline-offset: -2px;
    }
    .zest-tagtree-bar {
      display: flex; align-items: center; gap: 4px; padding: 6px; flex-wrap: nowrap;
      border-bottom: 1px solid var(--fill-quinary);
    }
    .zest-tagtree-btn {
      appearance: none; border: 0; border-radius: 4px; padding: 1px 6px; cursor: pointer;
      background-color: transparent; color: var(--fill-secondary);
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-tagtree-btn:hover { background-color: var(--fill-quinary); }
    .zest-tagtree-search {
      flex: 1 1 auto; min-width: 0; margin: 0 2px; padding: 4px 7px;
      border: 1px solid var(--fill-quinary);
      border-radius: 4px; background-color: var(--material-background, transparent);
      color: var(--fill-primary); font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-tagtree-count { color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .846); }
    .zest-tagtree-body { flex: 1 1 auto; overflow: auto; padding: 4px 3px 8px; }
    .zest-tagtree-row {
      display: flex; align-items: center; gap: 5px; padding: 3px 7px 3px 0;
      cursor: pointer; border-radius: 4px; white-space: nowrap;
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-tagtree-row:hover { background-color: var(--fill-quinary); }
    .zest-tagtree-row:focus-visible {
      outline: 2px solid var(--zest-accent-strong); outline-offset: -2px;
    }
    .zest-tagtree-row.selected { background-color: var(--zest-accent-wash-strong); color: var(--fill-primary); font-weight: 600; }
    /* "not in this view" is a hint, not a disabled state: dimming the whole
       row to .55 put the label near 2:1 against the pane background, which is
       unreadable. Grey the TEXT one step instead and keep it legible. */
    .zest-tagtree-row.dim { color: var(--fill-secondary); }
    .zest-tagtree-row.dim .zest-tagtree-num { opacity: .8; }
    .zest-tagtree-row.disabled { color: var(--fill-tertiary); cursor: default; }
    .zest-tagtree-twisty { width: 12px; flex: 0 0 auto; text-align: center; color: var(--fill-secondary); }
    .zest-tagtree-row.selected .zest-tagtree-twisty { color: inherit; }
    .zest-tagtree-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .zest-tagtree-emoji { flex: 0 0 auto; }
    .zest-tagtree-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
    .zest-tagtree-num { flex: 0 0 auto; color: var(--fill-secondary); font-variant-numeric: tabular-nums; }
    .zest-tagtree-row.selected .zest-tagtree-num { color: inherit; opacity: .8; }
    .zest-tagtree-empty { padding: 12px; color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .923); }

    /* toolbar button: Zotero's own chrome, one extra "graph is open" state.
       fill:currentColor + context-properties is exactly what Zotero does
       for #zotero-tb-add and friends, so the mark tracks the toolbar colour
       (light, dark, and the disabled/hover states) instead of being fixed. */
    #zest-tb-menu {
      fill: currentColor;
      -moz-context-properties: fill, fill-opacity;
    }
    #zest-tb-menu.zest-tb-on {
      background-color: var(--fill-quinary);
      border-radius: 5px;
    }

    /* ---------- literature info panel ---------- */
    /* read-only libraries: the controls stay visible (the values are real)
       but must not look clickable */
    .zest-info-btn:disabled, .zest-info-input:disabled {
      color: var(--fill-secondary); opacity: .6; cursor: default;
    }
    .zest-info-btn:disabled:hover { background-color: var(--fill-quinary); }
    .zest-info-stars.disabled .zest-info-star { cursor: default; }
    .zest-info-stars.disabled { opacity: .7; }
    .zest-info { display: flex; flex-direction: column; gap: 10px; padding: 4px 8px 12px; line-height: 1.5; }
    .zest-info-card { min-width: 0; box-sizing: border-box; padding: 10px 12px;
      border: 1px solid var(--fill-quinary); border-radius: 9px;
      background-color: var(--material-background, transparent); }
    .zest-info-bibliography, .zest-info-workspace { display: flex; flex-direction: column; gap: 7px; }
    .zest-info-bibliography { gap: 12px; }
    .zest-info-group-title { color: var(--fill-secondary); font-weight: 600; font-size: .9em; margin-bottom: 1px; }
    .zest-info-row { display: grid; grid-template-columns: minmax(0, 5em) minmax(0, 1fr);
      align-items: start; gap: 3px 7px; min-width: 0; }
    .zest-info-heading { display: block; padding-bottom: 5px; }
    .zest-info-heading > .zest-info-key { display: none; }
    .zest-info-divider { border-top: 1px solid var(--fill-quinary); padding-top: 6px; margin-top: 1px; }
    .zest-info-key {
      min-width: 0; padding-top: 2px; color: var(--fill-secondary);
      font-size: calc(var(--zotero-font-size, 13px) * .923); overflow-wrap: anywhere;
    }
    .zest-info-value { min-width: 0; overflow-wrap: anywhere; }
    .zest-info-metadata { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; }
    .zest-info-metadata > .zest-info-key { grid-column: 1; grid-row: 1; padding: 0; font-size: .82em; font-weight: 500; }
    .zest-info-metadata > .zest-info-value { grid-column: 1 / -1; grid-row: 2; }
    .zest-info-metadata > .zest-info-metadata-toggle { grid-column: 2; grid-row: 1; margin: 0; padding: 0; font-size: .82em; text-decoration: none; }
    .zest-info-source { padding-bottom: 10px; border-bottom: 1px solid var(--fill-quinary); }
    .zest-info-venue-name { font-weight: 500; line-height: 1.45; }
    .zest-info-author-entry { display: inline-flex; align-items: baseline; max-width: 100%; vertical-align: top; }
    .zest-info-author-separator { white-space: pre; }
    .zest-info-author-role { flex-shrink: 0; margin-inline-start: 5px; font-size: .76em; color: var(--fill-secondary); white-space: nowrap; }
    .zest-info-author-entry[hidden], .zest-info-institutions > li[hidden] { display: none; }
    .zest-info-author, .zest-info-star, .zest-info-heat-seg { appearance: none; margin: 0; padding: 0; min-width: 0; border: 0; background: transparent; font: inherit; color: inherit; }
    .zest-info-author { max-width: 100%; text-align: start; white-space: normal; overflow-wrap: anywhere; cursor: pointer; border-radius: 2px; }
    .zest-info-author:hover { text-decoration: underline; text-underline-offset: 3px; }
    .zest-info-institutions { margin: 0; padding: 0; list-style: none; font-size: .92em; line-height: 1.5; color: var(--fill-secondary); }
    .zest-info-institutions > li { margin: 0; padding-inline-start: 9px; border-inline-start: 2px solid var(--fill-quinary); }
    .zest-info-institutions > li + li { margin-top: 5px; }
    .zest-info-institution-roles { display: inline-flex; flex-wrap: wrap; gap: 3px;
      margin-inline-start: 6px; vertical-align: baseline; }
    .zest-info-institution-role { display: inline-block; border: 1px solid var(--fill-quinary);
      border-radius: 4px; padding: 0 4px; font-size: .78em; line-height: 1.6;
      color: var(--fill-primary); white-space: nowrap; background-color: var(--fill-quinary); }
    .zest-info-institution-role[data-role="corresponding"] { border-color: var(--fill-tertiary);
      background-color: transparent; }
    .zest-info-institution-role[data-role="last"] { border-style: dashed;
      color: var(--fill-secondary); background-color: transparent; }
    .zest-info-citations { display: flex; align-items: baseline; gap: 8px; }
    .zest-info-citations > .zest-info-key { flex: 0 0 auto; font-size: .82em; }
    .zest-info-citations > .zest-info-controls { flex: 1; }
    .zest-info-citation-count { font-variant-numeric: tabular-nums; font-weight: 600; margin-inline-end: 8px; }
    .zest-info-provenance { color: var(--fill-secondary); font-size: .88em; }
    .zest-info-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 7px; }
    .zest-info-controls > .zest-info-value { flex: 1 1 8em; }
    .zest-info-venue { display: flex; flex-direction: column; gap: 3px; }
    .zest-info-ranks { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 4px; min-width: 0; }
    .zest-info-ranks > .zest-rank-badge { flex: 0 0 auto; max-width: 100%; }
    .zest-info-btn, .zest-info-link, .zest-affiliations-fetch, .zest-abstract-fetch {
      appearance: none; margin: 0; border: 1px solid transparent; border-radius: 5px; padding: 2px 6px; cursor: pointer;
      background-color: var(--fill-quinary); color: var(--fill-primary);
      font: inherit; font-size: calc(var(--zotero-font-size, 13px) * .923); line-height: 1.4;
    }
    .zest-info-btn:not(:disabled):hover, .zest-info-link:hover, .zest-affiliations-fetch:not(:disabled):hover, .zest-abstract-fetch:not(:disabled):hover { background-color: var(--fill-quarternary, var(--fill-quinary)); border-color: var(--fill-quarternary); }
    .zest-affiliations-fetch:disabled, .zest-abstract-fetch:disabled { cursor: default; color: var(--fill-secondary); }
    .zest-info-text-toggle { appearance: none; margin: 2px 0 0; padding: 1px 0; border: 0;
      background: transparent; font: inherit; font-size: .88em; color: var(--fill-secondary); cursor: pointer;
      text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--fill-quarternary); }
    .zest-info-text-toggle:hover { color: var(--fill-primary); text-decoration-color: currentColor; }
    .zest-info-feedback { display: block; color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .923); }
    .zest-info-feedback:empty { display: none; }
    .zest-info-remark-feedback { grid-column: 2; }
    .zest-info :is(button, input, textarea, summary):focus-visible,
    .zest-annot-copy:focus-visible,
    .zest-tabbar :is(button, input):focus-visible,
    .zest-tagtree :is(button, input):focus-visible {
      outline: 2px solid var(--zest-accent-strong); outline-offset: 2px;
    }
    .zest-info-stars { display: inline-flex; flex: 0 0 auto; gap: 1px; white-space: nowrap; }
    .zest-info-star { cursor: pointer; color: var(--fill-quinary); }
    .zest-info-star.on { color: var(--zest-star-color, var(--accent-yellow)); }
    .zest-info-input {
      width: 100%; box-sizing: border-box; min-width: 0; margin: 0; padding: 3px 6px; border-radius: 5px; font: inherit;
      border: 1px solid var(--fill-quarternary);
      background-color: var(--material-background, transparent); color: var(--fill-primary);
      resize: vertical; min-height: 3.5em; max-height: 14em; line-height: 1.5;
    }
    .zest-info-heat { display: flex; height: 14px; gap: 1px; border-radius: 4px; overflow: hidden; }
    .zest-info-heat-seg { flex: 1 1 auto; cursor: pointer; background-color: transparent; }
    .zest-info-heat-seg:hover { outline: 1px solid var(--zest-accent-strong); outline-offset: -1px; }
    .zest-info-status { max-width: 100%; text-align: start; }
    .zest-info-status.zest-status-auto-text { color: var(--fill-secondary); }
    .zest-info-open { display: block; padding: 0 3px; }
    .zest-info-open > .zest-info-key { display: block; margin-bottom: 4px; }
    .zest-info-links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
    .zest-info-link { background-color: transparent; border-color: var(--fill-quarternary);
      white-space: nowrap; max-width: 100%; }
    .zest-info-authors .zest-author-self { font-weight: 600; }
    .zest-info-authors .zest-author-mark { color: var(--fill-secondary); }
    .zest-info-title { display: block; max-width: 68ch; font-weight: 600; line-height: 1.45; font-size: 1.08em; text-wrap: pretty; }
    .zest-info-title .zest-info-original { font-weight: 400; color: var(--fill-secondary); margin-top: 6px; font-size: .95em; }
    .zest-info-abstract { font-size: 1em; }
    .zest-info-abstract > summary { cursor: pointer; color: var(--fill-primary); font-weight: 600; padding-block: 1px; }
    .zest-info-abstract-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 10px; margin-top: 7px; }
    .zest-info-abstract-source { color: var(--fill-secondary); font-size: .85em; overflow-wrap: anywhere; }
    .zest-abstract-fetch { border-color: var(--fill-quarternary); background-color: transparent; }
    .zest-info-abstract-text { max-width: 72ch; margin-top: 9px; white-space: normal; line-height: 1.7; overflow-wrap: anywhere; }
    .zest-info-abstract-text p { margin: 0 0 .85em; }
    .zest-info-abstract-text p:last-child { margin-bottom: 0; }
    .zest-info-abstract-text p > span { white-space: pre-wrap; }
    .zest-info-abstract-text ul, .zest-info-abstract-text ol { margin: 0 0 .85em; padding-inline-start: 1.7em; }
    .zest-info-abstract-text li { margin-block: .25em; white-space: pre-wrap; }
    .zest-info-abstract-text strong { font-weight: 600; }
    .zest-info-abstract-text code { font-size: .95em; }
    .zest-info-abstract-text p:has(> .zest-info-abstract-heading:only-child) { margin-bottom: .25em; }
    .zest-info-abstract-preview { max-height: 16em; overflow: hidden; mask-image: linear-gradient(to bottom, black calc(100% - 2em), transparent); }
    .zest-info-abstract-expand { margin-top: 6px; color: var(--fill-primary); }
    .zest-info-abstract-heading { display: block; margin-bottom: 2px; font-weight: 600; color: var(--fill-primary); }

    /* ---------- annotation locator cards ---------- */
    .zest-annot-cards { display: flex; flex-direction: column; gap: 8px; padding: 6px 12px 14px; }
    .zest-annot-filters { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 2px; }
    .zest-annot-chip {
      padding: 0 6px; border-radius: 4px; background-color: var(--fill-quinary);
      color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .846);
    }
    .zest-annot-card {
      border-inline-start: 3px solid var(--zest-annot-line, var(--zest-accent));
      border-radius: 6px; padding: 8px 10px;
      background-color: rgba(var(--zest-annot-rgb, 64, 114, 229), .13);
      cursor: default;
    }
    .zest-annot-card:hover { background-color: rgba(var(--zest-annot-rgb, 64, 114, 229), .23); }
    .zest-annot-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
    .zest-annot-where {
      flex: 1 1 auto; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-annot-copy {
      appearance: none; border: 0; border-radius: 4px; padding: 0 5px; cursor: pointer;
      background-color: transparent; color: var(--fill-secondary);
    }
    .zest-annot-copy:hover { background-color: var(--fill-quinary); }
    .zest-annot-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }
    .zest-annot-comment {
      margin-top: 3px; padding-inline-start: 6px; color: var(--fill-secondary);
      border-inline-start: 2px solid var(--fill-quinary);
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-annot-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .zest-annot-tag {
      padding: 0 5px; border-radius: 4px; background-color: var(--fill-quinary);
      font-size: calc(var(--zotero-font-size, 13px) * .846);
    }
    .zest-annot-empty { color: var(--fill-secondary); padding: 6px 0; font-size: calc(var(--zotero-font-size, 13px) * .923); }

    /* ---------- vertical tab manager ---------- */
    .zest-tabbar { display: flex; flex-direction: column; min-width: 160px; overflow: hidden;
      background-color: var(--material-sidepane, var(--material-background, transparent));
      border-inline-end: 1px solid var(--fill-quinary); }
    .zest-tabbar-splitter { border: 0; background-color: var(--fill-quinary); min-width: 1px; }
    .zest-tabbar-head { display: flex; gap: 4px; padding: 7px 6px; align-items: center; flex-wrap: nowrap;
      border-bottom: 1px solid var(--fill-quinary); }
    .zest-tabbar-search { flex: 1 1 auto; min-width: 0; padding: 4px 7px; border-radius: 5px;
      border: 1px solid var(--fill-quinary);
      background-color: var(--material-background, transparent); color: var(--fill-primary);
      font-size: calc(var(--zotero-font-size, 13px) * .923); }
    .zest-tabbar-btn { appearance: none; border: 0; border-radius: 4px; padding: 1px 6px; cursor: pointer;
      background-color: transparent; color: var(--fill-secondary); }
    .zest-tabbar-btn:hover { background-color: var(--fill-quinary); }
    .zest-tabbar-list { flex: 1 1 auto; overflow: auto; padding: 3px 0 8px; }
    .zest-tabbar-group { display: flex; align-items: center; gap: 4px; padding: 7px 8px 4px; cursor: pointer;
      color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .846); text-transform: uppercase; letter-spacing: .04em; }
    .zest-tabbar-group:hover { background-color: var(--fill-quinary); }
    .zest-tabbar-row { display: flex; align-items: center; gap: 5px; padding: 5px 8px; cursor: pointer;
      border-radius: 4px; margin: 0 4px; font-size: calc(var(--zotero-font-size, 13px) * .923); }
    .zest-tabbar-row:hover { background-color: var(--fill-quinary); }
    .zest-tabbar-row.selected { background-color: var(--zest-accent-wash-strong); color: var(--fill-primary); font-weight: 600; }
    .zest-tabbar-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zest-tabbar-close { appearance: none; border: 0; background: transparent; cursor: pointer;
      color: inherit; opacity: 0; padding: 0 2px; }
    .zest-tabbar-row:hover .zest-tabbar-close, .zest-tabbar-row:focus-within .zest-tabbar-close { opacity: .7; }
    .zest-tabbar-close:hover { opacity: 1; }
    .zest-tabbar-empty { padding: 12px; color: var(--fill-secondary); font-size: calc(var(--zotero-font-size, 13px) * .923); }
    :root.zest-hide-native-tabs #tab-bar-container > div { display: none !important; }

    /* ---------- graph pane ---------- */
    .zest-graph-splitter { border: 0; background-color: var(--fill-quinary); min-height: 3px; }
    .zest-graph-splitter:hover { background-color: var(--zest-accent-wash-strong); }
    .zest-graph-pane { display: flex; flex-direction: column; min-height: 160px; overflow: hidden; background-color: var(--material-background, transparent); }
    .zest-graph-header {
      display: flex; align-items: center; gap: 6px 10px; padding: 8px 12px;
      flex-wrap: wrap; flex: 0 0 auto;
      border-bottom: 1px solid var(--fill-quinary);
      font-size: calc(var(--zotero-font-size, 13px) * .923);
    }
    .zest-graph-title { font-weight: 600; flex: 0 0 auto; white-space: nowrap; gap: 6px; color: var(--fill-primary); }
    .zest-graph-modes { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px;
      max-width: 100%; border: 1px solid var(--fill-quinary);
      border-radius: 7px; background-color: var(--fill-quinary); }
    .zest-graph-mode {
      appearance: none; margin: 0; border: 1px solid transparent; border-radius: 5px; padding: 3px 8px; cursor: pointer;
      background-color: transparent; color: var(--fill-primary);
      font-size: inherit; line-height: 1.35; white-space: nowrap; min-height: 25px;
    }
    .zest-graph-mode:hover { background-color: var(--fill-quinary); }
    .zest-graph-mode:is(.active, [aria-pressed="true"]) {
      background-color: var(--material-button, var(--material-background));
      border-color: var(--fill-quarternary); box-shadow: 0 1px 2px var(--fill-quinary); }
    .zest-graph-actions { display: inline-flex; align-items: center; gap: 6px; margin-inline-start: auto; flex: 0 0 auto; }
    .zest-graph-btn {
      appearance: none; margin: 0; border: 1px solid var(--fill-quinary); border-radius: 6px; padding: 4px 8px; cursor: pointer;
      background-color: var(--fill-quinary); color: var(--fill-primary);
      font-size: inherit; line-height: 1.35; min-height: 29px; white-space: nowrap;
    }
    .zest-graph-btn:hover { background-color: var(--fill-quarternary, var(--fill-quinary)); }
    .zest-graph-btn:disabled { opacity: .55; cursor: default; }
    .zest-graph-mode:focus-visible, .zest-graph-btn:focus-visible { outline: 2px solid var(--zest-accent); outline-offset: 2px; }
    .zest-graph-close { background-color: transparent; border-color: transparent; padding-inline: 6px; }
    .zest-graph-canvas { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden;
      background-color: var(--material-background, transparent); }
    .zest-graph-canvas > svg { position: absolute; inset: 0; }
    .zest-graph-canvas[aria-busy="true"] > svg { opacity: .35; }
    .zest-graph-message { position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 7px; padding: 20px 28px;
      color: var(--fill-secondary); text-align: center; pointer-events: none;
      font-size: calc(var(--zotero-font-size, 13px) * .923); line-height: 1.5; }
    .zest-graph-message[hidden] { display: none; }
    .zest-graph-message strong { color: var(--fill-primary); font-weight: 500; }
    .zest-graph-message span { max-width: 38em; }
    .zest-graph-footer { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 16px;
      flex: 0 0 auto; padding: 6px 12px; border-top: 1px solid var(--fill-quinary);
      font-size: calc(var(--zotero-font-size, 13px) * .846); line-height: 1.4; color: var(--fill-secondary); }
    .zest-graph-status { flex: 1 1 180px; min-width: 0; }
    .zest-graph-help { flex: 0 1 auto; color: var(--fill-secondary); }
    .zest-graph-node:focus-visible { outline: 2px solid var(--zest-accent); outline-offset: 4px; }
    .zest-graph-node.is-selected { stroke: var(--zest-accent); stroke-opacity: .9; stroke-width: 2; }
    .zest-graph-label { font-size: calc(var(--zotero-font-size, 13px) * .846); }

    /* Optional: hide swatches in the Title cell when the Tags column shows them */
    :root.zest-hide-title-swatches #zotero-items-tree .cell.primary .tag-swatch,
    :root.zest-hide-title-swatches #zotero-items-tree .cell.primary .colored-tag-swatches { display: none !important; }
  `;
  root.appendChild(style);
  styles.set(win, { node: style, root });
  applyAccent(win);
}

export function unregisterStyles(win: Window) {
  const state = styles.get(win);
  if (!state) return;
  styles.delete(win);
  state.node.remove();
  ownership.release(state.root, ACCENT_KEY);
  ownership.release(state.root, FLAGS_KEY);
}

export function applyRootFlags(win: Window, hideTitleSwatches: boolean) {
  const root = styles.get(win)?.root;
  if (root && ownership.owns(root, FLAGS_KEY))
    root.classList.toggle("zest-hide-title-swatches", hideTitleSwatches);
}
