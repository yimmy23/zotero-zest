const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const { componentTargets, fitGraphBounds } = createHarness().load(
  "src/graph/layout.ts",
);

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}

test("component targets allocate the dominant graph proportional space instead of an equal grid cell", () => {
  const targets = componentTargets([196, 4], 1000, 500);
  const innerWidth = 1000 - 56;
  // The first component owns 98% of the inner rectangle, centred close to
  // the viewport origin. The small component sits in the remaining strip.
  near(targets[0].x, -innerWidth / 2 + (innerWidth * 0.98) / 2);
  near(targets[1].x, innerWidth / 2 - (innerWidth * 0.02) / 2);
  near(targets[0].y, 0);
  near(targets[1].y, 0);
  assert.ok(Math.abs(targets[0].x) < 10);
  assert.ok(targets[1].x > 450);
});

test("component targets preserve input identity, minimum weights and deterministic ties", () => {
  const sizes = [1, 0, 4, 100, 2, 4];
  const original = [...sizes];
  const targets = componentTargets(sizes, 600, 400);
  assert.deepEqual(sizes, original, "the caller's component sizes stay intact");
  assert.deepEqual(targets, componentTargets([4, 4, 4, 100, 4, 4], 600, 400));
  assert.deepEqual(targets, componentTargets(sizes, 600, 400));
  assert.ok(
    Math.abs(targets[3].x) < Math.abs(targets[0].x),
    "the dominant component keeps its original index after sorting",
  );
  assert.equal(new Set(targets.map((p) => `${p.x},${p.y}`)).size, sizes.length);
});

test("component targets remain inside the viewport for narrow, tall and tiny panels", () => {
  const sizes = [180, 22, 15, 10, 8, 6, 5, 4, 3, 1, 1, 1, 1, 1];
  for (const [width, height] of [
    [960, 460],
    [40, 2000],
    [2000, 40],
    [1, 1],
    [0.1, 0.01],
  ]) {
    const targets = componentTargets(sizes, width, height);
    assert.equal(targets.length, sizes.length);
    for (const { x, y } of targets) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(Math.abs(x) <= width / 2);
      assert.ok(Math.abs(y) <= height / 2);
    }
  }
});

test("component targets handle empty and invalid inputs without non-finite coordinates", () => {
  assert.equal(componentTargets([], 600, 400).length, 0);
  const single = componentTargets([10], 600, 400);
  near(single[0].x, 0);
  near(single[0].y, 0);
  for (const dimensions of [
    [0, 0],
    [-10, Infinity],
    [NaN, 400],
  ]) {
    const targets = componentTargets(
      [NaN, -5, Infinity, 1e308, 1e308],
      ...dimensions,
    );
    assert.equal(targets.length, 5);
    assert.ok(
      targets.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
    );
  }
});

test("fit applies one scale and keeps all graph bounds within the padded viewport", () => {
  const bounds = { minX: -406, minY: -287, maxX: 384, maxY: 268 };
  const width = 960;
  const height = 460;
  const fitted = fitGraphBounds(bounds, width, height);
  const left = width / 2 + fitted.panX + bounds.minX * fitted.scale;
  const right = width / 2 + fitted.panX + bounds.maxX * fitted.scale;
  const top = height / 2 + fitted.panY + bounds.minY * fitted.scale;
  const bottom = height / 2 + fitted.panY + bounds.maxY * fitted.scale;
  assert.ok(left >= 28 && right <= width - 28);
  assert.ok(top >= 28 - 1e-8 && bottom <= height - 28 + 1e-8);
  near((left + right) / 2, width / 2);
  near((top + bottom) / 2, height / 2);
  near(
    (right - left) / (bottom - top),
    (bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY),
  );
});

test("fit centres small and single-point graphs without enlarging them", () => {
  for (const bounds of [
    { minX: 30, minY: 10, maxX: 90, maxY: 50 },
    { minX: 100, minY: -20, maxX: 100, maxY: -20 },
  ]) {
    const result = fitGraphBounds(bounds, 600, 400);
    assert.equal(result.scale, 1);
    near(result.panX, -(bounds.minX + bounds.maxX) / 2);
    near(result.panY, -(bounds.minY + bounds.maxY) / 2);
  }
});

test("fit allows large graphs below the interactive zoom floor and clamps tiny viewport padding", () => {
  const huge = fitGraphBounds(
    { minX: -10000, minY: -5000, maxX: 10000, maxY: 5000 },
    600,
    400,
  );
  assert.ok(huge.scale > 0 && huge.scale < 0.2);
  const tiny = fitGraphBounds(
    { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    2,
    1,
    100,
  );
  near(tiny.scale, 0.025);
  near(0.5 - 10 * tiny.scale, 0.25);
  near(0.5 + 10 * tiny.scale, 0.75);
});

test("fit rejects invalid bounds and safely handles finite endpoint overflow", () => {
  for (const bounds of [
    { minX: NaN, minY: 0, maxX: 1, maxY: 1 },
    { minX: 0, minY: 0, maxX: Infinity, maxY: 1 },
    { minX: 10, minY: 0, maxX: 1, maxY: 1 },
    { minX: 0, minY: 10, maxX: 1, maxY: 1 },
  ]) {
    const fallback = fitGraphBounds(bounds, 600, 400);
    assert.equal(fallback.scale, 1);
    assert.equal(fallback.panX, 0);
    assert.equal(fallback.panY, 0);
  }
  const extreme = fitGraphBounds(
    { minX: -1e308, minY: -1e308, maxX: 1e308, maxY: 1e308 },
    600,
    400,
  );
  assert.ok(extreme.scale > 0 && Number.isFinite(extreme.scale));
  assert.ok(Number.isFinite(extreme.panX) && Number.isFinite(extreme.panY));
  near(200 - 1e308 * extreme.scale, 28);
  const invalidViewport = fitGraphBounds(
    { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    NaN,
    0,
    Infinity,
  );
  assert.ok(invalidViewport.scale > 0 && invalidViewport.scale <= 1);
  assert.ok(Number.isFinite(invalidViewport.panX));
  assert.ok(Number.isFinite(invalidViewport.panY));
});
