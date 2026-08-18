import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import {
  readingStore,
  formatDuration,
  splitKey,
  pagesSeen,
} from "../reading/store";
import { hexToRgb } from "../reading/heat";
import { heatColor } from "../columns/reading";
import { HEAT_LEVELS } from "../ui/palette";
import { icon, ICON_CSS } from "../ui/icons";

/**
 * Reading statistics — a GitHub-style calendar of what you actually read.
 *
 * Everything comes from zest.sqlite, which the tracker already fills; this
 * window only aggregates. It is a plain XUL window rather than an item-pane
 * section because it is about the library, not about one item, and because a
 * year of days needs the width.
 */

const WEEKS = 53;
const DAY_MS = 86400000;

interface Stats {
  byDay: Map<string, number>;
  totalSeconds: number;
  daysRead: number;
  bestDay: { day: string; seconds: number } | null;
  streak: number;
  longestStreak: number;
  topItems: Array<{ title: string; seconds: number; pages: number }>;
  itemCount: number;
}

export function collectStats(): Stats {
  const byDay = readingStore.totalsByDay();
  let totalSeconds = 0;
  let bestDay: Stats["bestDay"] = null;
  for (const [day, seconds] of byDay) {
    totalSeconds += seconds;
    if (!bestDay || seconds > bestDay.seconds) bestDay = { day, seconds };
  }

  // streaks, walking back from today
  const has = (d: Date) => (byDay.get(isoDay(d)) ?? 0) > 0;
  let streak = 0;
  const cursor = new Date();
  if (!has(cursor)) cursor.setTime(cursor.getTime() - DAY_MS);
  while (has(cursor)) {
    streak++;
    cursor.setTime(cursor.getTime() - DAY_MS);
  }
  let longestStreak = 0;
  let run = 0;
  const days = [...byDay.keys()].sort();
  let previous: string | undefined;
  for (const day of days) {
    if (previous && dayDiff(previous, day) === 1) run++;
    else run = 1;
    if (run > longestStreak) longestStreak = run;
    previous = day;
  }

  const items: Stats["topItems"] = [];
  for (const [key, rec] of readingStore.entries()) {
    const [libraryID, itemKey] = splitKey(key);
    let title = itemKey;
    try {
      const id = Zotero.Items.getIDFromLibraryAndKey(libraryID, itemKey);
      const item = id ? (Zotero.Items.get(id as number) as Zotero.Item) : null;
      if (item) title = String(item.getField("title") || itemKey);
    } catch {
      // deleted item: keep the key
    }
    items.push({ title, seconds: rec.total, pages: pagesSeen(rec, 5) });
  }
  items.sort((a, b) => b.seconds - a.seconds);

  return {
    byDay,
    totalSeconds,
    daysRead: [...byDay.values()].filter((s) => s > 0).length,
    bestDay,
    streak,
    longestStreak,
    topItems: items.slice(0, 12),
    itemCount: items.length,
  };
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayDiff(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() -
      new Date(`${a}T00:00:00`).getTime()) /
      DAY_MS,
  );
}

let openWindow: Window | null = null;

export function openStatsDialog(parent?: Window) {
  const host = (parent ||
    (Zotero.getMainWindow() as unknown as Window)) as Window | null;
  if (!host?.openDialog) {
    ztoolkit.log("[stats] no window to open the dialog from");
    return;
  }
  if (openWindow && !openWindow.closed) {
    try {
      openWindow.focus();
      return;
    } catch {
      openWindow = null;
    }
  }
  const win = host.openDialog(
    "chrome://zotero/content/standalone/basicViewer.xhtml",
    `${config.addonRef}-stats`,
    "chrome,centerscreen,resizable,width=900,height=620",
  ) as Window | null;
  if (!win) return;
  openWindow = win;
  // openDialog reuses a window that already carries this name (e.g. one left
  // over from a plugin reload); it is already loaded, so render right away
  if (win.document?.readyState === "complete") {
    try {
      renderStats(win);
    } catch (e) {
      ztoolkit.log("[dialog] render failed", e);
    }
  }
  win.addEventListener(
    "load",
    guard("stats load", () => {
      try {
        renderStats(win);
      } catch (e) {
        ztoolkit.log("[stats] render failed", e);
      }
    }),
    { once: true },
  );
  win.addEventListener("unload", () => {
    if (openWindow === win) openWindow = null;
  });
}

export function renderStats(win: Window) {
  const doc = win.document;
  doc.title = getString("stats-title");
  const body = (doc.body || doc.documentElement) as HTMLElement;
  body.textContent = "";
  body.classList.add("zest-stats-body");

  const style = doc.createElement("style");
  style.textContent = STATS_CSS;
  body.appendChild(style);

  const stats = collectStats();
  const root = doc.createElement("div");
  root.className = "zest-stats";
  body.appendChild(root);

  const h = doc.createElement("h1");
  h.appendChild(icon(doc, "chart", 18));
  const hText = doc.createElement("span");
  hText.textContent = getString("stats-title");
  h.appendChild(hText);
  root.appendChild(h);

  const summary = doc.createElement("div");
  summary.className = "zest-stats-summary";
  const cards: Array<[string, string]> = [
    [getString("stats-total"), formatDuration(stats.totalSeconds)],
    [getString("stats-days"), String(stats.daysRead)],
    [getString("stats-streak"), String(stats.streak)],
    [getString("stats-longest"), String(stats.longestStreak)],
    [getString("stats-items"), String(stats.itemCount)],
    [
      getString("stats-best"),
      stats.bestDay
        ? `${stats.bestDay.day} · ${formatDuration(stats.bestDay.seconds)}`
        : "—",
    ],
  ];
  for (const [label, value] of cards) {
    const card = doc.createElement("div");
    card.className = "zest-stats-card";
    const v = doc.createElement("div");
    v.className = "zest-stats-value";
    v.textContent = value;
    const l = doc.createElement("div");
    l.className = "zest-stats-label";
    l.textContent = label;
    card.appendChild(v);
    card.appendChild(l);
    summary.appendChild(card);
  }
  root.appendChild(summary);

  root.appendChild(buildCalendar(doc, stats));

  if (stats.topItems.length) {
    const h2 = doc.createElement("h2");
    h2.textContent = getString("stats-top");
    root.appendChild(h2);
    const table = doc.createElement("table");
    table.className = "zest-stats-table";
    for (const row of stats.topItems) {
      const tr = doc.createElement("tr");
      const title = doc.createElement("td");
      title.textContent = row.title;
      const time = doc.createElement("td");
      time.className = "num";
      time.textContent = formatDuration(row.seconds);
      const pages = doc.createElement("td");
      pages.className = "num";
      pages.textContent = getString("stats-pages", {
        args: { pages: row.pages },
      });
      tr.appendChild(title);
      tr.appendChild(time);
      tr.appendChild(pages);
      table.appendChild(tr);
    }
    root.appendChild(table);
  }

  const note = doc.createElement("p");
  note.className = "zest-stats-note";
  note.textContent = getString("stats-source-note");
  root.appendChild(note);
}

/** the calendar: one column per week, one cell per day, four intensity steps */
function buildCalendar(doc: Document, stats: Stats): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "zest-cal-wrap";
  const grid = doc.createElement("div");
  grid.className = "zest-cal";

  const rgb = hexToRgb(heatColor()) || [102, 173, 255];
  const values = [...stats.byDay.values()]
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  // scale to the 90th percentile so one marathon day does not flatten the rest
  const p90 = values.length ? values[Math.floor(values.length * 0.9)] : 0;
  const scale = Math.max(600, p90 || 0);

  // the LAST column must be the week that contains today, so walk back from
  // this week's Sunday — anchoring on "today minus 53 weeks" and then rewinding
  // to a Sunday loses up to six days off the end, hiding today itself
  const today = new Date();
  const weekStart = new Date(today.getTime() - today.getDay() * DAY_MS);
  weekStart.setHours(0, 0, 0, 0);
  const start = new Date(weekStart.getTime() - (WEEKS - 1) * 7 * DAY_MS);

  for (let w = 0; w < WEEKS; w++) {
    const col = doc.createElement("div");
    col.className = "zest-cal-col";
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
      const cell = doc.createElement("span");
      cell.className = "zest-cal-cell";
      if (date > today) {
        cell.classList.add("future");
      } else {
        const day = isoDay(date);
        const seconds = stats.byDay.get(day) ?? 0;
        const t = seconds / scale;
        const level =
          seconds <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(t * 4)));
        if (level) {
          cell.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${HEAT_LEVELS[level - 1]})`;
        }
        cell.title = `${day} · ${seconds ? formatDuration(seconds) : getString("stats-nothing")}`;
      }
      col.appendChild(cell);
    }
    grid.appendChild(col);
  }
  wrap.appendChild(grid);
  return wrap;
}

const STATS_CSS =
  ICON_CSS +
  `
  /* Flat by design: no native button chrome, no bevels, no shadows — only
     background tints from the host theme. */
  .zest-flat-btn {
    appearance: none; -moz-appearance: none; border: 0; box-shadow: none;
    background: color-mix(in srgb, FieldText 8%, transparent);
    color: inherit; border-radius: 6px; padding: 4px 12px; cursor: pointer;
    font: inherit; font-size: .875rem; line-height: 1.4;
  }
  .zest-flat-btn:hover { background: color-mix(in srgb, FieldText 14%, transparent); }
  .zest-flat-btn:active { background: color-mix(in srgb, FieldText 20%, transparent); }
  .zest-flat-btn:focus-visible { outline: 2px solid AccentColor; outline-offset: 1px; }
  .zest-flat-input, .zest-flat-select {
    appearance: none; -moz-appearance: none; box-shadow: none;
    background: color-mix(in srgb, FieldText 6%, transparent);
    border: 1px solid color-mix(in srgb, FieldText 14%, transparent);
    border-radius: 6px; color: inherit; font: inherit; font-size: .875rem;
    padding: 4px 10px;
  }
  .zest-flat-select { padding-inline-end: 26px;
    background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                      linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: right 13px center, right 8px center;
    background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
  }
  .zest-flat-input:focus, .zest-flat-select:focus { outline: 2px solid AccentColor; outline-offset: -1px; }

  .zest-stats-body { margin: 0; font: message-box; background: Field; color: FieldText; }
  .zest-stats { padding: 18px 22px 28px; font-family: system-ui, sans-serif; }
  .zest-stats h1 { font-size: 1.25rem; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
  .zest-stats h2 { font-size: 1rem; margin: 22px 0 8px; }
  .zest-stats-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
  .zest-stats-card {
    min-width: 110px; padding: 8px 12px; border-radius: 8px; box-shadow: none;
    background: color-mix(in srgb, FieldText 6%, transparent);
  }
  .zest-stats-value { font-size: 1.15rem; font-weight: 600; }
  .zest-stats-label { font-size: .8rem; opacity: .7; margin-top: 2px; }
  .zest-cal-wrap { overflow-x: auto; padding-bottom: 6px; }
  .zest-cal { display: flex; gap: 3px; }
  .zest-cal-col { display: flex; flex-direction: column; gap: 3px; }
  .zest-cal-cell {
    width: 11px; height: 11px; border-radius: 2px;
    background: color-mix(in srgb, FieldText 8%, transparent);
  }
  .zest-cal-cell.future { visibility: hidden; }
  .zest-stats-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  .zest-stats-table td { padding: 4px 6px; border-bottom: 1px solid color-mix(in srgb, FieldText 12%, transparent); }
  .zest-stats-table td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; opacity: .85; }
  .zest-stats-note { margin-top: 18px; font-size: .8rem; opacity: .65; }
`;
