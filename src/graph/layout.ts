/** Geometry shared by the graph's force targets and viewport camera. */

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function viewportSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * Divide the available area by component size, rather than giving a large
 * connected graph the same cell as a pair of nodes. Recursive rectangles
 * keep small components together; stable ties retain their input order.
 * Targets use simulation coordinates, with the viewport centre at (0, 0).
 */
export function componentTargets(
  sizes: number[],
  width: number,
  height: number,
): Point[] {
  if (!sizes.length) return [];
  const w = viewportSize(width);
  const h = viewportSize(height);
  const padding = Math.min(28, Math.min(w, h) / 4);
  const entries = sizes
    .map((size, index) => ({
      index,
      weight: Number.isFinite(size) ? Math.max(4, size) : 4,
    }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  // Normalisation prevents an otherwise valid collection of large weights
  // from overflowing when summed. It does not change their area ratios.
  const largest = entries[0].weight;
  for (const entry of entries) entry.weight /= largest;
  const targets = new Array<Point>(sizes.length);

  const divide = (
    start: number,
    end: number,
    x: number,
    y: number,
    rectW: number,
    rectH: number,
  ): void => {
    if (end - start === 1) {
      targets[entries[start].index] = {
        x: x + rectW / 2,
        y: y + rectH / 2,
      };
      return;
    }
    let total = 0;
    for (let i = start; i < end; i++) total += entries[i].weight;
    let left = entries[start].weight;
    let split = start + 1;
    // Choose the contiguous split closest to half the weight. Splitting
    // along the longer axis avoids thin strips for similarly sized groups.
    while (
      split < end - 1 &&
      Math.abs(left + entries[split].weight - total / 2) <
        Math.abs(left - total / 2)
    ) {
      left += entries[split].weight;
      split++;
    }
    const ratio = left / total;
    if (rectW >= rectH) {
      const firstW = rectW * ratio;
      divide(start, split, x, y, firstW, rectH);
      divide(split, end, x + firstW, y, rectW - firstW, rectH);
    } else {
      const firstH = rectH * ratio;
      divide(start, split, x, y, rectW, firstH);
      divide(split, end, x, y + firstH, rectW, rectH - firstH);
    }
  };

  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  divide(0, entries.length, -innerW / 2, -innerH / 2, innerW, innerH);
  return targets;
}

/**
 * Fit a model-space rectangle with one uniform scale; never distort node
 * positions to keep them on screen. Callers include node radii in bounds.
 * Tiny graphs are centred without enlargement. Huge graphs may need a
 * scale below the normal interactive zoom floor to remain fully visible.
 */
export function fitGraphBounds(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 28,
): { scale: number; panX: number; panY: number } {
  const fallback = { scale: 1, panX: 0, panY: 0 };
  const { minX, minY, maxX, maxY } = bounds;
  if (
    ![minX, minY, maxX, maxY].every(Number.isFinite) ||
    maxX < minX ||
    maxY < minY
  ) {
    return fallback;
  }
  const w = viewportSize(width);
  const h = viewportSize(height);
  const margin = Math.min(
    Number.isFinite(padding) ? Math.max(0, padding) : 28,
    Math.min(w, h) / 4,
  );
  // Half-spans and half-sums also work when subtracting finite endpoints
  // directly (e.g. -1e308 and 1e308) would overflow to Infinity.
  const halfW = maxX / 2 - minX / 2;
  const halfH = maxY / 2 - minY / 2;
  const scale = Math.min(
    1,
    halfW > 0 ? (w / 2 - margin) / halfW : 1,
    halfH > 0 ? (h / 2 - margin) / halfH : 1,
  );
  const panX = -(minX / 2 + maxX / 2) * scale;
  const panY = -(minY / 2 + maxY / 2) * scale;
  return { scale, panX, panY };
}
