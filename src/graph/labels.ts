/** Screen-space labels stay readable without moving the graph's nodes. */
export interface LabelNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  width: number;
}

export const LABEL_HEIGHT = 14;
const LABEL_GAP = 3;
const NODE_GAP = 2;
const VIEWPORT_PADDING = 4;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/**
 * Candidates are priority-ordered; an explicitly focused node goes first.
 * Positions and widths use CSS pixels after the graph's pan/zoom transform.
 * The caller truncates text to min(node.width, viewport.width - 8).
 */
export function placeLabels(
  candidates: LabelNode[],
  obstacles: Array<{ x: number; y: number; radius: number }>,
  viewport: { width: number; height: number },
  budget: number,
  forceId?: string,
  labelHeight = LABEL_HEIGHT,
): Map<string, { x: number; y: number }> {
  const placed = new Map<string, { x: number; y: number }>();
  const availableWidth = viewport.width - VIEWPORT_PADDING * 2;
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    !Number.isFinite(labelHeight) ||
    labelHeight <= 0 ||
    availableWidth <= 0 ||
    viewport.height < labelHeight + VIEWPORT_PADDING * 2 ||
    !Number.isFinite(budget) ||
    budget < 1
  ) {
    return placed;
  }
  const limit = Math.floor(budget);
  const accepted: Rect[] = [];
  const blocked = obstacles
    .filter(
      (node) =>
        Number.isFinite(node.x) &&
        Number.isFinite(node.y) &&
        Number.isFinite(node.radius) &&
        node.radius >= 0,
    )
    .map((node) => ({
      x: node.x - node.radius,
      y: node.y - node.radius,
      width: node.radius * 2,
      height: node.radius * 2,
    }));
  const forced = candidates.find((node) => node.id === forceId);
  const ordered = forced
    ? [forced, ...candidates.filter((node) => node !== forced)]
    : candidates;
  for (const node of ordered) {
    if (placed.size >= limit) break;
    if (
      placed.has(node.id) ||
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y) ||
      !Number.isFinite(node.radius) ||
      !Number.isFinite(node.width) ||
      node.radius < 0 ||
      node.width <= 0 ||
      node.x + node.radius <= 0 ||
      node.y + node.radius <= 0 ||
      node.x - node.radius >= viewport.width ||
      node.y - node.radius >= viewport.height
    ) {
      continue;
    }
    const width = Math.min(node.width, availableWidth);
    const positions = [
      { x: node.x - width / 2, y: node.y + node.radius + LABEL_GAP },
      { x: node.x + node.radius + LABEL_GAP, y: node.y - labelHeight / 2 },
      {
        x: node.x - width / 2,
        y: node.y - node.radius - LABEL_GAP - labelHeight,
      },
      {
        x: node.x - node.radius - LABEL_GAP - width,
        y: node.y - labelHeight / 2,
      },
    ];
    const fits = (position: { x: number; y: number }) => {
      const rect = { ...position, width, height: labelHeight };
      return (
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        rect.x >= VIEWPORT_PADDING &&
        rect.y >= VIEWPORT_PADDING &&
        rect.x + width <= viewport.width - VIEWPORT_PADDING &&
        rect.y + labelHeight <= viewport.height - VIEWPORT_PADDING &&
        !accepted.some((other) => overlaps(rect, other, LABEL_GAP)) &&
        !blocked.some((other) => overlaps(rect, other, NODE_GAP))
      );
    };
    let position = positions.find(fits);
    if (!position && node === forced) {
      // A focused label is more useful than hiding it in a dense cluster.
      // It is placed first, so no previously accepted label can be obscured.
      position = {
        x: Math.max(
          VIEWPORT_PADDING,
          Math.min(positions[0].x, viewport.width - VIEWPORT_PADDING - width),
        ),
        y: Math.max(
          VIEWPORT_PADDING,
          Math.min(
            positions[0].y,
            viewport.height - VIEWPORT_PADDING - labelHeight,
          ),
        ),
      };
    }
    if (position) {
      placed.set(node.id, position);
      accepted.push({ ...position, width, height: labelHeight });
    }
  }
  return placed;
}
