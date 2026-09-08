import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import { getPref, setPref } from "../utils/prefs";
import { readingStore, splitKey } from "../reading/store";
import {
  aggregateReadingStats,
  readingPeriod,
  readingGoals,
  addDays,
  isoDay,
  type StatsRange,
  type ReadingStats,
  type PeriodStats,
} from "../reading/statistics";
import { icon, ICON_CSS } from "../ui/icons";
import { dialogThemeCSS } from "../ui/dialogTheme";

// A snapshot on open / explicit refresh: no tracker subscription or hidden
// window work. All statistics and achievements are derived, never persisted.
let openWindow: Window | null = null;
type StatsState = {
  embedded: boolean;
  active: boolean;
  dirty: boolean;
  range: StatsRange;
  snapshot?: ReturnType<typeof collectStats>;
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
  };
  states.set(win, state);
  return state;
}

function disposeState(win: Window, state: StatsState) {
  state.active = false;
  state.dirty = false;
  state.range = 30;
  state.snapshot = undefined;
  state.root?.remove();
  state.style?.remove();
  state.root = undefined;
  state.style = undefined;
  if (states.get(win) === state) states.delete(win);
}

/** Mount only after the sidebar's dedicated panel.xhtml frame is visible. */
export function mountStats(win: Window) {
  const state = createState(win, true);
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
      if (active && state.dirty) renderStats(win);
    },
    dispose() {
      disposeState(win, state);
    },
  };
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
  const stats =
    (!refreshSnapshot && !state.dirty && state.snapshot) || collectStats();
  state.snapshot = stats;
  state.dirty = false;
  const range = state.range;
  const period = readingPeriod(stats, range);
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
  const ns = "http://www.w3.org/2000/svg";
  const visual = element(doc, "div", "zest-rings");
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
  const centre = element(doc, "div", "zest-rings-centre");
  centre.append(
    element(doc, "span", "zest-stats-label", label("stats-today")),
    element(doc, "strong", "", formatDuration(goals.todaySeconds)),
  );
  visual.append(svg, centre);
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
    const select = element(doc, "select", "zest-flat-btn");
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
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 72 80");
  svg.setAttribute("class", "zest-medal");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag: string, attrs: Record<string, string>) => {
    const node = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    svg.append(node);
    return node;
  };
  add("path", {
    d: "M17 48 L11 76 L26 69 L35 77 L39 51 M37 51 L42 77 L51 69 L65 76 L57 48",
    class: "zest-medal-ribbon",
  });
  add("circle", { cx: "36", cy: "32", r: "27", class: "zest-medal-disc" });
  add("circle", { cx: "36", cy: "32", r: "21", class: "zest-medal-border" });
  const text = add("text", {
    x: "36",
    y: "34",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });
  text.textContent =
    metric === "seconds"
      ? target < 3600
        ? "5m"
        : `${target / 3600}h`
      : String(target);
  return svg;
}

function statsCSS() {
  return `
    ${dialogThemeCSS()}
    * { box-sizing:border-box; }
    body { margin:0; background:var(--zest-bg); color:var(--zest-fg); font:14px system-ui,sans-serif; }
    ${ICON_CSS}
    .zest-stats { max-width:1240px; margin:auto; padding:28px 32px; line-height:1.5; }
    .zest-stats-header { display:flex; justify-content:space-between; align-items:center; gap:18px; margin-bottom:24px; }
    h1 { font-size:1.5rem; margin:0; display:flex; align-items:center; gap:10px; letter-spacing:-.035em; font-weight:650; }
    h1 .zest-icon { width:22px; height:22px; }
    h2 { font-size:.94rem; margin:0 0 16px; font-weight:600; letter-spacing:.015em; }
    h3 { font-size:.87rem; margin:0; font-weight:600; }
    .zest-stats-subtitle { color:var(--zest-muted); margin:6px 0 0; font-size:.78rem; }
    .zest-flat-btn { appearance:none; background:var(--zest-surface); color:var(--zest-fg); border:1px solid var(--zest-line); border-radius:8px; padding:6px 13px; font:inherit; font-size:.78rem; cursor:pointer; white-space:nowrap; }
    .zest-flat-btn:hover { background:var(--zest-fill); }
    :focus-visible { outline:2px solid var(--zest-accent); outline-offset:3px; }
    .zest-stats-summary { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); padding:18px 0; margin-top:18px; border-radius:16px; background:var(--zest-surface); box-shadow:var(--zest-shadow); }
    .zest-goals-layout { display:grid; grid-template-columns:220px minmax(0,1fr); align-items:center; gap:36px; }
    .zest-rings { position:relative; width:220px; height:220px; }
    .zest-rings svg { width:100%; height:100%; transform:rotate(-90deg); }
    .zest-rings circle { fill:none; stroke-width:9; }
    .zest-ring-track { stroke:var(--zest-fill); }
    .zest-ring-0 { --ring-color:var(--zest-stats-blue); }
    .zest-ring-1 { --ring-color:var(--zest-stats-violet); }
    .zest-ring-2 { --ring-color:var(--zest-stats-bronze); }
    .zest-ring-progress { stroke:var(--ring-color); stroke-linecap:round; }
    .zest-rings-centre { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; }
    .zest-rings-centre strong { font-size:1.6rem; font-weight:600; letter-spacing:-.04em; font-variant-numeric:tabular-nums; }
    .zest-rings-centre .zest-stats-label { font-size:.72rem; margin-bottom:3px; }
    .zest-goal-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px; }
    .zest-goal-line { display:flex; flex-direction:column; gap:8px; }
    .zest-goal-line strong { display:block; font-weight:600; font-variant-numeric:tabular-nums; }
    .zest-goal-amount { display:block; font-size:1.08rem; letter-spacing:-.03em; overflow-wrap:anywhere; }
    .zest-goal-target { display:block; font-size:.75rem; font-weight:400; color:var(--zest-muted); margin-top:2px; }
    .zest-goal-name { color:var(--zest-muted); font-size:.75rem; }
    .zest-goal-name::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px; background:var(--ring-color); }
    .zest-goal-metric progress { appearance:none; display:block; width:100%; height:3px; border:0; border-radius:3px; overflow:hidden; background:var(--zest-fill); margin:10px 0 6px; }
    .zest-goal-metric progress::-moz-progress-bar { background:var(--ring-color); border-radius:3px; }
    .zest-goal-detail { display:block; color:var(--zest-muted); font-size:.7rem; overflow-wrap:anywhere; }
    .zest-goal-week { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:7px; margin-top:20px; padding-top:16px; border-top:1px solid var(--zest-line); }
    .zest-goal-day { display:flex; flex-direction:column; align-items:center; gap:6px; padding:0 2px; font-size:.72rem; color:var(--zest-muted); }
    .zest-goal-day strong { display:grid; place-items:center; width:30px; height:30px; border-radius:50%; background:var(--zest-fill); font-size:.82rem; font-weight:500; }
    .zest-goal-day.is-today strong { outline:1px solid var(--zest-stats-bronze); outline-offset:3px; }
    .zest-goal-day.is-achieved strong { color:var(--zest-fg); background:color-mix(in srgb,var(--zest-stats-bronze) 20%,var(--zest-surface)); }
    .zest-goal-day.is-future strong { background:transparent; }
    .zest-goal-controls { display:flex; gap:16px; flex-wrap:wrap; margin-top:14px; }
    .zest-goal-controls label { display:flex; gap:8px; align-items:center; font-size:.75rem; color:var(--zest-muted); }
    .zest-goal-controls select { appearance:auto; font-size:.75rem; padding:4px 7px; }
    .zest-stats-card { padding:2px 20px; min-width:0; }
    .zest-stats-card + .zest-stats-card { border-left:1px solid var(--zest-line); }
    .zest-stats-value { font-size:1.55rem; font-weight:600; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; letter-spacing:-.035em; }
    .zest-stats-label { color:var(--zest-muted); font-size:.73rem; margin-top:4px; }
    .zest-stats-note { color:var(--zest-muted); font-size:.74rem; margin:10px 0; line-height:1.6; }
    .zest-stats-notice { border-left:3px solid var(--zest-accent); background:var(--zest-fill); padding:10px 14px; font-size:.82rem; border-radius:0 7px 7px 0; }
    .zest-stats-panel { min-width:0; padding:24px; margin-top:18px; border:1px solid color-mix(in srgb,var(--zest-line) 65%,var(--zest-surface)); border-radius:16px; background:var(--zest-surface); box-shadow:var(--zest-shadow); }
    .zest-stats-charts { display:grid; grid-template-columns:minmax(0,1.9fr) minmax(260px,1fr); gap:18px; }
    .zest-trend-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
    .zest-trend-header h2 { margin:0; }
    .zest-stats-ranges { display:inline-flex; gap:2px; padding:3px; background:var(--zest-fill); border-radius:9px; }
    .zest-stats-ranges button { background:transparent; color:var(--zest-muted); border-color:transparent; padding:4px 9px; font-size:.73rem; }
    .zest-stats-ranges [aria-pressed=true] { background:var(--zest-surface); color:var(--zest-fg); box-shadow:0 1px 3px #0000000d; font-weight:600; }
    .zest-stats-period { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:24px 0 8px; }
    .zest-stats-period .zest-stats-value { font-size:1.25rem; }
    .zest-stats-trend { display:block; width:100%; height:auto; overflow:visible; }
    .zest-stats-trend text { font:11px system-ui,sans-serif; fill:var(--zest-muted); }
    .zest-trend-grid { stroke:var(--zest-line); stroke-width:1; stroke-dasharray:3 5; }
    .zest-trend-area { fill:var(--zest-accent); opacity:.07; }
    .zest-trend-line { fill:none; stroke:var(--zest-accent); stroke-width:2.25; stroke-linejoin:round; }
    .zest-trend-dot { fill:var(--zest-accent); }
    .zest-stats-data { font-size:.78rem; color:var(--zest-muted); }
    .zest-stats-data summary { cursor:pointer; width:fit-content; }
    .zest-stats-data[open] { max-height:330px; overflow:auto; }
    .zest-stats-weekdays { list-style:none; padding:0; margin:20px 0 0; }
    .zest-weekday { display:grid; grid-template-columns:38px minmax(0,1fr) 72px; gap:9px; align-items:center; margin:15px 0; font-size:.79rem; }
    .zest-weekday-track { height:5px; border-radius:4px; background:var(--zest-fill); overflow:hidden; }
    .zest-weekday-bar { height:100%; border-radius:4px; background:var(--zest-stats-violet); }
    .zest-weekday-time { text-align:right; color:var(--zest-muted); font-variant-numeric:tabular-nums; }
    .zest-cal-wrap { overflow-x:auto; padding:28px 0 4px; }
    .zest-cal { display:grid; grid-template-columns:repeat(53,12px); gap:3px; width:max-content; }
    .zest-cal-week { position:relative; display:flex; flex-direction:column; gap:3px; }
    .zest-cal-cell { display:block; flex-shrink:0; width:12px; height:12px; border-radius:3px; }
    .zest-cal-month { position:absolute; top:-24px; left:0; font-size:.7rem; color:var(--zest-muted); white-space:nowrap; }
    .zest-cal-footer { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
    .zest-cal-legend { display:flex; align-items:center; gap:4px; font-size:.72rem; color:var(--zest-muted); }
    .zest-achievements { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:18px 0 14px; }
    .zest-achievement { --achievement-color:var(--zest-stats-blue); display:grid; grid-template-columns:58px minmax(0,1fr); column-gap:14px; row-gap:5px; align-content:start; padding:18px; border:1px solid var(--zest-line); border-radius:12px; min-width:0; }
    .zest-achievement[data-metric=items] { --achievement-color:var(--zest-stats-violet); }
    .zest-achievement[data-metric=days] { --achievement-color:var(--zest-stats-bronze); }
    .zest-achievement.is-unlocked { border-color:color-mix(in srgb,var(--zest-line) 60%,var(--zest-surface)); background:linear-gradient(135deg,color-mix(in srgb,var(--achievement-color) 4%,var(--zest-surface)),var(--zest-surface) 70%); }
    .zest-achievement-heading { grid-column:2; grid-row:2; display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; overflow-wrap:anywhere; }
    .zest-achievement-category { grid-column:1 / -1; font-size:.72rem; color:var(--zest-muted); margin-bottom:10px; }
    .zest-achievement.is-next { border-color:color-mix(in srgb,var(--achievement-color) 50%,var(--zest-line)); }
    .zest-medal { grid-column:1; grid-row:2 / 4; display:block; width:58px; height:65px; margin:3px 0 0; }
    .zest-medal-ribbon { fill:var(--zest-fill); stroke:var(--zest-line); }
    .zest-medal-disc { fill:var(--zest-fill); stroke:var(--zest-line); stroke-width:2; }
    .zest-medal-border { fill:none; stroke:var(--zest-line); stroke-width:1; }
    .zest-medal text { fill:var(--zest-muted); font:600 17px system-ui,sans-serif; }
    .is-unlocked .zest-medal-ribbon { fill:color-mix(in srgb,var(--achievement-color) 16%,var(--zest-surface)); stroke:var(--achievement-color); }
    .is-unlocked .zest-medal-disc { fill:color-mix(in srgb,var(--achievement-color) 8%,var(--zest-surface)); stroke:var(--achievement-color); stroke-width:1.5; }
    .is-unlocked .zest-medal-border { stroke:color-mix(in srgb,var(--achievement-color) 45%,var(--zest-line)); stroke-width:.75; }
    .is-unlocked .zest-medal text { fill:var(--zest-fg); }
    .zest-achievement-status { font-size:.72rem; color:var(--zest-muted); }
    .is-unlocked .zest-achievement-status { color:var(--zest-fg); }
    .zest-achievement-rule { grid-column:2; grid-row:3; font-size:.73rem; color:var(--zest-muted); margin:0; min-height:3em; line-height:1.5; overflow-wrap:anywhere; }
    .zest-achievement progress { grid-column:1 / -1; appearance:none; display:block; width:100%; height:3px; margin-top:10px; border:none; border-radius:3px; overflow:hidden; background:var(--zest-fill); accent-color:var(--achievement-color); }
    .zest-achievement progress::-moz-progress-bar { background:var(--achievement-color); border-radius:3px; }
    .zest-achievement-current { grid-column:1 / -1; font-size:.72rem; text-align:right; color:var(--zest-muted); margin-top:2px; font-variant-numeric:tabular-nums; }
    .zest-stats-table { width:100%; border-collapse:collapse; font-size:.82rem; color:var(--zest-fg); }
    .zest-stats-table th,.zest-stats-table td { padding:10px 6px; border-bottom:1px solid var(--zest-line); text-align:left; vertical-align:top; }
    .zest-stats-table th { font-size:.75rem; font-weight:500; color:var(--zest-muted); }
    .zest-stats-table tr:last-child td { border-bottom:none; }
    .zest-stats-top td:not(:first-child) { white-space:nowrap; font-variant-numeric:tabular-nums; }
    .zest-stats-item { width:72%; overflow-wrap:anywhere; }
    .zest-stats-item-bar { height:4px; margin-top:8px; border-radius:3px; background:var(--zest-accent); opacity:.3; }
    .zest-stats-source { margin:18px 0 0; }
    @media(max-width:960px) { .zest-achievements { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media(max-width:820px) { .zest-stats-summary { grid-template-columns:repeat(3,minmax(0,1fr)); row-gap:20px; } .zest-stats-card:nth-child(4) { border-left:0; } .zest-stats-charts { grid-template-columns:minmax(0,1fr); } }
    @media(max-width:700px) { .zest-goals-layout { grid-template-columns:minmax(0,1fr); gap:16px; } .zest-rings { margin:auto; } }
    @media(max-width:560px) { .zest-stats { padding:16px; } .zest-stats-panel { padding:18px; } .zest-achievements { grid-template-columns:minmax(0,1fr); } .zest-stats-header { align-items:flex-start; } .zest-stats-card { padding:2px 12px; } .zest-stats-value { font-size:1.25rem; } .zest-goal-metrics { grid-template-columns:minmax(0,1fr); gap:18px; } .zest-goal-metric { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); column-gap:12px; } .zest-goal-line { display:contents; } .zest-goal-name { grid-column:1; grid-row:1; align-self:center; } .zest-goal-line strong,.zest-goal-metric progress,.zest-goal-detail { grid-column:2; } .zest-goal-amount { font-size:.94rem; } }
    @media(max-width:380px) { .zest-goal-week { gap:3px; } .zest-goal-day strong { width:26px; height:26px; } }
    /* Sidebar frames share the dashboard, not the standalone window spacing. */
    .zest-stats-embedded { max-width:100%; padding:0; overflow-wrap:anywhere; }
    .zest-stats-embedded .zest-stats-heading { display:none; }
    .zest-stats-embedded .zest-stats-header { justify-content:flex-end; margin:0 0 8px; gap:0; }
    .zest-stats-embedded .zest-stats-refresh { min-height:30px; }
    .zest-stats-embedded h2 { margin-bottom:10px; font-size:.875rem; }
    .zest-stats-embedded .zest-stats-panel { padding:12px; margin-top:10px; border-radius:12px; box-shadow:none; }
    .zest-stats-embedded .zest-goals { margin-top:0; }
    .zest-stats-embedded .zest-goals-layout { grid-template-columns:minmax(0,1fr); gap:12px; }
    .zest-stats-embedded .zest-rings { width:min(168px,100%); height:auto; aspect-ratio:1; margin:auto; }
    .zest-stats-embedded .zest-rings-centre strong { font-size:1.25rem; }
    .zest-stats-embedded .zest-goals-content { min-width:0; }
    .zest-stats-embedded .zest-goal-metrics { grid-template-columns:minmax(0,1fr); gap:12px; }
    .zest-stats-embedded .zest-goal-metric { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr); column-gap:8px; }
    .zest-stats-embedded .zest-goal-line { display:contents; }
    .zest-stats-embedded .zest-goal-name { grid-column:1; grid-row:1; align-self:center; }
    .zest-stats-embedded .zest-goal-line strong,.zest-stats-embedded .zest-goal-metric progress,.zest-stats-embedded .zest-goal-detail { grid-column:2; }
    .zest-stats-embedded .zest-goal-amount { font-size:.94rem; }
    .zest-stats-embedded .zest-goal-week { margin-top:14px; padding-top:12px; gap:3px; }
    .zest-stats-embedded .zest-goal-day { min-width:0; padding:0; text-align:center; }
    .zest-stats-embedded .zest-goal-day strong { width:26px; height:26px; }
    .zest-stats-embedded .zest-goal-controls { display:grid; grid-template-columns:minmax(0,1fr); gap:8px; margin-top:10px; }
    .zest-stats-embedded .zest-goal-controls label { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); font-size:.8rem; }
    .zest-stats-embedded .zest-goal-controls select { width:100%; min-width:0; padding:6px 8px; font-size:.8rem; }
    .zest-stats-embedded .zest-stats-summary { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 0; padding:12px 0; margin-top:10px; border-radius:12px; box-shadow:none; }
    .zest-stats-embedded .zest-stats-card { padding:0 12px; border-left:0; }
    .zest-stats-embedded .zest-stats-card:nth-child(even) { border-left:1px solid var(--zest-line); }
    .zest-stats-embedded .zest-stats-value { font-size:1.15rem; }
    .zest-stats-embedded .zest-stats-note { margin:8px 0; }
    .zest-stats-embedded .zest-stats-charts { grid-template-columns:minmax(0,1fr); gap:0; }
    .zest-stats-embedded .zest-trend-header { gap:8px; }
    .zest-stats-embedded .zest-trend-header h2 { margin:0; }
    .zest-stats-embedded .zest-stats-ranges { max-width:100%; flex-wrap:wrap; }
    .zest-stats-embedded .zest-stats-ranges button { padding:4px 8px; }
    .zest-stats-embedded .zest-stats-period { gap:8px; margin:16px 0 8px; }
    .zest-stats-embedded .zest-stats-weekdays { margin-top:12px; }
    .zest-stats-embedded .zest-weekday { grid-template-columns:minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr); gap:8px; margin:12px 0; }
    .zest-stats-embedded .zest-cal-wrap { max-width:100%; min-width:0; }
    .zest-stats-embedded .zest-achievements { grid-template-columns:minmax(0,1fr); gap:8px; margin:12px 0 0; }
    .zest-stats-embedded .zest-achievement { grid-template-columns:44px minmax(0,1fr); column-gap:10px; padding:12px; }
    .zest-stats-embedded .zest-achievement-category { margin-bottom:4px; }
    .zest-stats-embedded .zest-medal { width:44px; height:49px; }
    .zest-stats-embedded .zest-stats-table { table-layout:fixed; }
    .zest-stats-embedded .zest-stats-table th,.zest-stats-embedded .zest-stats-table td { padding:8px 4px; overflow-wrap:anywhere; }
    .zest-stats-embedded .zest-stats-top td:not(:first-child) { white-space:normal; }
    .zest-stats-embedded .zest-stats-item { width:55%; }
    .zest-stats-embedded .zest-stats-source { margin-top:12px; }
  `;
}
