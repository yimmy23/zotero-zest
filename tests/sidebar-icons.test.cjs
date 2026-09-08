/* global __dirname */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const icon = (size, name) =>
  readFileSync(
    path.join(
      __dirname,
      "../addon/content/icons",
      size === 20 ? "20" : "",
      name + ".svg",
    ),
    "utf8",
  );

for (const size of [16, 20]) {
  test(`${size}px sidebar strokes match the Refs native icon weight`, () => {
    const width = size === 16 ? 1 : 1.25;
    for (const name of ["annots", "reading-stats", "matrix", "local-graph"]) {
      const svg = icon(size, name);
      assert.match(svg, new RegExp(`stroke-width="${width}"`));
      assert.match(svg, /stroke="context-fill"/);
      assert.match(svg, /stroke-opacity="context-fill-opacity"/);
      assert.match(svg, /stroke-linecap="butt"/);
      assert.match(svg, /stroke-linejoin="miter"/);
      assert.doesNotMatch(svg, /\brx=|\bry=/);
    }
    if (size === 16)
      assert.match(icon(size, "open-window"), /stroke-width="1"/);
  });

  test(`${size}px graph connectors terminate at the hollow node rings`, () => {
    const svg = icon(size, "local-graph");
    const circles = [
      ...svg.matchAll(/cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g),
    ].map((match) => match.slice(1).map(Number));
    assert.equal(circles.length, 3);
    assert.match(svg, /<path stroke-linecap="butt"/);
    const segments = [
      ...svg.matchAll(/M([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g),
    ].map((match) => match.slice(1).map(Number));
    assert.equal(segments.length, 3);
    const pairs = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    segments.forEach(([x1, y1, x2, y2], index) => {
      const [a, b] = pairs[index].map((i) => circles[i]);
      const distance = (x, y, c) => Math.hypot(x - c[0], y - c[1]);
      assert.ok(Math.abs(distance(x1, y1, a) - a[2]) < 0.0001);
      assert.ok(Math.abs(distance(x2, y2, b) - b[2]) < 0.0001);
      // A straight connector must stay outside every hollow node, not just
      // have plausible endpoints. Project each center onto the segment.
      const dx = x2 - x1,
        dy = y2 - y1;
      for (const c of circles) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((c[0] - x1) * dx + (c[1] - y1) * dy) / (dx * dx + dy * dy),
          ),
        );
        assert.ok(distance(x1 + t * dx, y1 + t * dy, c) >= c[2] - 0.0001);
      }
    });
  });
}
