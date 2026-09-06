const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const { placeLabels, LABEL_HEIGHT } = createHarness().load(
  "src/graph/labels.ts",
);
const viewport = { width: 300, height: 180 };
const node = (id, x, y, width = 60, radius = 5) => ({
  id,
  x,
  y,
  width,
  radius,
});

function assertClear(
  placements,
  candidates,
  obstacles,
  bounds = viewport,
  labelHeight = LABEL_HEIGHT,
) {
  const labels = [...placements].map(([id, position]) => ({
    ...position,
    width: Math.min(
      candidates.find((item) => item.id === id).width,
      bounds.width - 8,
    ),
    height: labelHeight,
  }));
  const intersects = (a, b, gap) =>
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    assert.ok(label.x >= 4 && label.y >= 4);
    assert.ok(label.x + label.width <= bounds.width - 4);
    assert.ok(label.y + label.height <= bounds.height - 4);
    for (const other of labels.slice(i + 1)) {
      assert.equal(intersects(label, other, 3), false, "labels keep their gap");
    }
    for (const obstacle of obstacles) {
      assert.equal(
        intersects(
          label,
          {
            x: obstacle.x - obstacle.radius,
            y: obstacle.y - obstacle.radius,
            width: obstacle.radius * 2,
            height: obstacle.radius * 2,
          },
          2,
        ),
        false,
        "label does not cover a node",
      );
    }
  }
}

test("graph labels try below, right, above, then left without moving nodes", () => {
  const candidate = node("a", 150, 90);
  const positions = [
    { x: 120, y: 98 },
    { x: 158, y: 83 },
    { x: 120, y: 68 },
    { x: 82, y: 83 },
  ];
  const obstacles = [candidate];
  for (const expected of positions) {
    const result = placeLabels([candidate], obstacles, viewport, 10);
    assert.deepEqual({ ...result.get("a") }, expected);
    assertClear(result, [candidate], obstacles);
    obstacles.push({ x: expected.x + 30, y: expected.y + 7, radius: 1 });
  }
  assert.equal(placeLabels([candidate], obstacles, viewport, 10).size, 0);
  assert.deepEqual(candidate, node("a", 150, 90));
});

test("dense graph labels hide collisions and honor their priority and budget", () => {
  const candidates = Array.from({ length: 500 }, (_, index) =>
    node(
      String(index),
      12 + (index % 25) * 11,
      12 + Math.floor(index / 25) * 8,
      46,
      2,
    ),
  );
  const result = placeLabels(candidates, candidates, viewport, 40);
  assert.ok(
    result.size < 40,
    "dense obstacles hide labels instead of overlapping",
  );
  assertClear(result, candidates, candidates);
  const sparse = [
    node("first", 50, 30),
    node("second", 150, 30),
    node("third", 250, 30),
  ];
  const budgeted = placeLabels(sparse, sparse, viewport, 1.9);
  assert.deepEqual([...budgeted.keys()], ["first"]);
  assertClear(budgeted, sparse, sparse);
});

test("labels competing for the same node neighborhood never overlap each other", () => {
  const candidates = Array.from({ length: 8 }, (_, index) =>
    node(String(index), 150, 90, 40, 10),
  );
  const result = placeLabels(candidates, candidates, viewport, 8);
  assert.deepEqual([...result.keys()], ["0", "1", "2", "3"]);
  assertClear(result, candidates, candidates);
});

test("labels stay within the viewport at all four edges and ignore offscreen nodes", () => {
  const candidates = [
    node("left", 2, 70, 45),
    node("right", 298, 70, 45),
    node("top", 100, 2, 45),
    node("bottom", 200, 178, 45),
    node("outside-left", -20, 50),
    node("outside-right", 330, 50),
    node("outside-top", 150, -30),
    node("outside-bottom", 150, 200),
  ];
  const result = placeLabels(candidates, candidates, viewport, 20);
  assert.deepEqual([...result.keys()], ["left", "right", "top", "bottom"]);
  assertClear(result, candidates, candidates);
  assert.equal(
    placeLabels(candidates, candidates, viewport, 1, "outside-left").has(
      "outside-left",
    ),
    false,
  );
});

test("a long label is constrained to the width that the renderer can truncate to", () => {
  const bounds = { width: 80, height: 60 };
  const candidate = node("long", 40, 20, 500);
  const result = placeLabels([candidate], [candidate], bounds, 3);
  assert.equal(result.size, 1);
  assert.equal(result.get("long").x, 4);
  assertClear(result, [candidate], [candidate], bounds);
});

test("a focused label goes first and is clamped if nodes occupy every direction", () => {
  const candidates = [
    node("first", 70, 50),
    node("focus", 290, 175, 400),
    node("last", 150, 20),
  ];
  const blockers = [...candidates, { x: 150, y: 90, radius: 200 }];
  const result = placeLabels(candidates, blockers, viewport, 2, "focus");
  assert.deepEqual([...result.keys()], ["focus"]);
  assert.deepEqual({ ...result.get("focus") }, { x: 4, y: 162 });
  const sparse = placeLabels(candidates, candidates, viewport, 1, "last");
  assert.deepEqual([...sparse.keys()], ["last"]);
  // Later labels must still avoid the clamped focus label.
  const partlyBlocked = placeLabels(
    candidates,
    candidates,
    viewport,
    3,
    "focus",
  );
  assertClear(partlyBlocked, candidates, []);
});

test("empty, tiny and nonfinite inputs produce only safe finite placements", () => {
  const valid = node("valid", 20, 15, 20, 2);
  assert.equal(placeLabels([], [], viewport, 40).size, 0);
  for (const bounds of [
    { width: 8, height: 180 },
    { width: 300, height: 21 },
    { width: NaN, height: 180 },
    { width: 300, height: Infinity },
  ]) {
    assert.equal(placeLabels([valid], [], bounds, 40, "valid").size, 0);
  }
  for (const budget of [0, -1, NaN, Infinity, 0.9]) {
    assert.equal(placeLabels([valid], [], viewport, budget, "valid").size, 0);
  }
  const candidates = [
    node("nan", NaN, 20),
    node("infinite", 20, Infinity),
    node("invalid-width", 20, 20, Infinity),
    node("zero-width", 20, 20, 0),
    node("invalid-radius", 20, 20, 20, -1),
    valid,
    valid,
  ];
  const result = placeLabels(
    candidates,
    [{ x: NaN, y: 10, radius: 2 }],
    viewport,
    40,
  );
  assert.deepEqual([...result.keys()], ["valid"]);
  assertClear(result, candidates, []);
});

test("larger label heights reserve real vertical space and stay inside the viewport", () => {
  const labelHeight = 32;
  const candidates = [
    node("top", 60, 4, 60),
    node("center", 60, 45, 60),
    node("bottom", 200, 178, 60),
    node("near-bottom", 200, 130, 60),
  ];
  const result = placeLabels(
    candidates,
    candidates,
    viewport,
    20,
    undefined,
    labelHeight,
  );
  assert.ok(result.size > 1);
  assertClear(result, candidates, candidates, viewport, labelHeight);
  const forced = node("focus", 150, 178, 280);
  const blocked = [forced, { x: 150, y: 90, radius: 180 }];
  const fallback = placeLabels(
    [forced],
    blocked,
    viewport,
    1,
    "focus",
    labelHeight,
  );
  assert.deepEqual({ ...fallback.get("focus") }, { x: 10, y: 144 });
  assertClear(fallback, [forced], [], viewport, labelHeight);
  assert.equal(
    placeLabels(
      [forced],
      [],
      { width: 300, height: 39 },
      1,
      "focus",
      labelHeight,
    ).size,
    0,
  );
  for (const invalidHeight of [0, -1, NaN, Infinity]) {
    assert.equal(
      placeLabels(candidates, [], viewport, 40, "top", invalidHeight).size,
      0,
    );
  }
});
