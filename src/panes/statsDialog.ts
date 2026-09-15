import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import { getPref, setPref } from "../utils/prefs";
import { readingStore, splitKey } from "../reading/store";
import {
  aggregateReadingStats,
  aggregateReadingGoals,
  readingPeriod,
  readingGoals,
  addDays,
  isoDay,
  type StatsRange,
  type ReadingStats,
  type ReadingGoalsStats,
  type PeriodStats,
} from "../reading/statistics";
import { icon } from "../ui/icons";
import { statsCSS } from "./statsStyles";

// A snapshot on open / explicit refresh: no tracker subscription or hidden
// window work. All statistics and achievements are derived, never persisted.
let openWindow: Window | null = null;
type StatsState = {
  embedded: boolean;
  active: boolean;
  dirty: boolean;
  range: StatsRange;
  snapshot?: ReturnType<typeof collectStats>;
  compactGoalsSnapshot?: ReadingGoalsStats;
  compactGoalSignature?: string;
  loaded: boolean;
  unsubscribe?: () => void;
  onOpenDetails?: () => void;
  root?: HTMLElement;
  style?: HTMLElement;
};
const states = new WeakMap<Window, StatsState>();
const pendingLoads = new WeakMap<Window, EventListener>();
const panelURL = `chrome://${config.addonRef}/content/panel.xhtml`;

function createState(win: Window, embedded = false): StatsState {
  const previous = states.get(win);
  if (previous) disposeState(win, previous);
  const state: StatsState = {
    embedded,
    active: true,
    dirty: true,
    range: 30,
    loaded: readingStore.loaded,
  };
  states.set(win, state);
  if (embedded) {
    state.unsubscribe = readingStore.onChange(() => {
      if (states.get(win) !== state) return;
      const wasLoaded = state.loaded;
      state.loaded = readingStore.loaded;
      state.dirty = true;
      // Loading is the one live transition that must not leave a previously
      // unavailable panel showing the permanent "not ready" state.
      if (state.active && !wasLoaded && state.loaded) renderStats(win);
    });
  }
  return state;
}

function disposeState(win: Window, state: StatsState) {
  state.active = false;
  state.dirty = false;
  state.range = 30;
  state.snapshot = undefined;
  state.compactGoalsSnapshot = undefined;
  state.compactGoalSignature = undefined;
  state.unsubscribe?.();
  state.unsubscribe = undefined;
  state.onOpenDetails = undefined;
  state.root?.remove();
  state.style?.remove();
  state.root = undefined;
  state.style = undefined;
  if (states.get(win) === state) states.delete(win);
}

/** Mount only after the sidebar's dedicated panel.xhtml frame is visible. */
export function mountStats(win: Window, onOpenDetails?: () => void) {
  const state = createState(win, true);
  state.onOpenDetails = onOpenDetails || (() => openStatsDialog());
  const ownsState = () => states.get(win) === state && !win.closed;
  renderStats(win);
  return {
    refresh() {
      if (!ownsState()) return;
      state.dirty = true;
      if (state.active) renderStats(win);
    },
    setActive(active: boolean) {
      if (!ownsState() || state.active === active) return;
      state.active = active;
      if (active && compactNeedsRefresh(state)) renderStats(win);
    },
    dispose() {
      disposeState(win, state);
    },
  };
}

function goalSignature() {
  return `${getPref("stats.dailyGoalMinutes")}:${getPref("stats.weeklyGoalDays")}`;
}

function compactNeedsRefresh(state: StatsState) {
  return (
    state.dirty ||
    !state.compactGoalsSnapshot ||
    state.compactGoalsSnapshot.today !== isoDay(new Date()) ||
    state.loaded !== readingStore.loaded ||
    state.compactGoalSignature !== goalSignature()
  );
}

export function collectStats(now = new Date()) {
  const stats = aggregateReadingStats(readingStore.entries(), now);
  return {
    ...stats,
    topItems: stats.topItems.map((entry) => {
      let title = label("stats-unavailable-item");
      try {
        const [libraryID, key] = splitKey(entry.key);
        const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
        title = String((item && item.getField("title")) || title);
      } catch {
        /* Deleted / unavailable items keep their historical time. */
      }
      return { ...entry, title };
    }),
  };
}

export function closeStatsDialog() {
  const current = openWindow;
  openWindow = null;
  if (current) {
    const pending = pendingLoads.get(current);
    if (pending) current.removeEventListener("load", pending);
    pendingLoads.delete(current);
    const state = states.get(current);
    if (state) disposeState(current, state);
  }
  // Also close a window that has not loaded its marker yet.
  try {
    current?.close();
  } catch {
    /* Already closing. */
  }
  for (const win of (Services.wm as any).getEnumerator("") as any) {
    try {
      // Main item panes may now contain statistics too. Only a marked,
      // standalone chrome host belongs to the statistics window lifecycle.
      if (
        win?.location?.href === panelURL &&
        win?.document?.querySelector?.(".zest-stats-standalone")
      ) {
        const state = states.get(win);
        if (state) disposeState(win, state);
        win.close();
      }
    } catch {
      /* Already closing. */
    }
  }
}

export function openStatsDialog(parent?: Window) {
  const url = panelURL;
  if (openWindow && !openWindow.closed) {
    if (
      openWindow.document.readyState === "complete" &&
      openWindow.location.href === url
    )
      renderStats(openWindow);
    openWindow.focus();
    return;
  }
  const host = parent || Zotero.getMainWindow();
  if (!host?.openDialog) return;
  const win = host.openDialog(
    url,
    "zest-stats",
    "chrome,centerscreen,resizable,width=1060,height=800",
  ) as Window | null;
  if (!win) return;
  openWindow = win;
  const render = guard("stats:load", () => {
    if (openWindow !== win || win.closed || win.location.href !== url) return;
    win.removeEventListener("load", render);
    pendingLoads.delete(win);
    // The initial about:blank document unloads before the actual host loads.
    // Bind teardown only after that transition has completed.
    win.addEventListener(
      "unload",
      () => {
        const state = states.get(win);
        if (state) disposeState(win, state);
        if (openWindow === win) openWindow = null;
      },
      { once: true },
    );
    renderStats(win);
  });
  if (win.document.readyState === "complete" && win.location.href === url)
    render();
  else {
    pendingLoads.set(win, render);
    win.addEventListener("load", render);
  }
}

function label(
  id: FluentMessageId,
  args?: Record<string, string | number>,
): string {
  return args ? getString(id, { args }) : getString(id);
}

// Dashboard values include zero and localize their units, unlike compact cells.
function formatDuration(seconds: number) {
  if (!(seconds > 0)) return label("stats-zero-time");
  if (seconds < 60)
    return label("stats-seconds", { value: Math.round(seconds) });
  if (seconds < 3600)
    return label("stats-minutes", { value: Math.round(seconds / 60) });
  const hours = seconds / 3600;
  return label("stats-hours", {
    value: hours < 10 ? Number(hours.toFixed(1)) : Math.round(hours),
  });
}

function exactDuration(seconds: number) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  const parts = [];
  if (hours) parts.push(label("stats-hours", { value: hours }));
  if (minutes) parts.push(label("stats-minutes", { value: minutes }));
  if (remainder || !parts.length)
    parts.push(label("stats-seconds", { value: remainder }));
  return parts.join(" ");
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(doc: Document, title: string, cls = "") {
  const node = element(doc, "section", `zest-stats-panel ${cls}`);
  node.append(element(doc, "h2", "", title));
  return node;
}

function metric(doc: Document, title: string, value: string, cls = "") {
  const node = element(doc, "div", cls);
  node.append(element(doc, "div", "zest-stats-value", value));
  node.append(element(doc, "div", "zest-stats-label", title));
  return node;
}

function localDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateLabel(day: string, weekday = false) {
  return new Intl.DateTimeFormat(
    Services.locale?.appLocaleAsBCP47 || Zotero.locale,
    weekday ? { weekday: "short" } : { month: "short", day: "numeric" },
  ).format(localDate(day));
}

export function renderStats(win: Window, refreshSnapshot = true) {
  const doc = win.document;
  const body = doc.body;
  if (!body || win.closed) return;
  const state = states.get(win) || createState(win);
  if (!state.active) {
    if (refreshSnapshot) state.dirty = true;
    return;
  }
  const scroll = win.scrollY;
  const focus = doc.activeElement?.getAttribute("data-focus");
  const expanded =
    !!doc.querySelector<HTMLDetailsElement>(".zest-stats-data")?.open;
  doc.title = label("stats-title");
  body.textContent = "";
  state.style = element(doc, "style", "", statsCSS());
  body.append(state.style);
  const root = element(
    doc,
    "main",
    `zest-stats zest-stats-${state.embedded ? "embedded" : "standalone"}`,
  );
  state.root = root;
  const isCurrent = () =>
    states.get(win) === state &&
    state.active &&
    state.root === root &&
    !win.closed;
  body.append(root);
  if (state.embedded) {
    const stats =
      (!refreshSnapshot && !state.dirty && state.compactGoalsSnapshot) ||
      aggregateReadingGoals(readingStore.entries());
    state.compactGoalsSnapshot = stats;
    state.compactGoalSignature = goalSignature();
    state.loaded = readingStore.loaded;
    state.dirty = false;
    root.append(buildCompactGoals(doc, stats, state, isCurrent));
    if (focus)
      doc.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
    win.scrollTo(0, 0);
    return;
  }
  const stats =
    (!refreshSnapshot && !state.dirty && state.snapshot) || collectStats();
  state.snapshot = stats;
  state.loaded = readingStore.loaded;
  state.dirty = false;
  const range = state.range;
  const period = readingPeriod(stats, range);
  const header = element(doc, "header", "zest-stats-header");
  const heading = element(doc, "div", "zest-stats-heading");
  const title = element(doc, "h1");
  title.append(icon(doc, "chart"), doc.createTextNode(label("stats-title")));
  heading.append(
    title,
    element(doc, "p", "zest-stats-subtitle", label("stats-subtitle")),
  );
  const refresh = element(
    doc,
    "button",
    "zest-flat-btn zest-stats-refresh",
    label("stats-refresh"),
  );
  refresh.dataset.focus = "refresh";
  refresh.addEventListener(
    "click",
    guard("stats:refresh", () => {
      if (isCurrent()) renderStats(win);
    }),
  );
  header.append(heading, refresh);
  root.append(header);
  if (!readingStore.loaded) {
    root.append(
      element(doc, "p", "zest-stats-notice", label("stats-not-ready")),
    );
  } else if (!stats.totalSeconds && !stats.datedSeconds) {
    root.append(element(doc, "p", "zest-stats-notice", label("stats-empty")));
  }
  root.append(buildGoals(doc, stats, win, isCurrent));
  const cards = element(doc, "div", "zest-stats-summary");
  const summaries: [FluentMessageId, string][] = [
    ["stats-total", formatDuration(stats.totalSeconds)],
    ["stats-days", String(stats.daysRead)],
    ["stats-streak", String(stats.streak)],
    ["stats-longest", String(stats.longestStreak)],
    ["stats-items", String(stats.itemCount)],
    ["stats-page-total", String(stats.pages)],
  ];
  for (const [id, value] of summaries)
    cards.append(metric(doc, label(id), value, "zest-stats-card"));
  root.append(
    cards,
    element(doc, "p", "zest-stats-note", label("stats-page-note")),
  );
  if (stats.undatedSeconds > 0) {
    root.append(
      element(
        doc,
        "p",
        "zest-stats-notice",
        label("stats-undated", { time: formatDuration(stats.undatedSeconds) }),
      ),
    );
  }
  if (stats.inconsistentDays)
    root.append(
      element(doc, "p", "zest-stats-notice", label("stats-inconsistent")),
    );

  const charts = element(doc, "div", "zest-stats-charts");
  const trend = element(doc, "section", "zest-stats-panel");
  const trendHeader = element(doc, "div", "zest-trend-header");
  trendHeader.append(element(doc, "h2", "", label("stats-trend")));
  trend.dataset.periodDays = String(range);
  const toolbar = element(doc, "div", "zest-stats-ranges");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", label("stats-range-label"));
  for (const days of [7, 30, 90] as const) {
    const button = element(
      doc,
      "button",
      "zest-flat-btn",
      label("stats-range", { days }),
    );
    button.dataset.range = String(days);
    button.dataset.focus = `range-${days}`;
    button.setAttribute("aria-pressed", String(days === range));
    button.addEventListener(
      "click",
      guard("stats:range", () => {
        if (!isCurrent()) return;
        state.range = days;
        renderStats(win, false);
      }),
    );
    toolbar.append(button);
  }
  trendHeader.append(toolbar);
  trend.append(trendHeader);
  const periodCards = element(doc, "div", "zest-stats-period");
  periodCards.append(
    metric(
      doc,
      label("stats-period-total"),
      formatDuration(period.totalSeconds),
    ),
    metric(doc, label("stats-period-days"), String(period.activeDays)),
    metric(doc, label("stats-average"), formatDuration(period.averageSeconds)),
  );
  trend.append(periodCards);
  let comparison = label(
    period.totalSeconds ? "stats-no-previous" : "stats-no-period-data",
  );
  if (period.previousSeconds > 0) {
    const change = Math.round(
      (period.totalSeconds / period.previousSeconds - 1) * 100,
    );
    comparison = label("stats-comparison", {
      days: range,
      change: `${change > 0 ? "+" : ""}${change}%`,
    });
  }
  trend.append(
    element(doc, "p", "zest-stats-note", comparison),
    buildTrend(doc, period),
  );
  const data = buildDayTable(doc, period);
  data.open = expanded;
  trend.append(data);
  charts.append(trend, buildWeekdays(doc, period));
  root.append(charts, buildCalendar(doc, stats), buildAchievements(doc, stats));

  const top = section(doc, label("stats-top"));
  top.append(element(doc, "p", "zest-stats-note", label("stats-top-note")));
  if (!stats.topItems.length)
    top.append(element(doc, "p", "zest-stats-note", label("stats-no-items")));
  else {
    const table = tableHead(doc, [
      "stats-document",
      "stats-total",
      "stats-page-total",
    ]);
    table.classList.add("zest-stats-top");
    const body = element(doc, "tbody");
    const maximum = stats.topItems[0].seconds;
    for (const entry of stats.topItems) {
      const row = element(doc, "tr");
      const name = element(doc, "td", "zest-stats-item", entry.title);
      const bar = element(doc, "div", "zest-stats-item-bar");
      bar.style.width = `${(100 * entry.seconds) / maximum}%`;
      bar.setAttribute("aria-hidden", "true");
      name.append(bar);
      row.append(
        name,
        element(doc, "td", "", formatDuration(entry.seconds)),
        element(doc, "td", "", String(entry.pages)),
      );
      body.append(row);
    }
    table.append(body);
    top.append(table);
  }
  root.append(
    top,
    element(
      doc,
      "p",
      "zest-stats-note zest-stats-source",
      label("stats-source-note"),
    ),
  );
  if (focus) doc.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
  win.scrollTo(0, scroll);
}

function buildCompactGoals(
  doc: Document,
  stats: ReadingGoalsStats,
  state: StatsState,
  isCurrent: () => boolean,
) {
  const goals = readingGoals(
    stats,
    getPref("stats.dailyGoalMinutes"),
    getPref("stats.weeklyGoalDays"),
  );
  const button = element(doc, "button", "zest-stats-open-details");
  button.type = "button";
  button.dataset.focus = "open-details";
  const descriptions = goals.rings.map((ring) => {
    const current =
      ring.id === "week-days"
        ? label("stats-day-count", { days: ring.value })
        : exactDuration(ring.value);
    const target =
      ring.id === "week-days"
        ? label("stats-day-count", { days: ring.target })
        : exactDuration(ring.target);
    return `${label(`stats-ring-${ring.id}` as FluentMessageId)}: ${current} / ${target}`;
  });
  const action = getString("sidebar-open-window", "tooltiptext");
  const description = !readingStore.loaded
    ? label("stats-not-ready")
    : descriptions.join("; ");
  button.title = `${label("stats-title")} · ${action}\n${description}`;
  button.setAttribute("aria-label", button.title);
  const rings = buildRings(doc, goals);
  if (!readingStore.loaded) {
    rings.querySelector("strong")!.textContent = "—";
    button.setAttribute("aria-busy", "true");
  }
  button.append(rings);
  button.addEventListener(
    "click",
    guard("stats:open-details", () => {
      if (isCurrent()) state.onOpenDetails?.();
    }),
  );
  return button;
}

function buildRings(doc: Document, goals: ReturnType<typeof readingGoals>) {
  const ns = "http://www.w3.org/2000/svg";
  const visual = element(doc, "span", "zest-rings");
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 220 220");
  svg.setAttribute("aria-hidden", "true");
  goals.rings.forEach((ring, i) => {
    const radius = 95 - i * 17;
    const circumference = 2 * Math.PI * radius;
    for (const track of [true, false]) {
      const circle = doc.createElementNS(ns, "circle");
      circle.setAttribute("cx", "110");
      circle.setAttribute("cy", "110");
      circle.setAttribute("r", String(radius));
      circle.setAttribute(
        "class",
        track ? "zest-ring-track" : `zest-ring-progress zest-ring-${i}`,
      );
      if (!track) {
        circle.setAttribute("stroke-dasharray", String(circumference));
        circle.setAttribute(
          "stroke-dashoffset",
          String(circumference * (1 - ring.progress)),
        );
        if (!ring.progress) circle.setAttribute("visibility", "hidden");
      }
      svg.append(circle);
    }
  });
  const centre = element(doc, "span", "zest-rings-centre");
  centre.append(
    element(doc, "span", "zest-stats-label", label("stats-today")),
    element(doc, "strong", "", formatDuration(goals.todaySeconds)),
  );
  visual.append(svg, centre);
  return visual;
}

function buildGoals(
  doc: Document,
  stats: ReadingStats,
  win: Window,
  isCurrent: () => boolean,
) {
  const goals = readingGoals(
    stats,
    getPref("stats.dailyGoalMinutes"),
    getPref("stats.weeklyGoalDays"),
  );
  const panel = section(doc, label("stats-goals"), "zest-goals");
  const layout = element(doc, "div", "zest-goals-layout");
  const visual = buildRings(doc, goals);
  const content = element(doc, "div", "zest-goals-content");
  const summary = element(doc, "div", "zest-goal-metrics");
  goals.rings.forEach((ring, i) => {
    const row = element(doc, "div", `zest-goal-metric zest-ring-${i}`);
    const target =
      ring.id === "week-days"
        ? label("stats-day-count", { days: ring.target })
        : exactDuration(ring.target);
    const current =
      ring.id === "week-days" ? String(ring.value) : exactDuration(ring.value);
    const heading = element(doc, "div", "zest-goal-line");
    // Preserve the full exact ratio in reading order while giving the current
    // value and the target separate visual emphasis (no rounded goal claims).
    const amount = element(doc, "strong");
    amount.append(
      element(doc, "span", "zest-goal-amount", current),
      element(doc, "span", "zest-goal-target", ` / ${target}`),
    );
    heading.append(
      element(
        doc,
        "span",
        "zest-goal-name",
        label(`stats-ring-${ring.id}` as FluentMessageId),
      ),
      amount,
    );
    const progress = element(doc, "progress");
    progress.max = ring.target;
    progress.value = Math.min(ring.value, ring.target);
    progress.setAttribute(
      "aria-label",
      label(`stats-ring-${ring.id}` as FluentMessageId),
    );
    const remaining = Math.max(0, ring.target - ring.value);
    const detail = !remaining
      ? label("stats-goal-reached")
      : label("stats-goal-remaining", {
          value:
            ring.id === "week-days"
              ? label("stats-day-count", { days: remaining })
              : exactDuration(remaining),
        });
    row.append(
      heading,
      progress,
      element(doc, "span", "zest-goal-detail", detail),
    );
    summary.append(row);
  });
  content.append(summary);
  const week = element(doc, "div", "zest-goal-week");
  for (const day of goals.week) {
    const cell = element(
      doc,
      "div",
      `zest-goal-day${day.achieved ? " is-achieved" : ""}${day.day === stats.today ? " is-today" : ""}${day.future ? " is-future" : ""}`,
    );
    cell.title = `${day.day} · ${day.future ? label("stats-future-day") : exactDuration(day.seconds)}`;
    cell.setAttribute("role", "img");
    cell.setAttribute(
      "aria-label",
      `${cell.title}${day.achieved ? " · " + label("stats-goal-reached") : ""}`,
    );
    cell.append(
      element(doc, "span", "", dateLabel(day.day, true)),
      element(
        doc,
        "strong",
        "",
        day.future
          ? "—"
          : day.achieved
            ? "✓"
            : String(localDate(day.day).getDate()),
      ),
    );
    week.append(cell);
  }
  content.append(
    week,
    element(
      doc,
      "p",
      "zest-stats-note",
      label("stats-goal-week-note", { minutes: goals.dailyMinutes }),
    ),
  );
  const controls = element(doc, "div", "zest-goal-controls");
  const control = (
    id: FluentMessageId,
    key: "stats.dailyGoalMinutes" | "stats.weeklyGoalDays",
    values: number[],
    current: number,
    unit: FluentMessageId,
  ) => {
    const field = element(doc, "label");
    field.append(element(doc, "span", "", label(id)));
    const select = element(doc, "select", "zest-flat-select");
    select.dataset.focus = key.replaceAll(".", "-");
    for (const value of values) {
      const option = element(doc, "option", "", label(unit, { value }));
      option.value = String(value);
      option.selected = value === current;
      select.append(option);
    }
    select.addEventListener(
      "change",
      guard("stats:goal", () => {
        if (!isCurrent()) return;
        const value = Number(select.value);
        if (!values.includes(value)) return;
        setPref(key, value);
        renderStats(win, false);
      }),
    );
    field.append(select);
    controls.append(field);
  };
  control(
    "stats-goal-daily",
    "stats.dailyGoalMinutes",
    [15, 30, 45, 60],
    goals.dailyMinutes,
    "stats-minute-option",
  );
  control(
    "stats-goal-weekly",
    "stats.weeklyGoalDays",
    [3, 5, 7],
    goals.weeklyDays,
    "stats-day-option",
  );
  content.append(controls);
  layout.append(visual, content);
  panel.append(layout);
  return panel;
}

function buildTrend(doc: Document, period: PeriodStats) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.classList.add("zest-stats-trend");
  svg.setAttribute("viewBox", "0 0 640 190");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    label("stats-trend-accessible", {
      days: period.days.length,
      time: formatDuration(period.totalSeconds),
    }),
  );
  const add = (tag: string, attrs: Record<string, string>, text?: string) => {
    const node = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  const max = Math.max(60, ...period.days.map((d) => d.seconds));
  const x = (i: number) => 66 + (i / (period.days.length - 1)) * 554;
  const y = (seconds: number) => 151 - (seconds / max) * 128;
  for (const fraction of [0, 0.5, 1]) {
    const at = String(y(fraction * max));
    add("line", {
      x1: "66",
      x2: "620",
      y1: at,
      y2: at,
      class: "zest-trend-grid",
    });
    add(
      "text",
      { x: "57", y: String(Number(at) + 4), "text-anchor": "end" },
      formatDuration(fraction * max),
    );
  }
  const points = period.days.map((d, i) => `${x(i)},${y(d.seconds)}`).join(" ");
  add("polygon", {
    points: `66,151 ${points} 620,151`,
    class: "zest-trend-area",
  });
  add("polyline", { points, class: "zest-trend-line" });
  if (period.days.length === 7)
    period.days.forEach((d, i) => {
      const dot = add("circle", {
        cx: String(x(i)),
        cy: String(y(d.seconds)),
        r: "3",
        class: "zest-trend-dot",
      });
      const title = doc.createElementNS(ns, "title");
      title.textContent = `${d.day} · ${formatDuration(d.seconds)}`;
      dot.append(title);
    });
  for (const i of [
    0,
    Math.floor(period.days.length / 2),
    period.days.length - 1,
  ]) {
    add(
      "text",
      {
        x: String(x(i)),
        y: "178",
        "text-anchor":
          i === 0 ? "start" : i === period.days.length - 1 ? "end" : "middle",
      },
      dateLabel(period.days[i].day),
    );
  }
  return svg;
}

function tableHead(doc: Document, ids: FluentMessageId[]) {
  const table = element(doc, "table", "zest-stats-table");
  const head = element(doc, "thead");
  const row = element(doc, "tr");
  for (const id of ids) {
    const cell = element(doc, "th", "", label(id));
    cell.scope = "col";
    row.append(cell);
  }
  head.append(row);
  table.append(head);
  return table;
}

function buildDayTable(doc: Document, period: PeriodStats) {
  const details = element(doc, "details", "zest-stats-data");
  details.append(element(doc, "summary", "", label("stats-data-table")));
  const table = tableHead(doc, ["stats-date", "stats-total"]);
  table.classList.add("zest-stats-daily-table");
  const body = element(doc, "tbody");
  for (const day of [...period.days].reverse()) {
    const row = element(doc, "tr");
    row.append(
      element(doc, "td", "", day.day),
      element(doc, "td", "", exactDuration(day.seconds)),
    );
    body.append(row);
  }
  table.append(body);
  details.append(table);
  return details;
}

function buildWeekdays(doc: Document, period: PeriodStats) {
  const panel = section(doc, label("stats-weekdays-title"));
  panel.append(
    element(doc, "p", "zest-stats-note", label("stats-weekdays-note")),
  );
  const list = element(doc, "ol", "zest-stats-weekdays");
  const max = Math.max(1, ...period.weekdays);
  period.weekdays.forEach((seconds, i) => {
    const row = element(doc, "li", "zest-weekday");
    const track = element(doc, "div", "zest-weekday-track");
    track.setAttribute("aria-hidden", "true");
    const bar = element(doc, "div", "zest-weekday-bar");
    bar.style.width = `${(seconds / max) * 100}%`;
    track.append(bar);
    row.append(
      element(doc, "span", "", dateLabel(`2024-01-0${i + 1}`, true)),
      track,
      element(doc, "span", "zest-weekday-time", formatDuration(seconds)),
    );
    list.append(row);
  });
  panel.append(list);
  return panel;
}

function buildCalendar(doc: Document, stats: ReadingStats) {
  const panel = section(doc, label("stats-calendar"));
  const wrap = element(doc, "div", "zest-cal-wrap");
  const grid = element(doc, "div", "zest-cal");
  const today = localDate(stats.today);
  const start = addDays(today, -today.getDay() - 52 * 7);
  const values = [...stats.byDay]
    .filter(([day]) => day >= isoDay(start))
    .map(([, seconds]) => seconds)
    .sort((a, b) => a - b);
  const scale = Math.max(600, values[Math.floor(values.length * 0.9)] || 0);
  const fill = (level: number) =>
    level
      ? `color-mix(in srgb, var(--zest-accent) ${[0, 24, 42, 65, 90][level]}%, var(--zest-surface))`
      : "var(--zest-fill)";
  let lastMonth = -1;
  for (let week = 0; week < 53; week++) {
    const col = element(doc, "div", "zest-cal-week");
    const first = addDays(start, week * 7);
    if (first.getMonth() !== lastMonth) {
      const month = new Intl.DateTimeFormat(
        Services.locale?.appLocaleAsBCP47 || Zotero.locale,
        {
          month: "short",
        },
      ).format(first);
      col.append(element(doc, "span", "zest-cal-month", month));
      lastMonth = first.getMonth();
    }
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = isoDay(addDays(first, weekday));
      const seconds = stats.byDay.get(day) || 0;
      const cell = element(doc, "span", "zest-cal-cell");
      if (day > stats.today) cell.style.visibility = "hidden";
      cell.style.background = fill(
        seconds > 0
          ? Math.min(4, Math.max(1, Math.ceil((seconds / scale) * 4)))
          : 0,
      );
      cell.title = `${day} · ${formatDuration(seconds)}`;
      cell.setAttribute("role", "img");
      cell.setAttribute("aria-label", cell.title);
      col.append(cell);
    }
    grid.append(col);
  }
  wrap.append(grid);
  panel.append(wrap);
  const footer = element(doc, "div", "zest-cal-footer");
  footer.append(
    element(
      doc,
      "span",
      "zest-stats-note",
      stats.bestDay
        ? label("stats-best-detail", {
            day: stats.bestDay.day,
            time: formatDuration(stats.bestDay.seconds),
          })
        : label("stats-nothing"),
    ),
  );
  const legend = element(doc, "div", "zest-cal-legend");
  legend.append(element(doc, "span", "", label("stats-less")));
  for (let level = 0; level <= 4; level++) {
    const swatch = element(doc, "span", "zest-cal-cell");
    swatch.style.background = fill(level);
    swatch.setAttribute("aria-hidden", "true");
    legend.append(swatch);
  }
  legend.append(element(doc, "span", "", label("stats-more")));
  footer.append(legend);
  panel.append(footer);
  return panel;
}

function buildAchievements(doc: Document, stats: ReadingStats) {
  const panel = section(doc, label("stats-achievements"));
  panel.append(
    element(
      doc,
      "p",
      "zest-stats-note",
      label("stats-achievements-count", {
        count: stats.achievements.filter((a) => a.unlocked).length,
        total: stats.achievements.length,
      }),
    ),
  );
  const grid = element(doc, "div", "zest-achievements");
  const nextMetrics = new Set<string>();
  for (const achievement of stats.achievements) {
    const card = element(
      doc,
      "article",
      `zest-achievement${achievement.unlocked ? " is-unlocked" : ""}`,
    );
    card.dataset.metric = achievement.metric;
    const title = label(
      `stats-achievement-${achievement.id}` as FluentMessageId,
    );
    const next = !achievement.unlocked && !nextMetrics.has(achievement.metric);
    if (next) nextMetrics.add(achievement.metric);
    if (next) card.classList.add("is-next");
    const category = label(
      `stats-category-${achievement.metric}` as FluentMessageId,
    );
    card.append(
      element(
        doc,
        "div",
        "zest-achievement-category",
        next ? `${category} · ${label("stats-next-milestone")}` : category,
      ),
      medal(doc, achievement.metric, achievement.target),
    );
    const heading = element(doc, "div", "zest-achievement-heading");
    heading.append(
      element(doc, "h3", "", title),
      element(
        doc,
        "span",
        "zest-achievement-status",
        label(achievement.unlocked ? "stats-unlocked" : "stats-in-progress"),
      ),
    );
    const target =
      achievement.metric === "seconds"
        ? formatDuration(achievement.target)
        : String(achievement.target);
    const completed = Math.min(achievement.value, achievement.target);
    const current =
      achievement.metric === "seconds"
        ? exactDuration(completed)
        : String(completed);
    const rule =
      achievement.metric === "seconds"
        ? "stats-achievement-rule-time"
        : achievement.metric === "items"
          ? "stats-achievement-rule-items"
          : "stats-achievement-rule-days";
    const progress = element(doc, "progress");
    progress.max = 1;
    progress.value = achievement.progress;
    progress.setAttribute("aria-label", `${title}: ${current} / ${target}`);
    card.append(
      heading,
      element(doc, "p", "zest-achievement-rule", label(rule, { target })),
      progress,
      element(doc, "div", "zest-achievement-current", `${current} / ${target}`),
    );
    grid.append(card);
  }
  panel.append(
    grid,
    element(doc, "p", "zest-stats-note", label("stats-achievements-note")),
  );
  return panel;
}

function medal(doc: Document, metric: string, target: number) {
  const medal = element(doc, "span", "zest-medal");
  medal.setAttribute("aria-hidden", "true");
  const art = element(doc, "img", "zest-medal-art");
  const name =
    metric === "seconds" ? "time" : metric === "items" ? "library" : "streak";
  art.src = `chrome://${config.addonRef}/content/images/achievements/reading-${name}.webp`;
  art.alt = "";
  art.width = art.height = 58;
  art.loading = "lazy";
  art.decoding = "async";
  const text = element(doc, "span", "zest-medal-target");
  text.textContent =
    metric === "seconds"
      ? target < 3600
        ? "5m"
        : `${target / 3600}h`
      : String(target);
  medal.append(art, text);
  return medal;
}
