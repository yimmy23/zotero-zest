import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { dialogThemeCSS } from "../ui/dialogTheme";
import { getString } from "../utils/locale";
import {
  collectRatingImportPreview,
  commitRatingImport,
  type RatingImportPreview,
  type RatingImportRow,
} from "../rating/tagImport";

const HOST_URL = `chrome://${config.addonRef}/content/panel.xhtml`;
const PAGE_SIZE = 50;

type ImportState = {
  owner: Window;
  win: Window;
  preview: RatingImportPreview;
  page: number;
  disposed: boolean;
  committing: boolean;
  load?: () => void;
  unload?: () => void;
  ownerUnload?: () => void;
};

const states = new Map<Window, ImportState>();

function label(id: FluentMessageId, args?: Record<string, number | string>) {
  return args ? getString(id, { args }) : getString(id);
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls = "",
  text?: string,
) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dispose(state: ImportState) {
  if (state.disposed) return;
  state.disposed = true;
  state.win.removeEventListener("load", state.load!);
  state.win.removeEventListener("unload", state.unload!);
  state.owner.removeEventListener("unload", state.ownerUnload!);
  if (states.get(state.owner) === state) states.delete(state.owner);
}

function outcome(row: RatingImportRow): string {
  const id = `rating-import-outcome-${row.status}` as FluentMessageId;
  return row.status === "ready"
    ? label(id, { rating: row.candidateRating || 0 })
    : label(id);
}

function css() {
  return `${dialogThemeCSS()}
    body { margin:0; font:menu; background:var(--zest-bg); color:var(--zest-fg); }
    .zest-rating-import { box-sizing:border-box; max-width:1100px; margin:auto; padding:24px; }
    .zest-rating-import h1 { margin:0; font-size:1.35rem; }
    .zest-rating-import p { color:var(--zest-muted); }
    .zest-rating-import table { width:100%; border-collapse:collapse; background:var(--zest-surface); box-shadow:var(--zest-shadow); }
    .zest-rating-import th, .zest-rating-import td { padding:9px 10px; border-bottom:1px solid var(--zest-line); text-align:left; vertical-align:top; }
    .zest-rating-import th { white-space:nowrap; color:var(--zest-muted); font-weight:600; }
    .zest-rating-import td { word-break:break-word; }
    .zest-rating-import .zest-rating-tags { color:var(--zest-muted); }
    .zest-rating-import .zest-rating-ready { color:var(--zest-stats-blue); font-weight:600; }
    .zest-rating-import-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:16px; }
    .zest-rating-import-actions { display:flex; gap:8px; }
    .zest-rating-import button { padding:7px 12px; }
    .zest-rating-import-status { min-height:1.5em; color:var(--zest-muted); }
  `;
}

function render(state: ImportState) {
  const { win } = state;
  const body = win.document.body;
  if (state.disposed || win.closed || !body) return;
  const doc = win.document;
  doc.title = label("rating-import-title");
  body.textContent = "";
  body.append(element(doc, "style", "", css()));
  const root = element(doc, "main", "zest-rating-import");
  root.append(
    element(doc, "h1", "", label("rating-import-title")),
    element(doc, "p", "", label("rating-import-subtitle")),
    element(
      doc,
      "p",
      "zest-rating-import-status",
      label("rating-import-summary", {
        total: state.preview.total,
        eligible: state.preview.eligible,
        skipped: state.preview.skipped,
      }),
    ),
  );
  if (!state.preview.rows.length) {
    root.append(element(doc, "p", "", label("rating-import-empty")));
    body.append(root);
    return;
  }
  const table = element(doc, "table");
  const head = element(doc, "thead");
  const headRow = element(doc, "tr");
  for (const id of [
    "rating-import-col-title",
    "rating-import-col-existing",
    "rating-import-col-tags",
    "rating-import-col-outcome",
  ] as FluentMessageId[])
    headRow.append(element(doc, "th", "", label(id)));
  head.append(headRow);
  table.append(head);
  const tableBody = element(doc, "tbody");
  const pages = Math.max(1, Math.ceil(state.preview.rows.length / PAGE_SIZE));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const start = state.page * PAGE_SIZE;
  for (const row of state.preview.rows.slice(start, start + PAGE_SIZE)) {
    const tr = element(doc, "tr");
    tr.append(
      element(doc, "td", "", row.title),
      element(
        doc,
        "td",
        "",
        row.existingRating ? String(row.existingRating) : "—",
      ),
      element(
        doc,
        "td",
        "zest-rating-tags",
        row.tagCandidates.join(" · ") || "—",
      ),
      element(
        doc,
        "td",
        row.status === "ready" ? "zest-rating-ready" : "",
        outcome(row),
      ),
    );
    tableBody.append(tr);
  }
  table.append(tableBody);
  root.append(table);
  const footer = element(doc, "div", "zest-rating-import-footer");
  const pager = element(doc, "div");
  const previous = element(doc, "button", "", label("rating-import-previous"));
  previous.disabled = state.page === 0 || state.committing;
  previous.addEventListener("click", () => {
    if (!state.disposed && state.page) {
      state.page--;
      render(state);
    }
  });
  const next = element(doc, "button", "", label("rating-import-next"));
  next.disabled = state.page >= pages - 1 || state.committing;
  next.addEventListener("click", () => {
    if (!state.disposed && state.page < pages - 1) {
      state.page++;
      render(state);
    }
  });
  pager.append(
    previous,
    doc.createTextNode(
      ` ${label("rating-import-range", {
        start: start + 1,
        end: Math.min(start + PAGE_SIZE, state.preview.rows.length),
        total: state.preview.rows.length,
      })} `,
    ),
    next,
  );
  const actions = element(doc, "div", "zest-rating-import-actions");
  const cancel = element(doc, "button", "", label("rating-import-cancel"));
  cancel.addEventListener("click", () => closeRatingImport(state.owner));
  const confirm = element(
    doc,
    "button",
    "",
    state.committing
      ? label("rating-import-working")
      : label("rating-import-confirm", { count: state.preview.eligible }),
  );
  confirm.disabled = state.committing || !state.preview.eligible;
  confirm.addEventListener("click", async () => {
    if (state.disposed || state.committing) return;
    state.committing = true;
    render(state);
    const result = await commitRatingImport(state.preview, {
      isCancelled: () =>
        !addon.data.alive ||
        state.disposed ||
        state.win.closed ||
        state.owner.closed,
      onProgress: () => {
        // Do not replace DOM while a click is being dispatched; the final
        // snapshot is enough feedback and keeps disposal checks simple.
      },
    });
    if (state.disposed || state.win.closed) return;
    state.committing = false;
    state.preview.eligible = state.preview.rows.filter(
      (row) => row.status === "ready" && row.candidateRating,
    ).length;
    state.preview.skipped = state.preview.total - state.preview.eligible;
    render(state);
    const feedback = doc.querySelector<HTMLElement>(
      ".zest-rating-import-status",
    );
    if (feedback)
      feedback.textContent = label("rating-import-result", {
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      });
  });
  actions.append(cancel, confirm);
  footer.append(pager, actions);
  root.append(footer);
  body.append(root);
}

/** Open one reviewed import dialog per owning Zotero window. */
export function openRatingImport(host: Window, items: Zotero.Item[]) {
  const present = states.get(host);
  if (present && !present.disposed && !present.win.closed) {
    present.win.focus();
    return;
  }
  if (present) dispose(present);
  if (!host?.openDialog) return;
  const win = host.openDialog(
    HOST_URL,
    "zest-rating-import",
    "chrome,centerscreen,resizable,width=1080,height=720",
  ) as Window | null;
  if (!win) return;
  const state: ImportState = {
    owner: host,
    win,
    preview: collectRatingImportPreview(items),
    page: 0,
    disposed: false,
    committing: false,
  };
  states.set(host, state);
  state.unload = () => {
    // Ignore the initial about:blank navigation, but also clean up if the
    // dialog is closed while its real document is still loading.
    if (state.win.closed || state.win.location.href === HOST_URL)
      dispose(state);
  };
  state.ownerUnload = () => closeRatingImport(host);
  win.addEventListener("unload", state.unload!);
  host.addEventListener("unload", state.ownerUnload!, { once: true });
  state.load = () => {
    if (
      state.disposed ||
      state.win.closed ||
      state.win.location.href !== HOST_URL
    )
      return;
    win.removeEventListener("load", state.load!);
    render(state);
  };
  if (win.document.readyState === "complete" && win.location.href === HOST_URL)
    state.load();
  else win.addEventListener("load", state.load);
}

export function closeRatingImport(host?: Window) {
  if (!host) return closeAllRatingImports();
  const state = states.get(host);
  if (!state) return;
  dispose(state);
  try {
    state.win.close();
  } catch {
    /* The host is already closing. */
  }
}

export function closeAllRatingImports() {
  for (const state of [...states.values()]) closeRatingImport(state.owner);
}
