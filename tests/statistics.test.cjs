const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const process = require("node:process");
const { execFileSync } = require("node:child_process");
const { createHarness } = require("./helpers.cjs");

const { aggregateReadingStats, readingPeriod, readingGoals, isoDay, addDays } =
  createHarness().load("src/reading/statistics.ts");
const NOW = new Date("2026-09-07T12:00:00");
const plain = (value) => JSON.parse(JSON.stringify(value));
const record = (total = 0, days = [], page = []) => ({
  libraryID: 1,
  itemKey: "READ0001",
  atts: new Map(),
  total,
  days: new Map(days),
  page: new Map(page),
  pages: 0,
  primaryAtt: "",
  firstRead: 0,
  lastRead: 0,
});
const statsOf = (...records) =>
  aggregateReadingStats(
    records.map((value, index) => [`1/ITEM${index}`, value]),
    NOW,
  );
const achievement = (stats, id) => stats.achievements.find((a) => a.id === id);

test("empty and zero records have no activity or achievements", () => {
  for (const stats of [statsOf(), statsOf(record(0, [["2026-09-07", 0]]))]) {
    assert.equal(stats.today, "2026-09-07");
    assert.equal(stats.totalSeconds, 0);
    assert.equal(stats.datedSeconds, 0);
    assert.equal(stats.undatedSeconds, 0);
    assert.equal(stats.daysRead, 0);
    assert.equal(stats.itemCount, 0);
    assert.equal(stats.pages, 0);
    assert.equal(stats.bestDay, null);
    assert.equal(stats.streak, 0);
    assert.equal(stats.longestStreak, 0);
    assert.equal(stats.inconsistentDays, false);
    assert.equal(stats.topItems.length, 0);
    assert.equal(stats.achievements.length, 9);
    assert.ok(stats.achievements.every((a) => !a.unlocked && a.progress === 0));
  }
});

test("legacy totals and dated imports retain separate accounting", () => {
  const legacy = record(200);
  delete legacy.days;
  const stats = statsOf(
    legacy,
    record(100, [
      ["2026-09-06", 100],
      ["2026-09-07", 100],
    ]),
    record(200, [["2026-09-07", 100]]),
  );
  assert.equal(stats.totalSeconds, 500);
  assert.equal(stats.datedSeconds, 300);
  assert.equal(stats.undatedSeconds, 300);
  assert.equal(stats.inconsistentDays, true);
  assert.equal(stats.itemCount, 3);
  assert.deepEqual(plain([...stats.byDay]), [
    ["2026-09-06", 100],
    ["2026-09-07", 200],
  ]);
});

test("reject malformed, impossible, future and non-positive calendar data", () => {
  const stats = statsOf(
    record(500, [
      ["2026-02-31", 100],
      ["2026-02-29", 100],
      ["2026-04-31", 100],
      ["2026-13-01", 100],
      ["2026-00-01", 100],
      ["2026-09-00", 100],
      ["2026-9-07", 100],
      ["2026-09-07T12:00:00Z", 100],
      ["2026-09-08", 100],
      ["2026-09-01", NaN],
      ["2026-09-02", Infinity],
      ["2026-09-03", -10],
      ["2026-09-04", 0],
      ["2026-09-05", 60],
      ["2026-09-07", 40],
    ]),
  );
  assert.deepEqual(plain([...stats.byDay]), [
    ["2026-09-05", 60],
    ["2026-09-07", 40],
  ]);
  assert.equal(stats.totalSeconds, 500);
  assert.equal(stats.datedSeconds, 100);
  assert.equal(stats.undatedSeconds, 400);
  assert.equal(stats.daysRead, 2);
  assert.equal(stats.longestStreak, 1);
  assert.equal(stats.streak, 1);
});

test("Gregorian leap-day validation includes century exceptions", () => {
  const stats = statsOf(
    record(50, [
      ["1900-02-29", 10],
      ["2000-02-29", 20],
      ["2024-02-29", 30],
      ["2025-02-29", 40],
    ]),
  );
  assert.deepEqual(plain([...stats.byDay]), [
    ["2000-02-29", 20],
    ["2024-02-29", 30],
  ]);
});

test("repeated date keys reuse only accepted dates and retain per-record validation", () => {
  const stats = statsOf(
    record(100, [
      ["2026-09-07", 100],
      ["2026-02-31", 100],
      ["2026-09-08", 100],
    ]),
    record(200, [
      ["2026-09-07", 200],
      ["2026-02-31", 200],
      ["2026-09-08", 200],
    ]),
    record(50, [
      ["2026-09-07", NaN],
      ["2026-09-06", 0],
    ]),
    record(50, [
      ["2026-09-07", -100],
      ["2026-09-06", 50],
    ]),
  );
  assert.deepEqual(plain([...stats.byDay]), [
    ["2026-09-07", 300],
    ["2026-09-06", 50],
  ]);
  assert.equal(stats.totalSeconds, 400);
  assert.equal(stats.datedSeconds, 350);
  assert.equal(stats.undatedSeconds, 50);
  assert.equal(stats.inconsistentDays, false);
  assert.equal(stats.streak, 2);
});

test("invalid totals do not create counted or ranked items", () => {
  const stats = statsOf(record(NaN), record(Infinity), record(-20), record(30));
  assert.equal(stats.totalSeconds, 30);
  assert.equal(stats.itemCount, 1);
  assert.equal(stats.topItems.length, 1);
  assert.equal(stats.topItems[0].key, "1/ITEM3");
});

test("pages are counted once from the primary map, not across attachments", () => {
  const input = record(
    100,
    [],
    [
      [-1, 100],
      [0, 4.99],
      [1, 5],
      [2, 6],
      [3, Infinity],
      [4, NaN],
      [0.5, 50],
    ],
  );
  input.atts.set("A", {
    page: new Map([
      [1, 5],
      [2, 6],
    ]),
    total: 11,
    pages: 3,
  });
  input.atts.set("B", {
    page: new Map([
      [1, 20],
      [2, 50],
    ]),
    total: 70,
    pages: 3,
  });
  const stats = statsOf(input);
  assert.equal(stats.pages, 2);
  assert.equal(stats.topItems[0].pages, 2);
});

test("current streak can continue from yesterday but not an older day", () => {
  const input = record(60, [
    ["2026-09-03", 10],
    ["2026-09-04", 10],
    ["2026-09-05", 10],
    ["2026-09-06", 10],
  ]);
  assert.equal(statsOf(input).streak, 4);
  input.days.delete("2026-09-06");
  assert.equal(statsOf(input).streak, 0);
  input.days.set("2026-09-07", 10);
  assert.equal(statsOf(input).streak, 1);
  assert.equal(statsOf(input).longestStreak, 3);
});

test("longest and best day are independent of entry order and current streak", () => {
  const stats = statsOf(
    record(1000, [
      ["2026-09-07", 300],
      ["2026-08-30", 300],
      ["2026-09-01", 10],
      ["2026-08-31", 10],
      ["2026-09-02", 10],
      ["2026-09-04", 10],
    ]),
  );
  assert.equal(stats.longestStreak, 4);
  assert.equal(stats.streak, 1);
  assert.deepEqual(plain(stats.bestDay), { day: "2026-09-07", seconds: 300 });
});

test("periods include zero days, Monday-first weekdays and an adjacent prior window", () => {
  const stats = statsOf(
    record(1000, [
      ["2026-08-24", 999], // Before the prior window.
      ["2026-08-25", 10],
      ["2026-08-31", 20], // Prior 7 days.
      ["2026-09-01", 30],
      ["2026-09-06", 40],
      ["2026-09-07", 50],
    ]),
  );
  const period = readingPeriod(stats, 7);
  assert.equal(period.days.length, 7);
  assert.equal(period.days[0].day, "2026-09-01");
  assert.equal(period.days[6].day, "2026-09-07");
  assert.equal(period.days[1].seconds, 0);
  assert.equal(period.totalSeconds, 120);
  assert.equal(period.previousSeconds, 30);
  assert.equal(period.activeDays, 3);
  assert.equal(period.averageSeconds, 120 / 7);
  assert.deepEqual(plain(period.weekdays), [50, 30, 0, 0, 0, 0, 40]);
  assert.equal(readingPeriod(stats, 30).days.length, 30);
  assert.equal(readingPeriod(stats, 90).days.length, 90);
});

test("achievements use cumulative time, five-minute items and five-minute daily streaks", () => {
  const days = Array.from({ length: 30 }, (_, index) => [
    isoDay(addDays(NOW, index - 29)),
    300,
  ]);
  const stats = statsOf(
    record(180000, days),
    ...Array.from({ length: 49 }, () => record(300)),
    record(299),
  );
  assert.ok(stats.achievements.every((a) => a.unlocked && a.progress === 1));
  assert.equal(achievement(stats, "items-50").value, 50);
  assert.equal(achievement(stats, "streak-30").value, 30);
  assert.equal(achievement(stats, "time-50h").value, 194999);

  const short = statsOf(record(299, [["2026-09-07", 299]]));
  assert.equal(achievement(short, "first-reading").progress, 299 / 300);
  assert.equal(achievement(short, "first-reading").unlocked, false);
  assert.equal(achievement(short, "items-10").value, 0);
  assert.equal(achievement(short, "streak-3").value, 0);
});

test("daily achievements combine items but an under-five-minute day breaks the run", () => {
  const stats = statsOf(
    record(1200, [
      ["2026-09-01", 300],
      ["2026-09-02", 299],
      ["2026-09-03", 150],
      ["2026-09-04", 300],
      ["2026-09-05", 300],
    ]),
    record(150, [["2026-09-03", 150]]),
  );
  assert.equal(stats.longestStreak, 5);
  assert.equal(achievement(stats, "streak-3").value, 3);
  assert.equal(achievement(stats, "streak-3").unlocked, true);
  assert.equal(achievement(stats, "streak-7").unlocked, false);
  assert.equal(achievement(stats, "streak-7").progress, 3 / 7);
});

test("top items are bounded, sorted deterministically and consume an iterable once", () => {
  let consumed = 0;
  function* entries() {
    for (let index = 0; index < 10000; index++) {
      consumed++;
      yield [`1/${String(index).padStart(5, "0")}`, record(index + 1)];
    }
    yield ["1/ZZZZZ", record(10000)];
  }
  const stats = aggregateReadingStats(entries(), NOW);
  assert.equal(consumed, 10000);
  assert.equal(stats.itemCount, 10001);
  assert.equal(stats.topItems.length, 12);
  assert.equal(stats.topItems[0].key, "1/09999");
  assert.equal(stats.topItems[1].key, "1/ZZZZZ");
  assert.equal(stats.topItems[11].seconds, 9990);
});

test("aggregation and calendar helpers never mutate source records or the supplied date", () => {
  const input = record(300, [["2026-09-07", 300]], [[0, 300]]);
  const originalDays = [...input.days];
  const originalPages = [...input.page];
  Object.freeze(input);
  const stats = statsOf(input);
  stats.byDay.set("2026-09-07", 999);
  stats.topItems[0].seconds = 999;
  assert.equal(input.total, 300);
  assert.deepEqual([...input.days], originalDays);
  assert.deepEqual([...input.page], originalPages);
  const before = NOW.getTime();
  assert.equal(isoDay(addDays(NOW, -7)), "2026-08-31");
  assert.equal(NOW.getTime(), before);
});

test("local periods and streaks cross both DST transitions without repeating or skipping dates", () => {
  const script = `
    const assert = require("node:assert/strict");
    const { createHarness } = require("./tests/helpers.cjs");
    const { aggregateReadingStats, readingPeriod, isoDay, addDays } = createHarness().load("src/reading/statistics.ts");
    for (const end of ["2026-03-10", "2026-11-03"]) {
      const now = new Date(end + "T00:15:00");
      const days = Array.from({length: 7}, (_, i) => [isoDay(addDays(now, i - 6)), 300]);
      const stats = aggregateReadingStats([["1/A", {total: 2100, days: new Map(days), page: new Map()}]], now);
      assert.equal(stats.today, end);
      assert.equal(stats.streak, 7);
      assert.equal(stats.longestStreak, 7);
      const period = readingPeriod(stats, 7);
      assert.equal(new Set(period.days.map(d => d.day)).size, 7);
      assert.equal(period.totalSeconds, 2100);
      assert.equal(period.activeDays, 7);
      assert.equal(period.previousSeconds, 0);
    }
  `;
  execFileSync(process.execPath, ["-e", script], {
    cwd: path.resolve(path.dirname(module.filename), ".."),
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
  });
});

test("reading goals start empty with default targets and future days marked", () => {
  const goals = readingGoals(statsOf());
  assert.equal(goals.dailyMinutes, 30);
  assert.equal(goals.weeklyDays, 5);
  assert.equal(goals.todaySeconds, 0);
  assert.equal(goals.weekSeconds, 0);
  assert.equal(goals.goalDays, 0);
  assert.equal(goals.week.length, 7);
  assert.equal(goals.week[0].day, "2026-09-07");
  assert.equal(goals.week[6].day, "2026-09-13");
  assert.equal(goals.week[0].future, false);
  assert.ok(goals.week.slice(1).every((day) => day.future && !day.achieved));
  assert.ok(goals.week.every((day) => !day.achieved && day.seconds === 0));
  assert.deepEqual(plain(goals.rings), [
    { id: "today", value: 0, target: 1800, progress: 0 },
    { id: "week-time", value: 0, target: 9000, progress: 0 },
    { id: "week-days", value: 0, target: 5, progress: 0 },
  ]);
});

test("today closes exactly at the selected goal and uses dated not cumulative time", () => {
  const stats = statsOf(record(180000, [["2026-09-07", 1800]]));
  const goals = readingGoals(stats);
  assert.equal(goals.todaySeconds, 1800);
  assert.equal(goals.weekSeconds, 1800);
  assert.equal(goals.goalDays, 1);
  assert.equal(goals.week[0].achieved, true);
  assert.equal(goals.rings[0].progress, 1);
  assert.equal(goals.rings[1].progress, 0.2);
  assert.equal(goals.rings[2].progress, 0.2);
  const before = readingGoals(statsOf(record(180000, [["2026-09-07", 1799]])));
  assert.equal(before.goalDays, 0);
  assert.equal(before.week[0].achieved, false);
  assert.equal(before.rings[0].progress, 1799 / 1800);
});

test("calendar week resets on Monday rather than rolling the last seven days", () => {
  const input = record(9000, [
    ["2026-08-30", 1800], // Prior Sunday is never this week's reading.
    ["2026-08-31", 1800],
    ["2026-09-05", 1800],
    ["2026-09-06", 1800],
    ["2026-09-07", 1800],
  ]);
  const sunday = readingGoals(
    aggregateReadingStats([["1/A", input]], new Date("2026-09-06T23:59:00")),
  );
  assert.equal(sunday.week[0].day, "2026-08-31");
  assert.equal(sunday.week[6].day, "2026-09-06");
  assert.ok(sunday.week.every((day) => !day.future));
  assert.equal(sunday.weekSeconds, 5400);
  assert.equal(sunday.goalDays, 3);
  const monday = readingGoals(
    aggregateReadingStats([["1/A", input]], new Date("2026-09-07T00:01:00")),
  );
  assert.equal(monday.week[0].day, "2026-09-07");
  assert.equal(monday.weekSeconds, 1800);
  assert.equal(monday.goalDays, 1);
});

test("current week spans the year boundary without dropping December reading", () => {
  const stats = aggregateReadingStats(
    [
      [
        "1/A",
        record(5400, [
          ["2026-12-27", 1800],
          ["2026-12-28", 1800],
          ["2027-01-01", 1800],
        ]),
      ],
    ],
    new Date("2027-01-01T12:00:00"),
  );
  const goals = readingGoals(stats);
  assert.equal(goals.week[0].day, "2026-12-28");
  assert.equal(goals.week[6].day, "2027-01-03");
  assert.equal(goals.weekSeconds, 3600);
  assert.equal(goals.goalDays, 2);
  assert.equal(goals.week.filter((day) => day.future).length, 2);
});

test("goal presets validate separately and retain valid user choices", () => {
  const stats = statsOf();
  for (const daily of [15, 30, 45, 60]) {
    for (const weekly of [3, 5, 7]) {
      const goals = readingGoals(stats, daily, weekly);
      assert.equal(goals.dailyMinutes, daily);
      assert.equal(goals.weeklyDays, weekly);
      assert.equal(goals.rings[0].target, daily * 60);
      assert.equal(goals.rings[1].target, daily * weekly * 60);
      assert.equal(goals.rings[2].target, weekly);
    }
  }
  for (const invalid of [0, -1, 20, 15.5, NaN, Infinity, null, "15"]) {
    assert.equal(readingGoals(stats, invalid, 3).dailyMinutes, 30);
    assert.equal(readingGoals(stats, invalid, 3).weeklyDays, 3);
  }
  for (const invalid of [0, -1, 4, 3.5, NaN, Infinity, null, "3"]) {
    assert.equal(readingGoals(stats, 15, invalid).weeklyDays, 5);
    assert.equal(readingGoals(stats, 15, invalid).dailyMinutes, 15);
  }
});

test("overachieved rings keep actual values but clamp graphical progress at one", () => {
  const days = Array.from({ length: 7 }, (_, i) => [
    isoDay(addDays(NOW, i)),
    7200,
  ]);
  const stats = aggregateReadingStats(
    [["1/A", record(50400, days)]],
    new Date("2026-09-13T12:00:00"),
  );
  const goals = readingGoals(stats, 15, 3);
  assert.equal(goals.todaySeconds, 7200);
  assert.equal(goals.weekSeconds, 50400);
  assert.equal(goals.goalDays, 7);
  assert.deepEqual(plain(goals.rings.map((r) => r.progress)), [1, 1, 1]);
  assert.deepEqual(plain(goals.rings.map((r) => r.value)), [7200, 50400, 7]);
});

test("goals ignore future buckets and do not alter fixed five-minute achievements", () => {
  const stats = statsOf(
    record(5400, [
      ["2026-09-05", 1800],
      ["2026-09-06", 1800],
      ["2026-09-07", 1800],
    ]),
  );
  stats.byDay.set("2026-09-08", 7200);
  const awards = plain(stats.achievements);
  const goals = readingGoals(stats, 60, 7);
  assert.equal(goals.goalDays, 0);
  assert.equal(goals.weekSeconds, 1800);
  assert.equal(goals.week[1].seconds, 0);
  assert.equal(goals.week[1].future, true);
  assert.equal(goals.week[1].achieved, false);
  assert.equal(achievement(stats, "streak-3").unlocked, true);
  assert.deepEqual(plain(stats.achievements), awards);
  assert.equal(stats.byDay.get("2026-09-08"), 7200);
});
