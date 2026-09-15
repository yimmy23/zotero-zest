import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import { openAttachmentAt } from "../utils/items";
import { iconLabelButton, type IconName } from "../ui/icons";
import { matrixCSS } from "./matrixStyles";
import { collectMatrixAsync } from "../annots/matrixSource";
import { annotationActionButton, annotationCopyText } from "../annots/actions";
import {
  emptyFilters,
  filterRows,
  toCSV,
  toMarkdown,
  type Filters,
  type MatrixRow,
} from "../annots/matrixModel";

export { collectMatrix } from "../annots/matrixSource";
export { matchesQuery, toCSV, toMarkdown } from "../annots/matrixModel";

const STANDALONE_PAGE_SIZE = 100;
const EMBEDDED_PAGE_SIZE = 25;
// These are Zotero.Notifier's data-changing events. UI-only redraw/index
// notifications do not change the annotation snapshot.
const MATRIX_INVALIDATION_EVENTS = new Set([
  "add",
  "modify",
  "delete",
  "move",
  "remove",
  "refresh",
  "trash",
]);
const HOST_URL = `chrome://${config.addonRef}/content/panel.xhtml`;
type Scope = "view" | "selected";
export interface MatrixSource {
  getItems(scope: Scope): Zotero.Item[];
  allowViewScope?: boolean;
  selectedLabel?: FluentMessageId;
}
interface MatrixState {
  win: Window;
  host: Window;
  source?: MatrixSource;
  embedded: boolean;
  active: boolean;
  dirty: boolean;
  pendingPaint: boolean;
  rows: MatrixRow[];
  filters: Filters;
  scope: Scope;
  page: number;
  generation: number;
  revision: number;
  dependencies: Set<string>;
  feedback: number;
  timer: number;
  refreshTimer?: number;
  notifierID?: string;
  disposed: boolean;
  loading: boolean;
  load?: EventListener;
  unload?: EventListener;
  refresh?: () => Promise<void>;
  repaint?: () => void;
}
const windows = new Map<Window, MatrixState>();

function label(id: FluentMessageId, args?: Record<string, string | number>) {
  return args ? getString(id, { args }) : getString(id);
}

function dispose(state: MatrixState) {
  if (state.disposed) return;
  state.disposed = true;
  state.generation++;
  state.feedback++;
  state.win.clearTimeout(state.timer);
  if (state.refreshTimer !== undefined) {
    state.win.clearTimeout(state.refreshTimer);
    state.refreshTimer = undefined;
  }
  if (state.notifierID !== undefined) {
    try {
      (Zotero as any).Notifier?.unregisterObserver?.(state.notifierID);
    } catch {
      // The host may be closing; disposal is still complete.
    }
    state.notifierID = undefined;
  }
  if (state.load) state.win.removeEventListener("load", state.load);
  if (state.unload) state.win.removeEventListener("unload", state.unload);
  state.rows = [];
  if (windows.get(state.win) === state) windows.delete(state.win);
}

export function closeMatrix() {
  for (const state of windows.values()) {
    dispose(state);
    try {
      state.win.close();
    } catch {
      /* Already closing. */
    }
  }
  // Also recover windows left by an older plugin copy.
  for (const win of (Services.wm as any).getEnumerator("") as any) {
    try {
      if (
        win?.location?.href === HOST_URL &&
        !win.frameElement &&
        win.document?.querySelector?.(".zest-matrix")
      )
        win.close();
    } catch {
      /* Already closing. */
    }
  }
}

export function openMatrix(parent?: Window, source?: MatrixSource) {
  const host = (parent || Zotero.getMainWindow()) as Window | null;
  if (!host?.openDialog) return;
  for (const state of windows.values()) {
    if (state.win.closed) dispose(state);
    else if (state.host === host) {
      state.win.focus();
      if (state.source !== source) {
        state.source = source;
        state.scope = source ? "selected" : "view";
        render(state.win);
      } else void state.refresh?.();
      return;
    }
  }
  // An empty name prevents another library window's dialog being reused.
  const win = host.openDialog(
    HOST_URL,
    "",
    "chrome,centerscreen,resizable,width=1100,height=780",
  ) as Window | null;
  if (!win) return;
  const state = createState(win, host, source);
  windows.set(win, state);
  const load = guard("matrix load", () => {
    if (
      state.disposed ||
      win.closed ||
      win.location.href !== HOST_URL ||
      !win.document.body
    )
      return;
    win.removeEventListener("load", load);
    state.load = undefined;
    // about:blank unload must not cancel the actual dialog's first load.
    state.unload = () => dispose(state);
    win.addEventListener("unload", state.unload, { once: true });
    render(win);
  });
  state.load = load;
  if (win.document.readyState === "complete" && win.location.href === HOST_URL)
    load();
  else win.addEventListener("load", load);
}

function createState(
  win: Window,
  host: Window,
  source?: MatrixSource,
  embedded = false,
): MatrixState {
  return {
    win,
    host,
    source,
    embedded,
    active: true,
    dirty: true,
    pendingPaint: false,
    rows: [],
    filters: emptyFilters(),
    scope: embedded || source ? "selected" : "view",
    page: 0,
    generation: 0,
    revision: 0,
    dependencies: new Set(),
    feedback: 0,
    timer: 0,
    disposed: false,
    loading: false,
  };
}

function queueRefresh(state: MatrixState) {
  if (
    state.disposed ||
    !state.active ||
    state.loading ||
    state.refreshTimer !== undefined
  )
    return;
  state.refreshTimer = state.win.setTimeout(() => {
    state.refreshTimer = undefined;
    if (state.disposed || !state.active || state.loading || !state.dirty)
      return;
    void state.refresh?.();
  }, 0);
}

function markDirty(state: MatrixState) {
  if (state.disposed) return;
  state.dirty = true;
  state.revision++;
  queueRefresh(state);
}

function dependencyID(value: unknown): string | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
}

function sourceDependencyIDs(
  items: Zotero.Item[],
  rows: MatrixRow[] = [],
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    const id = dependencyID(item?.id);
    if (id) ids.add(id);
    try {
      // Include trashed children: restoring one emits a child-only modify
      // notification, while the normal source walk intentionally omits it.
      const attachments = item?.isRegularItem?.()
        ? item.getAttachments(true)
        : [];
      if (Array.isArray(attachments)) {
        for (const attachmentID of attachments) {
          const attachment = dependencyID(attachmentID);
          if (attachment) ids.add(attachment);
        }
      }
    } catch {
      // A stale source row must not prevent the matrix from loading.
    }
  }
  for (const row of rows) {
    const owner = dependencyID(row.itemID);
    const attachment = dependencyID(row.attachment?.id);
    const annotation = dependencyID(row.annotation?.id);
    if (owner) ids.add(owner);
    if (attachment) ids.add(attachment);
    if (annotation) ids.add(annotation);
  }
  return ids;
}

function notifierItemIDs(
  type: string,
  ids: unknown,
): { values: Set<string>; unknown: boolean } {
  const values = new Set<string>();
  if (!Array.isArray(ids) || !ids.length) return { values, unknown: true };
  let unknown = false;
  for (const raw of ids) {
    const value =
      type === "item-tag" ? String(raw).split("-", 1)[0] : String(raw);
    const id = dependencyID(value);
    if (id) values.add(id);
    else unknown = true;
  }
  return { values, unknown };
}

function hasScopedParent(
  state: MatrixState,
  ids: Set<string>,
): boolean | undefined {
  const items = (Zotero as any).Items;
  const get = items?.get;
  if (typeof get !== "function") return undefined;
  for (const value of ids) {
    let current = value;
    for (let depth = 0; depth <= 2; depth++) {
      if (state.dependencies.has(current)) return true;
      let item: any;
      let itemID: string | undefined;
      let parentID: string | undefined;
      try {
        item = get.call(items, Number(current));
        if (!item) return undefined;
        itemID = dependencyID(item.id);
        parentID = dependencyID(item.parentItemID);
      } catch {
        return undefined;
      }
      if (!itemID) return undefined;
      if (itemID && state.dependencies.has(itemID)) return true;
      if (!parentID || parentID === current) break;
      current = parentID;
    }
  }
  return false;
}

function affectsMatrix(
  state: MatrixState,
  event: string,
  type: string,
  ids: unknown,
): boolean {
  const parsed = notifierItemIDs(type, ids);
  if ([...parsed.values].some((id) => state.dependencies.has(id))) return true;
  // Adds/deletes/moves can describe a newly created or already unloaded
  // annotation, whose ID is not in the settled snapshot. Unknown ranges
  // therefore invalidate conservatively; unrelated modifies stay cheap.
  if (parsed.unknown) return true;
  // While the first/next scan is still building its dependency set, a new or
  // reparented annotation may not be listed yet. A conservative rerun here
  // prevents that event from being lost without looking up the item.
  if (state.loading) return true;
  if (
    event === "modify" &&
    type === "item" &&
    hasScopedParent(state, parsed.values) !== false
  )
    return true;
  if (type === "item-tag") return false;
  return event !== "modify";
}

function watchMatrix(state: MatrixState) {
  if (state.notifierID !== undefined) return;
  const notifier = (Zotero as any).Notifier;
  if (
    typeof notifier?.registerObserver !== "function" ||
    typeof notifier?.unregisterObserver !== "function"
  )
    return;
  try {
    state.notifierID = notifier.registerObserver(
      {
        notify: (event: string, type: string, ids: unknown) => {
          if (
            (type !== "item" && type !== "item-tag") ||
            !MATRIX_INVALIDATION_EVENTS.has(event)
          )
            return;
          // Hidden frames do not need scope filtering: keep the callback
          // cheap and let resume perform one conservative refresh.
          if (!state.active) {
            markDirty(state);
            return;
          }
          if (affectsMatrix(state, event, type, ids)) markDirty(state);
        },
      },
      ["item", "item-tag"],
      `${config.addonRef}-matrix`,
      60,
    );
  } catch (e) {
    ztoolkit.log("[matrix] notifier unavailable", e);
  }
}

/** Reuse the matrix inside a dedicated iframe, never the owner's document. */
export function mountMatrix(win: Window, host: Window, source: MatrixSource) {
  if (win === host || win.location.href !== HOST_URL || !win.document.body)
    throw new Error("Matrix embedding requires a loaded panel iframe");
  const state = createState(win, host, source, true);
  state.unload = () => dispose(state);
  win.addEventListener("unload", state.unload, { once: true });
  renderState(state, win.document.body);
  watchMatrix(state);
  return {
    refresh() {
      if (state.disposed) return;
      markDirty(state);
      if (state.active && !state.loading) void state.refresh?.();
    },
    setActive(active: boolean) {
      if (state.disposed || state.active === active) return;
      state.active = active;
      if (!active) {
        state.generation++;
        state.feedback++;
        win.clearTimeout(state.timer);
        if (state.refreshTimer !== undefined) {
          win.clearTimeout(state.refreshTimer);
          state.refreshTimer = undefined;
        }
        // An interrupted scan must be retried; a settled snapshot is reusable.
        state.dirty ||= state.loading;
        state.loading = false;
      } else if (state.dirty) void state.refresh?.();
      else if (state.pendingPaint) state.repaint?.();
    },
    dispose: () => dispose(state),
  };
}

const TYPE_LABELS: Record<string, FluentMessageId> = {
  highlight: "matrix-type-highlight",
  underline: "matrix-type-underline",
  note: "matrix-type-note",
  text: "matrix-type-text",
  image: "matrix-type-image",
  ink: "matrix-type-ink",
};
function typeLabel(type: string) {
  return label(TYPE_LABELS[type] || "matrix-col-text");
}
const COLOR_LABELS: Record<string, FluentMessageId> = {
  "#ffd400": "matrix-color-yellow",
  "#ff6666": "matrix-color-red",
  "#5fb236": "matrix-color-green",
  "#2ea8e5": "matrix-color-blue",
  "#a28ae5": "matrix-color-purple",
  "#e56eee": "matrix-color-magenta",
  "#f19837": "matrix-color-orange",
  "#aaaaaa": "matrix-color-gray",
};

/** A stable shell; filtering only replaces the bounded list, never the inputs. */
export function render(win: Window) {
  const state = windows.get(win);
  if (!state || state.disposed || !win.document.body) return;
  renderState(state, win.document.body);
}

function renderState(state: MatrixState, body: HTMLElement) {
  const win = state.win;
  state.feedback++;
  win.clearTimeout(state.timer);
  state.generation++;
  const doc = win.document;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = "",
    text = "",
  ) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (
    id: FluentMessageId,
    cls: string,
    action: () => void,
    name?: IconName,
  ) => {
    const b = name
      ? iconLabelButton(doc, name, label(id), `zest-flat-btn ${cls}`)
      : el("button", `zest-flat-btn ${cls}`, label(id));
    b.type = "button";
    b.addEventListener(
      "click",
      guard(`matrix ${id}`, () => {
        if (state.active && !state.disposed) action();
      }),
    );
    return b;
  };
  doc.title = label("matrix-title");
  body.textContent = "";
  const style = el("style");
  style.textContent = matrixCSS();
  const root = el(
    "main",
    `zest-matrix${state.embedded ? " zest-matrix-embedded" : ""}`,
  );
  body.append(style, root);
  const header = el("header", "zest-matrix-header");
  const heading = el("div", "zest-matrix-heading");
  heading.append(
    el("h1", "", label("matrix-title")),
    el("p", "zest-matrix-subtitle", label("matrix-subtitle")),
  );
  const actions = el("div", "zest-matrix-actions");
  const refresh = button(
    "matrix-refresh",
    "zest-matrix-refresh",
    () => void reload(),
    "refresh",
  );
  const exports = el("details", "zest-matrix-export");
  const exportSummary = el("summary", "zest-flat-btn", label("matrix-export"));
  const exportMenu = el("div", "zest-matrix-export-menu");
  const exportHint = el("p", "zest-matrix-subtitle");
  const copyMD = button(
    "matrix-copy-md",
    "zest-matrix-copy-md",
    copyMarkdown,
    "copy",
  );
  const csv = button(
    "matrix-export-csv",
    "zest-matrix-export-csv",
    () => void save("csv"),
    "download",
  );
  const md = button(
    "matrix-export-md",
    "zest-matrix-export-md",
    () => void save("md"),
    "download",
  );
  exportMenu.append(exportHint, copyMD, md, csv);
  exports.append(exportSummary, exportMenu);
  actions.append(refresh, exports);
  header.append(heading, actions);
  root.append(header);

  const tools = el("section", "zest-matrix-tools");
  tools.setAttribute("aria-label", label("matrix-filters"));
  const bar = el("div", "zest-matrix-bar");
  const scope = el("select", "zest-flat-select zest-matrix-scope");
  scope.setAttribute("aria-label", label("matrix-scope"));
  const allowViewScope = !state.source || !!state.source.allowViewScope;
  const scopeOptions = [
    ...(allowViewScope ? [["view", label("matrix-scope-view")]] : []),
    ["selected", label(state.source?.selectedLabel || "matrix-scope-selected")],
  ];
  for (const [value, text] of scopeOptions) {
    const option = el("option", "", text);
    option.value = value;
    scope.append(option);
  }
  scope.disabled = !allowViewScope;
  scope.value = state.scope;
  scope.addEventListener(
    "change",
    guard("matrix scope", () => {
      if (!state.active || state.disposed) return;
      state.scope =
        allowViewScope && scope.value === "view" ? "view" : "selected";
      void reload();
    }),
  );
  const search = el("input", "zest-matrix-search zest-flat-input");
  search.type = "search";
  search.placeholder = label("matrix-search-placeholder");
  search.setAttribute("aria-label", label("matrix-search-placeholder"));
  search.setAttribute("aria-describedby", "matrix-search-help");
  search.value = state.filters.query;
  search.addEventListener(
    "input",
    guard("matrix search", () => {
      if (!state.active || state.disposed) return;
      state.filters.query = search.value;
      state.page = 0;
      state.pendingPaint = true;
      win.clearTimeout(state.timer);
      const generation = state.generation;
      state.timer = win.setTimeout(() => {
        if (state.active && generation === state.generation) updateResults();
      }, 140);
    }),
  );
  const filterToggle = button(
    "matrix-filters",
    "zest-matrix-filter-toggle",
    () => {
      filterPanel.hidden = !filterPanel.hidden;
      filterToggle.setAttribute("aria-expanded", String(!filterPanel.hidden));
    },
    "sort",
  );
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.setAttribute("aria-controls", "matrix-filters");
  bar.append(scope, search, filterToggle);
  const filterPanel = el("div", "zest-matrix-filters");
  filterPanel.id = "matrix-filters";
  filterPanel.hidden = true;
  const selects = new Map<
    "item" | "type" | "color" | "tag",
    HTMLSelectElement
  >();
  for (const [key, id] of [
    ["item", "matrix-col-item"],
    ["type", "matrix-type"],
    ["color", "matrix-color"],
    ["tag", "matrix-col-tags"],
  ] as const) {
    const field = el("label", "zest-matrix-field", label(id));
    const select = el("select", `zest-flat-select zest-matrix-${key}`);
    select.setAttribute("aria-label", label(id));
    selects.set(key, select);
    select.addEventListener(
      "change",
      guard(`matrix filter ${key}`, () => {
        if (!state.active || state.disposed) return;
        state.filters[key] = select.value;
        updateResults();
      }),
    );
    field.append(select);
    filterPanel.append(field);
  }
  const searchHelp = el(
    "p",
    "zest-matrix-search-help",
    label("matrix-search-help"),
  );
  searchHelp.id = "matrix-search-help";
  filterPanel.append(searchHelp);
  tools.append(bar, filterPanel);
  root.append(tools);

  const resultsBar = el("div", "zest-matrix-results-bar");
  const count = el("span", "zest-matrix-count");
  count.setAttribute("role", "status");
  const commentsLabel = el("label", "zest-matrix-comments-label");
  const comments = el("input", "zest-matrix-comments");
  comments.type = "checkbox";
  comments.checked = state.filters.commentsOnly;
  comments.addEventListener(
    "change",
    guard("matrix comments", () => {
      if (!state.active || state.disposed) return;
      state.filters.commentsOnly = comments.checked;
      updateResults();
    }),
  );
  commentsLabel.append(comments, el("span", "", label("matrix-comments-only")));
  const sort = el("select", "zest-flat-select zest-matrix-sort");
  sort.setAttribute("aria-label", label("matrix-sort"));
  for (const [value, id] of [
    ["source", "matrix-sort-source"],
    ["title", "matrix-sort-title"],
  ] as const) {
    const option = el("option", "", label(id));
    option.value = value;
    sort.append(option);
  }
  sort.value = state.filters.sort;
  sort.addEventListener(
    "change",
    guard("matrix sort", () => {
      if (!state.active || state.disposed) return;
      state.filters.sort = sort.value as Filters["sort"];
      updateResults();
    }),
  );
  const reset = button("matrix-reset", "zest-matrix-reset", () => {
    state.filters = emptyFilters();
    search.value = "";
    comments.checked = false;
    sort.value = "source";
    for (const select of selects.values()) select.value = "";
    updateResults();
    search.focus();
  });
  const sortField = el("label", "zest-matrix-field", label("matrix-sort"));
  sortField.append(sort);
  filterPanel.append(sortField, commentsLabel);
  resultsBar.append(count, reset);
  root.append(resultsBar);
  const status = el("p", "zest-matrix-status");
  status.setAttribute("role", "status");
  root.append(status);
  const list = el("section", "zest-matrix-list");
  list.setAttribute("aria-label", label("matrix-col-text"));
  root.append(list);
  const pager = el("nav", "zest-matrix-pager");
  pager.setAttribute("aria-label", label("matrix-pagination"));
  const range = el("span", "zest-matrix-range");
  const prev = button("matrix-previous", "zest-matrix-previous", () =>
    turnPage(-1),
  );
  const next = button("matrix-next", "zest-matrix-next", () => turnPage(1));
  pager.append(range, prev, next);
  root.append(pager);
  let visible: MatrixRow[] = [];
  let exporting = false;
  let loadFailed = false;

  function syncOptions() {
    const unique = <T>(values: T[]) => [...new Set(values)];
    const options: Record<
      "item" | "type" | "color" | "tag",
      Array<[string, string]>
    > = {
      item: [
        ...new Map(
          state.rows.map((r) => [
            r.itemIdentity,
            r.itemTitle || label("matrix-untitled"),
          ]),
        ).entries(),
      ],
      type: unique(state.rows.map((r) => r.type))
        .filter(Boolean)
        .map((t) => [t, typeLabel(t)]),
      color: unique(state.rows.map((r) => r.color))
        .filter(Boolean)
        .map((c) => [c, COLOR_LABELS[c] ? label(COLOR_LABELS[c]) : c]),
      tag: unique(state.rows.flatMap((r) => r.tags))
        .sort()
        .map((t) => [t, t]),
    };
    const all = {
      item: "matrix-all-items",
      type: "matrix-all-types",
      color: "matrix-all-colors",
      tag: "matrix-all-tags",
    } as const;
    for (const [key, select] of selects) {
      select.textContent = "";
      if (!options[key].some(([v]) => v === state.filters[key]))
        state.filters[key] = "";
      for (const [value, title] of [["", label(all[key])], ...options[key]]) {
        const option = el("option", "", title);
        option.value = value;
        select.append(option);
      }
      select.value = state.filters[key];
    }
  }

  function updateResults() {
    win.clearTimeout(state.timer);
    if (state.disposed || !state.active) return;
    state.pendingPaint = false;
    state.page = 0;
    visible = filterRows(state.rows, state.filters);
    paint();
  }
  function paint() {
    if (state.disposed || !state.active) return;
    const pageSize = state.embedded ? EMBEDDED_PAGE_SIZE : STANDALONE_PAGE_SIZE;
    const f = state.filters;
    const active = [f.item, f.type, f.color, f.tag, f.commentsOnly].filter(
      Boolean,
    ).length;
    const filterText = filterToggle.querySelector("span");
    if (filterText)
      filterText.textContent =
        label("matrix-filters") + (active ? ` · ${active}` : "");
    reset.hidden = !(
      active ||
      f.query ||
      f.commentsOnly ||
      f.sort !== "source"
    );
    count.textContent = state.loading
      ? label("matrix-loading")
      : loadFailed
        ? ""
        : label("matrix-count", {
            shown: visible.length,
            total: state.rows.length,
          });
    exportHint.textContent = label("matrix-export-hint", {
      count: visible.length,
    });
    csv.disabled =
      md.disabled =
      copyMD.disabled =
        state.loading || exporting || !visible.length;
    refresh.disabled = state.loading;
    list.setAttribute("aria-busy", String(state.loading));
    list.textContent = "";
    const pages = Math.max(1, Math.ceil(visible.length / pageSize));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const start = state.page * pageSize;
    if (state.loading || !visible.length) {
      const empty = el("div", "zest-matrix-empty");
      empty.append(
        el(
          "h2",
          "",
          label(
            state.loading
              ? "matrix-loading"
              : loadFailed
                ? "matrix-unavailable"
                : state.rows.length
                  ? "matrix-empty-filter"
                  : "matrix-empty",
          ),
        ),
      );
      if (!state.loading && !loadFailed)
        empty.append(
          el(
            "p",
            "",
            label(
              state.rows.length
                ? "matrix-empty-filter-hint"
                : "matrix-empty-hint",
            ),
          ),
        );
      list.append(empty);
    } else {
      const fragment = doc.createDocumentFragment();
      for (const row of visible.slice(start, start + pageSize))
        fragment.append(renderRow(row));
      list.append(fragment);
    }
    pager.hidden = state.loading || !visible.length;
    range.textContent = label("matrix-range", {
      start: visible.length ? start + 1 : 0,
      end: Math.min(start + pageSize, visible.length),
      total: visible.length,
    });
    prev.disabled = state.page === 0;
    next.disabled = state.page + 1 >= pages;
  }
  function turnPage(delta: number) {
    state.page += delta;
    paint();
    list.scrollTop = 0;
    // The invoking button may become disabled at the boundary.
    focusResults();
  }
  function focusResults() {
    list.tabIndex = -1;
    list.focus({ preventScroll: true });
  }

  function renderRow(row: MatrixRow) {
    const article = el("article", "zest-matrix-row");
    const source = el("div", "zest-matrix-source");
    const title = button("matrix-col-item", "zest-matrix-item-title", () => {
      state.filters.item = row.itemIdentity;
      selects.get("item")!.value = row.itemIdentity;
      updateResults();
      focusResults();
    });
    title.textContent = row.itemTitle || label("matrix-untitled");
    title.title = `${label("matrix-filter-item")} · ${title.textContent}`;
    source.append(title);
    if (row.attachmentTitle && row.attachmentTitle !== row.itemTitle)
      source.append(el("p", "zest-matrix-attachment", row.attachmentTitle));
    const content = el("div", "zest-matrix-content");
    const meta = el("div", "zest-matrix-meta");
    const type = el("span", "zest-matrix-type", typeLabel(row.type));
    if (/^#[\da-f]{6}$/i.test(row.color))
      type.style.setProperty("--annotation-color", row.color);
    meta.append(type);
    if (row.page)
      meta.append(
        el(
          "span",
          "zest-matrix-page",
          label("matrix-page", { page: row.page }),
        ),
      );
    content.append(meta);
    const text = el("p", "zest-matrix-text");
    const comment = el("div", "zest-matrix-comment");
    const commentText = el("p");
    const hasText = !!row.text.trim();
    const hasComment = !!row.comment.trim();
    if (hasText) content.append(text);
    if (hasComment) {
      comment.append(
        el("span", "zest-matrix-comment-label", label("matrix-comment")),
        commentText,
      );
      content.append(comment);
    }
    if (!hasText && !hasComment)
      content.append(el("p", "zest-matrix-no-text", label("matrix-no-text")));
    let expanded = false;
    const long = row.text.length > 650 || row.comment.length > 650;
    const expand = button("matrix-expand", "zest-matrix-expand", () => {
      expanded = !expanded;
      paintText();
    });
    function paintText() {
      const preview = (value: string) =>
        !expanded && value.length > 650 ? `${value.slice(0, 650)}…` : value;
      text.textContent = preview(row.text);
      commentText.textContent = preview(row.comment);
      expand.textContent = label(
        expanded ? "matrix-collapse" : "matrix-expand",
      );
      expand.setAttribute("aria-expanded", String(expanded));
    }
    paintText();
    if (long) content.append(expand);
    const foot = el("div", "zest-matrix-row-foot");
    const tags = el("div", "zest-matrix-tags");
    for (const tag of row.tags) {
      const tagButton = button(
        "matrix-col-tags",
        "zest-matrix-tag-chip",
        () => {
          state.filters.tag = tag;
          selects.get("tag")!.value = tag;
          updateResults();
          focusResults();
        },
      );
      tagButton.textContent = tag;
      tagButton.title = label("matrix-filter-tag", { tag });
      tags.append(tagButton);
    }
    const rowActions = el("div", "zest-matrix-row-actions");
    const copy = annotationActionButton(
      doc,
      "copy",
      "zest-flat-btn zest-matrix-copy",
    );
    copy.addEventListener("click", () => {
      if (state.disposed || !state.active || !copy.isConnected) return;
      state.feedback++;
      try {
        Zotero.Utilities.Internal.copyTextToClipboard(annotationCopyText(row));
        status.textContent = label("matrix-copied");
        const copyLabel = copy.querySelector("span");
        if (copyLabel) copyLabel.textContent = label("matrix-copied");
      } catch (e) {
        report("matrix-copy-failed", e);
      }
    });
    copy.disabled = !hasText && !hasComment && !row.sourceURL;
    const open = annotationActionButton(
      doc,
      "open",
      "zest-flat-btn zest-matrix-open",
    );
    open.addEventListener("click", () => {
      if (!state.disposed && state.active && open.isConnected)
        void navigate(row, open);
    });
    rowActions.append(copy, open);
    foot.append(tags, rowActions);
    content.append(foot);
    article.append(source, content);
    return article;
  }

  async function navigate(row: MatrixRow, button: HTMLButtonElement) {
    const feedback = ++state.feedback;
    status.textContent = "";
    button.disabled = true;
    try {
      const opened = await openAttachmentAt(row.attachment, {
        annotationID: row.key,
      });
      if (opened === false) throw new Error("Attachment unavailable");
    } catch (e) {
      report("matrix-open-failed", e, feedback);
    } finally {
      if (!state.disposed) {
        if (state.active) button.disabled = false;
        else state.pendingPaint = true;
      }
    }
  }
  function report(id: FluentMessageId, e: unknown, feedback = state.feedback) {
    ztoolkit.log(`[matrix] ${id}`, e);
    if (state.active && !state.disposed && feedback === state.feedback)
      status.textContent = label(id);
  }
  function markdown(snapshot: MatrixRow[]) {
    return toMarkdown(snapshot, {
      comment: label("matrix-comment"),
      page: label("matrix-col-page"),
      tags: label("matrix-col-tags"),
      source: label("matrix-open"),
    });
  }
  function copyMarkdown() {
    if (state.disposed || !state.active || exporting || state.loading) return;
    // A click may precede the search debounce. Never copy the paged DOM.
    const snapshot = filterRows(state.rows, state.filters);
    if (!snapshot.length) return;
    const feedback = ++state.feedback;
    exports.open = false;
    exportSummary.focus();
    try {
      if (typeof Zotero.Utilities.Internal.copyTextToClipboard !== "function")
        throw new Error("Clipboard API unavailable");
      Zotero.Utilities.Internal.copyTextToClipboard(markdown(snapshot));
      status.textContent = label("matrix-copied-md", {
        count: snapshot.length,
      });
    } catch (e) {
      report("matrix-copy-failed", e, feedback);
    }
  }
  async function save(kind: "csv" | "md") {
    if (state.disposed || !state.active || exporting || state.loading) return;
    // Read the current query even if its debounce has not painted yet.
    const snapshot = filterRows(state.rows, state.filters);
    if (!snapshot.length) return;
    const feedback = ++state.feedback;
    status.textContent = "";
    exporting = true;
    csv.disabled = md.disabled = copyMD.disabled = true;
    exports.open = false;
    try {
      const FilePicker = ztoolkit.FilePicker as any;
      const path = await new FilePicker(
        label("matrix-title"),
        "save",
        kind === "csv" ? [["CSV", "*.csv"]] : [["Markdown", "*.md"]],
        kind === "csv" ? "annotations.csv" : "annotations.md",
      ).open();
      if (!path || state.disposed) return;
      await Zotero.File.putContentsAsync(
        path,
        kind === "csv" ? toCSV(snapshot) : markdown(snapshot),
      );
      if (state.active && !state.disposed && feedback === state.feedback)
        status.textContent = label("matrix-exported", {
          count: snapshot.length,
        });
    } catch (e) {
      report("matrix-export-failed", e, feedback);
    } finally {
      exporting = false;
      if (state.active && !state.disposed)
        csv.disabled =
          md.disabled =
          copyMD.disabled =
            state.loading || !visible.length;
      else if (!state.disposed) state.pendingPaint = true;
    }
  }
  async function reload() {
    if (state.disposed) return;
    state.dirty = true;
    if (!state.active) return;
    if (state.refreshTimer !== undefined) {
      win.clearTimeout(state.refreshTimer);
      state.refreshTimer = undefined;
    }
    const generation = ++state.generation;
    const revision = state.revision;
    state.feedback++;
    const cancelled = () =>
      state.disposed ||
      !state.active ||
      win.closed ||
      generation !== state.generation;
    win.clearTimeout(state.timer);
    state.loading = true;
    loadFailed = false;
    status.textContent = "";
    paint();
    try {
      if (state.host.closed) throw new Error("Source library window closed");
      let items: Zotero.Item[] | undefined;
      if (state.source) items = state.source.getItems(state.scope);
      else {
        const pane = (state.host as any).ZoteroPane;
        items =
          state.scope === "selected"
            ? pane?.getSelectedItems?.()
            : pane?.itemsView?.getSortedItems?.();
      }
      if (!Array.isArray(items)) throw new Error("Source view unavailable");
      // Capture source identities before the async walk so a refresh emitted
      // during that walk can still be matched without a callback lookup. This
      // includes attachments with no annotations in the current snapshot.
      const dependencies = sourceDependencyIDs(items);
      for (const id of dependencies) state.dependencies.add(id);
      const rows = await collectMatrixAsync(items, cancelled);
      if (cancelled()) return;
      if (state.revision !== revision) {
        // Do not publish a snapshot built before the notifier event. Keep the
        // loading shell visible and immediately merge one replacement scan.
        state.loading = false;
        state.dirty = true;
        void state.refresh?.();
        return;
      }
      state.rows = rows;
      // Add row-level IDs without walking source attachments a second time.
      for (const id of sourceDependencyIDs([], rows)) dependencies.add(id);
      state.dependencies = dependencies;
      syncOptions();
    } catch (e) {
      if (cancelled()) return;
      if (state.revision !== revision) {
        state.loading = false;
        state.dirty = true;
        void state.refresh?.();
        return;
      }
      // Do not present a previous scope's snapshot as the newly requested scope.
      state.rows = [];
      loadFailed = true;
      syncOptions();
      report("matrix-load-failed", e);
    }
    if (cancelled()) return;
    state.loading = false;
    updateResults();
    state.dirty = false;
  }
  state.refresh = reload;
  state.repaint = () => {
    if (state.disposed || !state.active) return;
    state.pendingPaint = false;
    visible = filterRows(state.rows, state.filters);
    paint();
  };
  // Cmd/Ctrl+F focuses only this window's search, without changing the library.
  root.addEventListener("keydown", (e) => {
    if (!state.active || state.disposed) return;
    const event = e as KeyboardEvent;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (event.key === "Escape" && exports.open) {
      exports.open = false;
      exportSummary.focus();
      event.preventDefault();
    }
  });
  syncOptions();
  void reload();
}
