import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import { openAttachmentAt } from "../utils/items";
import { iconLabelButton, ICON_CSS, type IconName } from "../ui/icons";
import { dialogThemeCSS } from "../ui/dialogTheme";
import { collectMatrixAsync } from "../annots/matrixSource";
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

const PAGE_SIZE = 100;
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
  feedback: number;
  timer: number;
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
    feedback: 0,
    timer: 0,
    disposed: false,
    loading: false,
  };
}

/** Reuse the matrix inside a dedicated iframe, never the owner's document. */
export function mountMatrix(win: Window, host: Window, source: MatrixSource) {
  if (win === host || win.location.href !== HOST_URL || !win.document.body)
    throw new Error("Matrix embedding requires a loaded panel iframe");
  const state = createState(win, host, source, true);
  state.unload = () => dispose(state);
  win.addEventListener("unload", state.unload, { once: true });
  renderState(state, win.document.body);
  return {
    refresh() {
      if (state.disposed) return;
      state.dirty = true;
      if (state.active) void state.refresh?.();
    },
    setActive(active: boolean) {
      if (state.disposed || state.active === active) return;
      state.active = active;
      if (!active) {
        state.generation++;
        state.feedback++;
        win.clearTimeout(state.timer);
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
  resultsBar.append(count, commentsLabel, sort, reset);
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
    const f = state.filters;
    const active = [f.item, f.type, f.color, f.tag].filter(Boolean).length;
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
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const start = state.page * PAGE_SIZE;
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
      for (const row of visible.slice(start, start + PAGE_SIZE))
        fragment.append(renderRow(row));
      list.append(fragment);
    }
    pager.hidden = state.loading || !visible.length;
    range.textContent = label("matrix-range", {
      start: visible.length ? start + 1 : 0,
      end: Math.min(start + PAGE_SIZE, visible.length),
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
    const copy = button(
      "anno-copy",
      "zest-matrix-copy",
      () => {
        state.feedback++;
        try {
          Zotero.Utilities.Internal.copyTextToClipboard(
            [row.text, row.comment].filter(Boolean).join("\n\n") ||
              row.sourceURL,
          );
          status.textContent = label("matrix-copied");
          const copyLabel = copy.querySelector("span");
          if (copyLabel) copyLabel.textContent = label("matrix-copied");
        } catch (e) {
          report("matrix-copy-failed", e);
        }
      },
      "copy",
    );
    copy.disabled = !hasText && !hasComment && !row.sourceURL;
    const open = button(
      "matrix-open",
      "zest-matrix-open",
      () => void navigate(row, open),
      "book",
    );
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
    const generation = ++state.generation;
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
      const rows = await collectMatrixAsync(items, cancelled);
      if (cancelled()) return;
      state.rows = rows;
      syncOptions();
    } catch (e) {
      if (cancelled()) return;
      // Do not present a previous scope's snapshot as the newly requested scope.
      state.rows = [];
      loadFailed = true;
      syncOptions();
      report("matrix-load-failed", e);
    }
    if (cancelled()) return;
    state.dirty = false;
    state.loading = false;
    updateResults();
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

function matrixCSS(): string {
  return `${dialogThemeCSS()} ${ICON_CSS}
    * { box-sizing:border-box; }
    body { margin:0; background:var(--zest-bg); color:var(--zest-fg); font:14px system-ui,sans-serif; }
    [hidden] { display:none !important; }
    .zest-matrix, .zest-matrix * { user-select:text; -moz-user-select:text; }
    button,select,summary { user-select:none !important; }
    .zest-matrix { max-width:1240px; margin:auto; padding:26px 30px; line-height:1.5; height:100vh; min-height:540px; display:flex; flex-direction:column; }
    .zest-matrix > * { flex-shrink:0; }
    .zest-matrix-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:22px; }
    h1 { margin:0; font-size:1.5rem; font-weight:650; letter-spacing:-.035em; }
    .zest-matrix-subtitle { margin:5px 0 0; color:var(--zest-muted); font-size:.8rem; }
    .zest-matrix-actions, .zest-matrix-bar, .zest-matrix-results-bar, .zest-matrix-row-actions { display:flex; gap:10px; align-items:center; }
    .zest-matrix-actions { margin-inline-start:auto; flex-shrink:0; }
    .zest-flat-btn,.zest-flat-input,.zest-flat-select { color:inherit; font:inherit; font-size:.82rem; border:1px solid var(--zest-line); border-radius:8px; background:var(--zest-surface); box-shadow:none; margin:0; }
    .zest-flat-btn { appearance:none; padding:6px 12px; cursor:pointer; line-height:1.5; }
    .zest-flat-btn:hover { background:var(--zest-fill); }
    button:disabled { opacity:.5; cursor:default; }
    :focus-visible { outline:2px solid var(--zest-accent); outline-offset:3px; }
    .zest-flat-input { padding:9px 12px; }
    .zest-flat-select { appearance:none; padding:8px 28px 8px 9px; min-width:0; max-width:100%; background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%); background-position:right 12px center,right 8px center; background-size:4px 4px,4px 4px; background-repeat:no-repeat; }
    .zest-matrix-tools { border:1px solid var(--zest-line); border-radius:12px; background:var(--zest-surface); padding:10px; }
    .zest-matrix-search { flex:1; width:0; min-width:100px; background:var(--zest-bg); border-color:transparent; }
    .zest-matrix-scope { max-width:13em; }
    .zest-matrix-filter-toggle { flex-shrink:0; }
    .zest-matrix-filters { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; padding:14px 2px 2px; }
    .zest-matrix-field { display:flex; flex-direction:column; gap:5px; font-size:.76rem; color:var(--zest-muted); min-width:0; }
    .zest-matrix-field select { color:var(--zest-fg); width:100%; }
    .zest-matrix-search-help { grid-column:1/-1; color:var(--zest-muted); font-size:.74rem; margin:0; }
    .zest-matrix-results-bar { flex-wrap:wrap; margin:16px 0 12px; font-size:.78rem; color:var(--zest-muted); }
    .zest-matrix-count { margin-inline-end:auto; font-variant-numeric:tabular-nums; }
    .zest-matrix-comments-label { display:flex; align-items:center; gap:5px; cursor:pointer; }
    input[type=checkbox] { accent-color:var(--zest-accent); }
    .zest-matrix-sort { font-size:.76rem; background-color:transparent; padding:4px 25px 4px 6px; border-color:transparent; }
    .zest-matrix-reset { font-size:.76rem; border-color:transparent; background:transparent; padding:4px 6px; color:var(--zest-accent); }
    .zest-matrix-status { color:var(--zest-accent); font-size:.8rem; margin:0 0 10px; overflow-wrap:anywhere; }
    .zest-matrix-status:empty { display:none; }
    .zest-matrix-list { border:1px solid var(--zest-line); border-radius:14px; background:var(--zest-surface); box-shadow:var(--zest-shadow); flex:1; min-height:160px; overflow:auto; scrollbar-width:thin; }
    .zest-matrix-row { display:grid; grid-template-columns:minmax(140px,22%) minmax(0,1fr); gap:28px; padding:22px 24px; }
    .zest-matrix-row + .zest-matrix-row { border-top:1px solid var(--zest-line); }
    .zest-matrix-source { min-width:0; }
    .zest-matrix-item-title { display:block; padding:0; background:none; border:0; border-radius:2px; text-align:start; font-size:.82rem; font-weight:550; line-height:1.6; overflow-wrap:anywhere; }
    .zest-matrix-item-title:hover { color:var(--zest-accent); background:none; }
    .zest-matrix-attachment { margin:7px 0 0; font-size:.72rem; line-height:1.5; color:var(--zest-muted); overflow-wrap:anywhere; }
    .zest-matrix-content { min-width:0; }
    .zest-matrix-meta { display:flex; align-items:center; gap:12px; flex-wrap:wrap; color:var(--zest-muted); font-size:.73rem; margin-bottom:8px; }
    .zest-matrix-type::before { content:""; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--annotation-color,var(--zest-muted)); margin-inline-end:7px; box-shadow:0 0 0 2px var(--zest-fill); }
    .zest-matrix-text,.zest-matrix-comment p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; font-size:.94rem; margin:0; }
    .zest-matrix-comment { margin-top:12px; padding:10px 14px; border-inline-start:2px solid var(--zest-stats-violet); background:color-mix(in srgb,var(--zest-stats-violet) 6%,var(--zest-surface)); border-radius:0 8px 8px 0; }
    .zest-matrix-comment-label { display:block; font-size:.7rem; color:var(--zest-muted); margin-bottom:3px; }
    .zest-matrix-no-text { color:var(--zest-muted); font-size:.84rem; margin:0; }
    .zest-matrix-expand { color:var(--zest-accent); border:0; padding:4px 0; font-size:.76rem; background:none; margin-top:4px; }
    .zest-matrix-row-foot { display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px; align-items:center; margin-top:14px; }
    .zest-matrix-tags { display:flex; gap:5px; flex-wrap:wrap; min-width:0; flex:1 1 10rem; }
    .zest-matrix-tag-chip { font-size:.69rem; color:var(--zest-muted); padding:2px 7px; border:0; background:var(--zest-fill); border-radius:5px; white-space:normal; overflow-wrap:anywhere; max-width:100%; }
    .zest-matrix-row-actions { gap:5px; margin-inline-start:auto; flex-wrap:wrap; max-width:100%; }
    .zest-matrix-row-actions button { font-size:.73rem; padding:4px 8px; }
    .zest-matrix-copy { border-color:transparent; background:transparent; color:var(--zest-muted); }
    .zest-matrix-open { color:var(--zest-accent); }
    .zest-matrix-export { position:relative; }
    .zest-matrix-export summary { white-space:nowrap; }
    .zest-matrix-export-menu { position:absolute; inset-inline-end:0; top:calc(100% + 8px); width:245px; max-width:calc(100vw - 32px); padding:14px; z-index:3; background:var(--zest-surface); border:1px solid var(--zest-line); border-radius:12px; box-shadow:var(--zest-shadow); display:flex; flex-direction:column; gap:10px; }
    .zest-matrix-export-menu p { margin:0 0 4px; }
    .zest-matrix-empty { text-align:center; padding:52px 20px; color:var(--zest-muted); }
    .zest-matrix-empty h2 { font-size:1rem; color:var(--zest-fg); font-weight:550; margin:0 0 8px; }
    .zest-matrix-empty p { font-size:.82rem; margin:0; }
    .zest-matrix-pager { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding:16px 0 2px; }
    .zest-matrix-range { margin-inline-end:auto; font-size:.78rem; color:var(--zest-muted); font-variant-numeric:tabular-nums; }
    @media(max-width:700px) {
      .zest-matrix { padding:20px 16px; }
      .zest-matrix-header { align-items:flex-start; flex-wrap:wrap; margin-bottom:16px; }
      .zest-matrix-row { grid-template-columns:minmax(0,1fr); gap:12px; padding:18px; }
      .zest-matrix-source { padding-bottom:10px; border-bottom:1px solid var(--zest-line); }
      .zest-matrix-attachment { margin-top:3px; }
      .zest-matrix-filters { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .zest-matrix-bar { flex-wrap:wrap; }
      .zest-matrix-search { order:-1; width:100%; flex-basis:100%; }
      .zest-matrix-scope { flex:1; max-width:none; }
      .zest-matrix-count { flex-basis:100%; }
    }
    @media(max-width:380px) {
      .zest-matrix-filters { grid-template-columns:minmax(0,1fr); }
      .zest-matrix { padding:16px 12px; }
      .zest-matrix-pager { flex-wrap:wrap; }
      .zest-matrix-range { flex-basis:100%; }
    }
    .zest-matrix.zest-matrix-embedded { padding:8px; min-height:0; max-width:none; overflow:auto; }
    .zest-matrix-embedded .zest-matrix-heading { display:none; }
    .zest-matrix-embedded .zest-matrix-header { margin-bottom:8px; gap:8px; }
    .zest-matrix-embedded .zest-matrix-actions { gap:6px; }
    .zest-matrix-embedded .zest-matrix-tools { padding:8px; border-radius:10px; }
    .zest-matrix-embedded .zest-matrix-bar { gap:6px; }
    .zest-matrix-embedded .zest-flat-btn { padding:5px 9px; }
    .zest-matrix-embedded .zest-matrix-search { padding:8px; }
    .zest-matrix-embedded .zest-matrix-results-bar { margin:10px 0 8px; gap:6px; }
    .zest-matrix-embedded .zest-matrix-list { min-height:0; border-radius:10px; }
    .zest-matrix-embedded .zest-matrix-row { padding:12px; gap:10px; }
    .zest-matrix-embedded .zest-matrix-source { padding-bottom:8px; }
    .zest-matrix-embedded .zest-matrix-item-title { padding:0; }
    .zest-matrix-embedded .zest-matrix-text,.zest-matrix-embedded .zest-matrix-comment p { font-size:.86rem; line-height:1.7; }
    .zest-matrix-embedded .zest-matrix-comment { padding:8px 10px; }
    .zest-matrix-embedded .zest-matrix-pager { padding:10px 0 0; gap:6px; }
    .zest-matrix-embedded .zest-matrix-empty { padding:24px 12px; }
  `;
}
