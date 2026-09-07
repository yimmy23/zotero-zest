import type { ItemReading } from "./store";

export type StatsRange = 7 | 30 | 90;

export interface DayReading {
  day: string;
  seconds: number;
}

export interface TopReading {
  key: string;
  seconds: number;
  /** Primary-attachment pages with at least five recorded seconds. */
  pages: number;
}

export type AchievementID =
  | "first-reading"
  | "time-1h"
  | "time-10h"
  | "time-50h"
  | "items-10"
  | "items-50"
  | "streak-3"
  | "streak-7"
  | "streak-30";

export interface Achievement {
  id: AchievementID;
  metric: "seconds" | "items" | "days";
  target: number;
  value: number;
  unlocked: boolean;
  progress: number;
}

export interface ReadingStats {
  byDay: Map<string, number>;
  totalSeconds: number;
  daysRead: number;
  bestDay: DayReading | null;
  streak: number;
  longestStreak: number;
  itemCount: number;
  pages: number;
  topItems: TopReading[];
  today: string;
  datedSeconds: number;
  /** Sum of each record's positive total-minus-dated difference. */
  undatedSeconds: number;
  inconsistentDays: boolean;
  achievements: Achievement[];
}

export interface PeriodStats {
  days: DayReading[];
  totalSeconds: number;
  previousSeconds: number;
  activeDays: number;
  averageSeconds: number;
  /** Monday through Sunday totals within this period. */
  weekdays: number[];
}

export interface GoalDay extends DayReading {
  achieved: boolean;
  future: boolean;
}

export interface GoalRing {
  id: "today" | "week-time" | "week-days";
  value: number;
  target: number;
  progress: number;
}

export interface ReadingGoals {
  dailyMinutes: number;
  weeklyDays: number;
  todaySeconds: number;
  weekSeconds: number;
  goalDays: number;
  /** Current local calendar week, Monday through Sunday. */
  week: GoalDay[];
  rings: GoalRing[];
}

/** Local calendar date: never derive a reading day through UTC conversion. */
export function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A copied local calendar date, including across 23- and 25-hour DST days. */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function dateOf(day: string): Date {
  // Noon avoids transitions at local midnight while keeping the same date.
  return new Date(`${day}T12:00:00`);
}

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (month < 1 || month > 12 || date < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date <= lengths[month - 1];
}

function positiveSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function primaryPages(record: ItemReading): number {
  let count = 0;
  for (const [index, seconds] of record.page ?? []) {
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      Number.isFinite(seconds) &&
      seconds >= 5
    ) {
      count++;
    }
  }
  return count;
}

function rankTopItems(a: TopReading, b: TopReading): number {
  return b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Snapshot only: never mutate the live reading index or load item metadata.
 * Attachment totals and calendar totals are independent after legacy/max imports;
 * neither is repaired or added to the other here.
 */
export function aggregateReadingStats(
  entries: Iterable<[string, ItemReading]>,
  now = new Date(),
): ReadingStats {
  const today = isoDay(now);
  const byDay = new Map<string, number>();
  const topItems: TopReading[] = [];
  let totalSeconds = 0;
  let datedSeconds = 0;
  let undatedSeconds = 0;
  let inconsistentDays = false;
  let itemCount = 0;
  let pages = 0;
  let focusedItems = 0;

  for (const [key, record] of entries) {
    const seconds = positiveSeconds(record.total);
    const itemPages = primaryPages(record);
    let itemDated = 0;
    for (const [day, raw] of record.days ?? []) {
      const value = positiveSeconds(raw);
      // An accepted key is already a valid calendar date in this snapshot.
      // Reuse that validation across items, but never skip value/future checks.
      if (!value || day > today || (!byDay.has(day) && !validDay(day)))
        continue;
      byDay.set(day, (byDay.get(day) ?? 0) + value);
      itemDated += value;
    }
    totalSeconds += seconds;
    datedSeconds += itemDated;
    undatedSeconds += Math.max(0, seconds - itemDated);
    inconsistentDays ||= itemDated > seconds;
    pages += itemPages;
    if (seconds >= 300) focusedItems++;
    if (seconds > 0) {
      itemCount++;
      const candidate = { key, seconds, pages: itemPages };
      const index = topItems.findIndex(
        (item) => rankTopItems(candidate, item) < 0,
      );
      if (index >= 0) topItems.splice(index, 0, candidate);
      else if (topItems.length < 12) topItems.push(candidate);
      if (topItems.length > 12) topItems.pop();
    }
  }

  let bestDay: DayReading | null = null;
  let longestStreak = 0;
  let longestFocusedStreak = 0;
  let run = 0;
  let focusedRun = 0;
  let nextDay = "";
  for (const day of [...byDay.keys()].sort()) {
    const seconds = byDay.get(day)!;
    run = day === nextDay ? run + 1 : 1;
    focusedRun = seconds >= 300 ? (day === nextDay ? focusedRun + 1 : 1) : 0;
    longestStreak = Math.max(longestStreak, run);
    longestFocusedStreak = Math.max(longestFocusedStreak, focusedRun);
    // Equal-duration days favour the most recent date.
    if (!bestDay || seconds >= bestDay.seconds) bestDay = { day, seconds };
    nextDay = isoDay(addDays(dateOf(day), 1));
  }
  let streak = 0;
  let current = byDay.has(today) ? dateOf(today) : addDays(dateOf(today), -1);
  while (byDay.has(isoDay(current))) {
    streak++;
    current = addDays(current, -1);
  }

  const achievement = (
    id: AchievementID,
    metric: Achievement["metric"],
    target: number,
    value: number,
  ): Achievement => ({
    id,
    metric,
    target,
    value,
    unlocked: value >= target,
    progress: Math.min(1, value / target),
  });
  const achievements = [
    achievement("first-reading", "seconds", 300, totalSeconds),
    achievement("time-1h", "seconds", 3600, totalSeconds),
    achievement("time-10h", "seconds", 36000, totalSeconds),
    achievement("time-50h", "seconds", 180000, totalSeconds),
    achievement("items-10", "items", 10, focusedItems),
    achievement("items-50", "items", 50, focusedItems),
    achievement("streak-3", "days", 3, longestFocusedStreak),
    achievement("streak-7", "days", 7, longestFocusedStreak),
    achievement("streak-30", "days", 30, longestFocusedStreak),
  ];

  return {
    byDay,
    totalSeconds,
    daysRead: byDay.size,
    bestDay,
    streak,
    longestStreak,
    itemCount,
    pages,
    topItems,
    today,
    datedSeconds,
    undatedSeconds,
    inconsistentDays,
    achievements,
  };
}

/** Inclusive trailing calendar days, compared with an adjacent equal window. */
export function readingPeriod(
  stats: ReadingStats,
  range: StatsRange,
): PeriodStats {
  const end = dateOf(stats.today);
  const days: DayReading[] = [];
  const weekdays = Array<number>(7).fill(0);
  let totalSeconds = 0;
  let previousSeconds = 0;
  let activeDays = 0;
  for (let offset = 1 - range; offset <= 0; offset++) {
    const date = addDays(end, offset);
    const day = isoDay(date);
    const seconds = stats.byDay.get(day) ?? 0;
    days.push({ day, seconds });
    totalSeconds += seconds;
    if (seconds > 0) activeDays++;
    weekdays[(date.getDay() + 6) % 7] += seconds;
    previousSeconds += stats.byDay.get(isoDay(addDays(date, -range))) ?? 0;
  }
  return {
    days,
    totalSeconds,
    previousSeconds,
    activeDays,
    averageSeconds: totalSeconds / range,
    weekdays,
  };
}

/**
 * Current goals use dated activity only. Changing them never changes historical
 * achievements, whose five-minute thresholds are fixed in the aggregate model.
 */
export function readingGoals(
  stats: ReadingStats,
  dailyMinutes = 30,
  weeklyDays = 5,
): ReadingGoals {
  if (![15, 30, 45, 60].includes(dailyMinutes)) dailyMinutes = 30;
  if (![3, 5, 7].includes(weeklyDays)) weeklyDays = 5;
  const dailySeconds = dailyMinutes * 60;
  const today = dateOf(stats.today);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const todaySeconds = positiveSeconds(stats.byDay.get(stats.today) ?? 0);
  const week: GoalDay[] = [];
  let weekSeconds = 0;
  let goalDays = 0;
  for (let offset = 0; offset < 7; offset++) {
    const day = isoDay(addDays(monday, offset));
    const future = day > stats.today;
    const seconds = future ? 0 : positiveSeconds(stats.byDay.get(day) ?? 0);
    const achieved = !future && seconds >= dailySeconds;
    weekSeconds += seconds;
    if (achieved) goalDays++;
    week.push({ day, seconds, achieved, future });
  }
  const ring = (
    id: GoalRing["id"],
    value: number,
    target: number,
  ): GoalRing => ({
    id,
    value,
    target,
    progress: Math.min(1, value / target),
  });
  return {
    dailyMinutes,
    weeklyDays,
    todaySeconds,
    weekSeconds,
    goalDays,
    week,
    rings: [
      ring("today", todaySeconds, dailySeconds),
      ring("week-time", weekSeconds, dailySeconds * weeklyDays),
      ring("week-days", goalDays, weeklyDays),
    ],
  };
}
