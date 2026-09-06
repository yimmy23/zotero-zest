import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import type { Simulation } from "d3-force";
import type { ZEdge, ZGraphData, ZNode, ZNodeKind } from "./build";
import { setTimeout, clearTimeout } from "../utils/timers";
import { componentTargets, fitGraphBounds } from "./layout";
import { LABEL_HEIGHT, placeLabels } from "./labels";

/**
 * SVG renderer for the Zest graph view. Pure rendering: takes ZGraphData,
 * lays it out with d3-force, and reports interactions through handlers.
 * No network access, no imports from core/ or ui/.
 *
 * Ported from references-plugin/src/graph/view.ts. The main differences
 * from the source are the data model (ZNode carries its own label/weight
 * instead of an embedded RefItem) and theme handling — colours come from
 * Zotero CSS custom properties instead of hardcoded hex values.
 */

export interface GraphHandlers {
  /** single click on a node (screen coords let the host anchor a menu) */
  onSelect?: (node: ZNode, screenX?: number, screenY?: number) => void;
  /** double click on a node */
  onOpen?: (node: ZNode) => void;
  /** right click on a node (screen coords for a context menu) */
  onContext?: (node: ZNode, screenX: number, screenY: number) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function edgeEndpointIds(edge: ZEdge): [string, string] {
  const a = typeof edge.source === "string" ? edge.source : edge.source.id;
  const b = typeof edge.target === "string" ? edge.target : edge.target.id;
  return [a, b];
}

/**
 * Stroke width of an edge. Every edge the builders emit today carries
 * weight 1 (item→category links and pairwise relations alike), so this is a
 * constant — kept as a function so a future weighted projection changes one
 * place instead of four call sites.
 */
function edgeWidth(_edge: ZEdge): string {
  return "1.4";
}

interface ComponentInfo {
  /** number of connected components */
  count: number;
  /** node id → component index; 0 is the largest component */
  compOf: Map<string, number>;
  sizes: number[];
}

/** connected components — they drive the pull, the grid, and the palette */
function componentInfo(nodes: ZNode[], edges: ZEdge[]): ComponentInfo {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(a) !== root) {
      const next = parent.get(a)!;
      parent.set(a, root);
      a = next;
    }
    return root;
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    const [a, b] = edgeEndpointIds(e);
    if (!parent.has(a) || !parent.has(b)) continue;
    parent.set(find(a), find(b));
  }
  const bySize = new Map<string, number>();
  for (const n of nodes) {
    const r = find(n.id);
    bySize.set(r, (bySize.get(r) || 0) + 1);
  }
  const order = [...bySize.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([root]) => root);
  const idx = new Map(order.map((root, i) => [root, i] as const));
  const compOf = new Map<string, number>();
  for (const n of nodes) compOf.set(n.id, idx.get(find(n.id)) ?? 0);
  return {
    count: order.length,
    compOf,
    sizes: order.map((id) => bySize.get(id)!),
  };
}

interface GraphTheme {
  center: string;
  item: string;
  author: string;
  tag: string;
  collection: string;
  edge: string;
  label: string;
  background: string;
}

function kindColor(theme: GraphTheme, kind: ZNodeKind): string {
  switch (kind) {
    case "center":
      return theme.center;
    case "item":
      return theme.item;
    case "author":
      return theme.author;
    case "tag":
      return theme.tag;
    case "collection":
      return theme.collection;
  }
}

/**
 * Gephi-style categorical palette for colouring by connected component
 * (Tableau hues — mid-saturation, readable on light and dark canvases).
 * Assigned by component size, cycling past twelve.
 */
const COMPONENT_PALETTE = [
  "#4e79a7",
  "#59a14f",
  "#e15759",
  "#f28e2b",
  "#76b7b2",
  "#b07aa1",
  "#edc949",
  "#ff9da7",
  "#9c755f",
  "#86bcb6",
  "#d37295",
  "#a0cbe8",
];

/**
 * Layout budget. The first WARMUP_TICKS run synchronously before the first
 * paint (a few ms for 50 nodes) so nodes start near their final positions;
 * only the tail is animated. Animating from a random cloud meant ~1s of
 * heavy motion competing with the other sections' rendering — visibly
 * janky. Now the visible motion is a short settle.
 */
const WARMUP_TICKS = 110;
const SETTLE_TICKS = 50;
/** simulation steps per animation frame */
const TICKS_PER_FRAME = 2;
/** stop animating once the largest per-tick displacement drops below this */
const MOTION_EPS = 0.08;
/** label budget scales with canvas width (center always labeled) */
const LABEL_MIN = 4;
const LABEL_MAX = 12;
const PX_PER_LABEL = 45;
const MAX_SCALE = 5;
/** pointer movement (px) below which a press counts as a click */
const CLICK_SLOP = 3;

function nodeRadius(n: ZNode): number {
  // log10 with a hard floor/cap: a heavily-linked node must not dwarf the
  // canvas, and an unlinked one must still be visible.
  const r = 4 + 2.2 * Math.log10(1 + Math.max(0, n.weight));
  const clamped = Math.min(14, Math.max(4, r));
  return n.kind === "center" ? clamped + 4 : clamped;
}

export class GraphView {
  private container: HTMLElement;
  private handlers: GraphHandlers;
  private doc: Document;
  private win: Window;

  private svg: SVGSVGElement;
  /** pan/zoom transform root; children: edge, node, label layers */
  private root: SVGGElement;
  private edgeLayer: SVGGElement;
  private nodeLayer: SVGGElement;
  private labelLayer: SVGGElement;

  private data: ZGraphData | null = null;
  private sim: Simulation<ZNode, ZEdge> | null = null;
  private nodeEls = new Map<string, SVGCircleElement>();
  private labelEls = new Map<string, SVGTextElement>();
  private edgeEls: Array<{ el: SVGPathElement; edge: ZEdge }> = [];
  /** node id → ids of its direct neighbours (for hover focus) */
  private adj = new Map<string, Set<string>>();

  private width = 300;
  private height = 300;
  private panX = 0;
  private panY = 0;
  private scale = 1;
  private fitScale = 1;
  /** Only automatic framing may follow settling/resizes; gestures own the camera. */
  private autoFit = true;

  private rafId = 0;
  private tickBudget = 0;

  private resizeObs: ResizeObserver | null = null;
  private darkQuery: MediaQueryList | null = null;
  private onThemeChange = () => this.applyTheme();
  private theme: GraphTheme;
  /** node id → connected-component index (0 = largest), set by setData */
  private compOf = new Map<string, number>();
  private compCount = 1;
  private labelOrder: ZNode[] = [];
  private labelWidths = new Map<string, number>();
  private visibleLabels = new Set<string>();
  private labelFontSize = 11;
  private labelHeight = LABEL_HEIGHT;
  /** caption ranks visible at scale 1; zooming in raises the budget */
  private labelBase = LABEL_MIN;
  /** hovered node while a neighbourhood focus is dimming the rest */
  private focusedId: string | null = null;
  private selectedId: string | null = null;
  /** One tab stop for the canvas; arrow keys move between nodes. */
  private tabStopId: string | null = null;
  /** hover-intent timer: focus only after a short dwell, not on fly-over */
  private hoverTimer = 0;

  constructor(container: HTMLElement, handlers: GraphHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.doc = container.ownerDocument as Document;
    this.win = this.doc.defaultView as Window;

    this.svg = this.createSVG<SVGSVGElement>("svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    this.svg.setAttribute("role", "group");
    for (const name of ["aria-labelledby", "aria-describedby"]) {
      const value = container.getAttribute(name);
      if (value) this.svg.setAttribute(name, value);
    }
    this.svg.style.display = "block";
    this.svg.style.cursor = "grab";
    this.root = this.createG(this.svg);
    this.edgeLayer = this.createG(this.root);
    this.nodeLayer = this.createG(this.root);
    this.labelLayer = this.createG(this.root);
    container.appendChild(this.svg);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.width = rect.width;
      this.height = rect.height;
    }
    this.updateViewBox();
    this.applyTransform();

    // keep the viewBox matching the container size
    const RO = (this.win as any)?.ResizeObserver;
    if (RO) {
      const obs = new RO(() => this.handleResize()) as ResizeObserver;
      obs.observe(container);
      this.resizeObs = obs;
    }

    try {
      const mq = this.win.matchMedia("(prefers-color-scheme: dark)");
      if (mq) {
        mq.addEventListener("change", this.onThemeChange);
        this.darkQuery = mq;
      }
    } catch {
      this.darkQuery = null;
    }

    this.theme = this.readTheme();

    this.svg.addEventListener("wheel", this.onWheel, { passive: false });
    this.svg.addEventListener("pointerdown", this.onBackgroundDown);
  }

  setData(data: ZGraphData | null): void {
    this.clearScene();
    if (!data?.nodes.length) return;
    this.data = data;
    this.autoFit = true;
    this.scale = this.fitScale = 1;
    this.panX = this.panY = 0;

    const centerNodes = data.nodes.filter((n) => n.kind === "center");
    this.tabStopId = centerNodes[0]?.id || data.nodes[0].id;

    // connected components drive the palette, the pull, and the grid
    const comps = componentInfo(data.nodes, data.edges);
    this.compOf = comps.compOf;
    this.compCount = comps.count;
    const targets = componentTargets(comps.sizes, this.width, this.height);
    const cellOf = (n: ZNode) => targets[this.compOf.get(n.id) ?? 0];
    for (const c of centerNodes) {
      c.fx = cellOf(c).x;
      c.fy = cellOf(c).y;
    }

    this.adj.clear();
    const addAdj = (a: string, b: string) => {
      if (!this.adj.has(a)) this.adj.set(a, new Set());
      this.adj.get(a)!.add(b);
    };
    for (const edge of data.edges) {
      // a gentle arc instead of a straight line (see updatePositions)
      const el = this.createSVG<SVGPathElement>("path");
      el.setAttribute("fill", "none");
      el.setAttribute("stroke-linecap", "round");
      el.style.pointerEvents = "none";
      el.style.transition = "opacity 0.15s";
      this.edgeLayer.appendChild(el);
      this.edgeEls.push({ el, edge });
      const [a, b] = edgeEndpointIds(edge);
      addAdj(a, b);
      addAdj(b, a);
    }

    for (const node of data.nodes) {
      const c = this.createSVG<SVGCircleElement>("circle");
      c.setAttribute("class", "zest-graph-node");
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", node.id === this.tabStopId ? "0" : "-1");
      c.setAttribute("aria-pressed", "false");
      c.setAttribute("r", String(nodeRadius(node)));
      c.style.cursor = "pointer";
      c.style.transition = "opacity 0.15s";
      // native tooltip: items show their full title, authors show name +
      // institution (small nodes have no caption until you zoom in)
      const tip =
        node.kind === "author"
          ? [node.label, node.hint].filter(Boolean).join("\n")
          : node.title || node.label;
      c.setAttribute("aria-label", tip || node.label);
      if (tip) {
        const tt = this.createSVG<SVGElement>("title");
        tt.textContent = tip;
        c.appendChild(tt);
      }
      this.attachNodeEvents(c, node);
      this.nodeLayer.appendChild(c);
      this.nodeEls.set(node.id, c);
    }

    // Full captions stay available through native node tooltips. Visible
    // captions are measured once, then placed without collisions in screen
    // space; they must never inflate the simulation's collision circles.
    this.labelBase = Math.max(
      LABEL_MIN,
      Math.min(LABEL_MAX, Math.round(this.width / PX_PER_LABEL)),
    );
    const ranked = data.nodes
      .filter((n) => n.kind !== "center")
      .sort((a, b) => nodeRadius(b) - nodeRadius(a));
    this.labelOrder = [...centerNodes, ...ranked];
    for (const node of data.nodes) {
      const t = this.createSVG<SVGTextElement>("text");
      t.setAttribute("class", "zest-graph-label");
      t.setAttribute("aria-hidden", "true");
      t.textContent = node.label;
      t.setAttribute("text-anchor", "start");
      t.setAttribute("font-size", "10.5");
      t.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke-width", "2.5");
      t.setAttribute("stroke-linejoin", "round");
      t.style.pointerEvents = "none";
      t.style.opacity = "0";
      this.labelLayer.appendChild(t);
      this.labelEls.set(node.id, t);
    }
    this.measureLabels();

    this.applyTheme();

    // Simulate in model space, never against a hard viewport wall. Larger
    // components receive more space; the camera fits the resulting bounds.
    const multiple = this.compCount > 1;
    const reach = Math.max(160, Math.min(this.width, this.height) / 2.5);
    this.sim = forceSimulation<ZNode>(data.nodes)
      .force(
        "link",
        forceLink<ZNode, ZEdge>(data.edges)
          .id((n) => n.id)
          .distance(70)
          .strength(0.3),
      )
      .force("charge", forceManyBody<ZNode>().strength(-120).distanceMax(reach))
      .force("center", multiple ? null : forceCenter<ZNode>(0, 0))
      .force(
        "collide",
        forceCollide<ZNode>((n) => nodeRadius(n) + 5).strength(0.9),
      )
      .force(
        "x",
        forceX<ZNode>((n) => cellOf(n).x).strength(multiple ? 0.09 : 0.03),
      )
      .force(
        "y",
        forceY<ZNode>((n) => cellOf(n).y).strength(multiple ? 0.09 : 0.03),
      )
      .stop();

    // off-screen warm-up: converge most of the way before the first paint
    for (let i = 0; i < WARMUP_TICKS; i++) this.sim.tick();
    this.updatePositions();
    this.fitView();
    this.runTicks(SETTLE_TICKS);
  }

  resize(): void {
    this.handleResize();
  }

  /** Reframe the whole model without changing a node, an edge or the simulation. */
  fitView(): void {
    const nodes = this.data?.nodes;
    if (!nodes?.length) return;
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    for (const node of nodes) {
      const r = nodeRadius(node) + 3;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      bounds.minX = Math.min(bounds.minX, x - r);
      bounds.maxX = Math.max(bounds.maxX, x + r);
      bounds.minY = Math.min(bounds.minY, y - r);
      bounds.maxY = Math.max(bounds.maxY, y + r);
    }
    const camera = fitGraphBounds(bounds, this.width, this.height);
    this.scale = this.fitScale = camera.scale;
    this.panX = camera.panX;
    this.panY = camera.panY;
    this.autoFit = true;
    this.applyTransform();
  }

  destroy(): void {
    this.clearScene();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    try {
      this.darkQuery?.removeEventListener("change", this.onThemeChange);
    } catch {
      // ignore: view may already be torn down
    }
    this.darkQuery = null;
    this.svg.removeEventListener("wheel", this.onWheel);
    this.svg.removeEventListener("pointerdown", this.onBackgroundDown);
    this.svg.remove();
  }

  // ------------------------------------------------------------------ scene

  /**
   * Create an SVG element in the container's document. Unconstrained
   * generic: the Gecko typings' SVG element interfaces are structurally
   * incompatible with their own Element (className shape), so a
   * `T extends Element` constraint would not compile.
   */
  private createSVG<T>(tag: string): T {
    return this.doc.createElementNS(SVG_NS, tag) as unknown as T;
  }

  private createG(parent: SVGElement): SVGGElement {
    const g = this.createSVG<SVGGElement>("g");
    parent.appendChild(g);
    return g;
  }

  private clearScene() {
    // a pending hover focus must not fire against the next scene: the stale
    // node's neighbourhood matches nothing and the whole graph stays dimmed
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = 0;
    }
    this.stopSim();
    this.edgeLayer.textContent = "";
    this.nodeLayer.textContent = "";
    this.labelLayer.textContent = "";
    this.nodeEls.clear();
    this.labelEls.clear();
    this.edgeEls = [];
    this.labelOrder = [];
    this.labelWidths.clear();
    this.visibleLabels.clear();
    this.adj.clear();
    this.compOf.clear();
    this.compCount = 1;
    this.focusedId = null;
    this.selectedId = null;
    this.tabStopId = null;
    this.data = null;
  }

  private handleResize() {
    try {
      const r = this.container.getBoundingClientRect();
      if (
        r.width > 0 &&
        r.height > 0 &&
        (r.width !== this.width || r.height !== this.height)
      ) {
        this.width = r.width;
        this.height = r.height;
        this.labelBase = Math.max(
          LABEL_MIN,
          Math.min(LABEL_MAX, Math.round(this.width / PX_PER_LABEL)),
        );
        this.updateViewBox();
        this.measureLabels();
        if (this.autoFit && this.data?.nodes.length) this.fitView();
        else this.applyTransform();
      }
    } catch {
      // ignore: container may already be detached
    }
  }

  private updateViewBox() {
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
  }

  private applyTransform() {
    // simulation space is centered at (0,0); base translate moves it to
    // the middle of the viewport, pan/zoom on top
    const tx = this.width / 2 + this.panX;
    const ty = this.height / 2 + this.panY;
    this.root.setAttribute(
      "transform",
      `translate(${tx},${ty}) scale(${this.scale})`,
    );
    this.updateLabelVisibility();
  }

  /** Text metrics are cached between graph/font/viewport changes, never read per tick. */
  private measureLabels() {
    this.labelFontSize =
      (parseFloat(this.win.getComputedStyle(this.container)?.fontSize || "") ||
        13) * 0.846;
    this.labelHeight = Math.max(
      LABEL_HEIGHT,
      Math.ceil(this.labelFontSize * 1.5),
    );
    const maxWidth = Math.max(1, Math.min(180, this.width - 8));
    for (const node of this.labelOrder) {
      const t = this.labelEls.get(node.id)!;
      t.style.fontSize = `${this.labelFontSize}px`;
      const chars = Array.from(node.label);
      const widthOf = () => {
        try {
          const width = t.getComputedTextLength();
          if (width > 0) return width;
        } catch {
          /* detached SVG or test DOM */
        }
        return Array.from(t.textContent || "").reduce(
          (sum, c) =>
            sum +
            (c.charCodeAt(0) > 255
              ? this.labelFontSize
              : this.labelFontSize * 0.58),
          0,
        );
      };
      t.textContent = node.label;
      let width = widthOf();
      if (width > maxWidth) {
        let end = Math.max(
          0,
          Math.floor((chars.length * maxWidth) / width) - 1,
        );
        do {
          t.textContent = `${chars.slice(0, end).join("")}…`;
          width = widthOf();
          end--;
        } while (width > maxWidth && end >= 0);
      }
      this.labelWidths.set(node.id, width);
    }
  }

  /** Keep only collision-free, on-screen captions. Zoom reveals more; a hub
   * hover must not force hundreds of overlapping neighbour captions on. */
  private updateLabelVisibility() {
    if (!this.data?.nodes.length) return;
    const budget = Math.min(
      40,
      Math.max(
        4,
        Math.round(this.labelBase * Math.pow(this.scale / this.fitScale, 0.8)),
      ),
    );
    const forceId = this.focusedId || this.selectedId || this.labelOrder[0]?.id;
    const neighbors = this.focusedId ? this.adj.get(this.focusedId) : null;
    const candidates = this.labelOrder.filter(
      (n) => !this.focusedId || n.id === this.focusedId || neighbors?.has(n.id),
    );
    const forced = candidates.find((n) => n.id === forceId);
    const ordered = forced
      ? [forced, ...candidates.filter((n) => n !== forced)]
      : candidates;
    const tx = this.width / 2 + this.panX;
    const ty = this.height / 2 + this.panY;
    const screenNode = (n: ZNode) => ({
      id: n.id,
      x: tx + (n.x ?? 0) * this.scale,
      y: ty + (n.y ?? 0) * this.scale,
      radius: nodeRadius(n) * this.scale,
      width: this.labelWidths.get(n.id) || 0,
    });
    const placed = placeLabels(
      ordered
        .map(screenNode)
        .filter(
          (n) =>
            n.x + n.radius > 0 &&
            n.y + n.radius > 0 &&
            n.x - n.radius < this.width &&
            n.y - n.radius < this.height,
        )
        .slice(0, budget * 6),
      this.data.nodes.map(screenNode),
      { width: this.width, height: this.height },
      budget,
      forceId,
      this.labelHeight,
    );
    for (const id of this.visibleLabels) {
      if (!placed.has(id)) this.labelEls.get(id)!.style.opacity = "0";
    }
    for (const [id, position] of placed) {
      const t = this.labelEls.get(id)!;
      t.style.opacity = "1";
      t.style.fontSize = `${this.labelFontSize / this.scale}px`;
      t.setAttribute("stroke-width", String(2.5 / this.scale));
      t.setAttribute("x", String((position.x - tx) / this.scale));
      t.setAttribute(
        "y",
        String((position.y + this.labelHeight * 0.8 - ty) / this.scale),
      );
    }
    this.visibleLabels = new Set(placed.keys());
  }

  /** client (screen) coordinates -> simulation coordinates */
  private toLocal(clientX: number, clientY: number) {
    const r = this.svg.getBoundingClientRect();
    const sx = r.width > 0 ? ((clientX - r.left) / r.width) * this.width : 0;
    const sy = r.height > 0 ? ((clientY - r.top) / r.height) * this.height : 0;
    return {
      x: (sx - this.width / 2 - this.panX) / this.scale,
      y: (sy - this.height / 2 - this.panY) / this.scale,
    };
  }

  // ------------------------------------------------------------- simulation

  /**
   * Step the simulation from a requestAnimationFrame loop, a few ticks per
   * frame, updating DOM positions each frame, until the budget runs out or
   * the simulation cools below alphaMin.
   */
  private runTicks(budget: number) {
    this.tickBudget = Math.max(this.tickBudget, budget);
    if (this.rafId) return; // loop already running
    const step = () => {
      this.rafId = 0;
      const sim = this.sim;
      if (!sim) return;
      let ticked = 0;
      let maxMove = 0;
      while (ticked < TICKS_PER_FRAME && this.tickBudget > 0) {
        if (sim.alpha() < sim.alphaMin() && sim.alphaTarget() === 0) {
          this.tickBudget = 0;
          break;
        }
        sim.tick();
        ticked++;
        this.tickBudget--;
        for (const n of this.data?.nodes || []) {
          const m = Math.abs(n.vx || 0) + Math.abs(n.vy || 0);
          if (m > maxMove) maxMove = m;
        }
      }
      if (ticked) {
        this.updatePositions();
        // nothing visibly moving any more (and no drag holding alpha up):
        // stop early instead of burning frames on sub-pixel drift
        if (maxMove < MOTION_EPS && sim.alphaTarget() === 0) {
          this.tickBudget = 0;
        }
      }
      if (this.tickBudget > 0) {
        this.rafId = this.win.requestAnimationFrame(step);
      } else if (this.autoFit) this.fitView();
    };
    this.rafId = this.win.requestAnimationFrame(step);
  }

  private stopSim() {
    if (this.rafId) {
      this.win.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.tickBudget = 0;
    this.sim?.stop();
    this.sim = null;
  }

  private updatePositions() {
    for (const { el, edge } of this.edgeEls) {
      // after simulation init, forceLink resolved ids to node objects
      const s = edge.source as ZNode;
      const t = edge.target as ZNode;
      if (typeof s !== "object" || typeof t !== "object") continue;
      const x1 = s.x ?? 0;
      const y1 = s.y ?? 0;
      const x2 = t.x ?? 0;
      const y2 = t.y ?? 0;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      // constant-ratio bow, capped so long edges don't balloon
      const off = Math.min(18, len * 0.14);
      const mx = (x1 + x2) / 2 + (dy / len) * off;
      const my = (y1 + y2) / 2 - (dx / len) * off;
      el.setAttribute("d", `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
    }
    for (const node of this.data?.nodes || []) {
      const c = this.nodeEls.get(node.id);
      if (c) {
        c.setAttribute("cx", String(node.x ?? 0));
        c.setAttribute("cy", String(node.y ?? 0));
      }
    }
    this.updateLabelVisibility();
  }

  // ------------------------------------------------------------------ theme

  /**
   * Read the live Zotero CSS custom properties off the container's
   * computed style, with sane fallbacks (dark-aware where it matters) for
   * contexts where the variables aren't defined.
   */
  /** mix a #rrggbb toward black; `f` is how much of the colour survives */
  private static darkenHex(hex: string, f: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
      Math.max(0, Math.min(255, Math.round(v * f))),
    );
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  /** true when the canvas background is dark, whatever produced it */
  private static isDark(color: string, fallback: boolean): boolean {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
    let rgb: number[] | null = m
      ? [Number(m[1]), Number(m[2]), Number(m[3])]
      : null;
    if (!rgb) {
      const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
      if (hex) {
        const n = parseInt(hex[1], 16);
        rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
    }
    if (!rgb) return fallback;
    const lin = rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return L < 0.35;
  }

  private readTheme(): GraphTheme {
    const dark = !!this.darkQuery?.matches;
    let style: CSSStyleDeclaration | null;
    try {
      style = this.win.getComputedStyle(this.container);
    } catch {
      style = null;
    }
    const darken = (hex: string, f: number) => GraphView.darkenHex(hex, f);
    const read = (name: string, fallback: string): string => {
      try {
        const v = style?.getPropertyValue(name).trim();
        return v ? v : fallback;
      } catch {
        return fallback;
      }
    };
    const background = read("--color-background", dark ? "#1e1e1e" : "#ffffff");
    const darkBackground = GraphView.isDark(background, dark);
    return {
      // items follow the user's accent (the focus node one step deeper), and
      // the other kinds take fixed hues so a node's KIND is readable at a
      // glance rather than looking like a different rank of the same thing
      // --zest-accent-strong is a color-mix() expression, which canvas cannot
      // be trusted to parse, so the deeper step is computed here instead
      center: darken(read("--zest-accent", "#40c463"), 0.68),
      item: read("--zest-accent", "#40c463"),
      author: read("--accent-teal", "#59adc4"),
      tag: read("--accent-wood", "#cc7a52"),
      collection: read("--fill-secondary", "#6b7280"),
      // Edges used to take --fill-quinary (barely-there alpha) and were then
      // drawn at stroke-opacity .3 — in the dark theme that is ~2% white on a
      // near-black canvas, i.e. invisible. Derive them from the ACTUAL canvas
      // background instead, so they hold up in both themes whatever Zotero's
      // fill variables happen to be.
      edge: darkBackground ? "rgba(255,255,255,.38)" : "rgba(0,0,0,.24)",
      label: read("--fill-primary", dark ? "#e6e6e6" : "#111827"),
      background,
    };
  }

  private applyTheme() {
    const theme = this.readTheme();
    this.theme = theme;
    for (const t of this.labelEls.values()) {
      t.setAttribute("fill", theme.label);
      t.setAttribute("stroke", theme.background);
    }
    for (const { el, edge } of this.edgeEls) {
      el.setAttribute("stroke", theme.edge);
      el.setAttribute("stroke-width", edgeWidth(edge));
      // the colour already carries its alpha; dimming it again is what made
      // the lines disappear
      el.setAttribute("stroke-opacity", "1");
    }
    for (const node of this.data?.nodes || []) {
      const c = this.nodeEls.get(node.id);
      if (c) {
        const color = this.nodeColor(node);
        c.setAttribute("fill", color);
        // a soft halo in the node's own colour instead of a hard rim
        c.setAttribute("stroke", color);
        c.setAttribute(
          "stroke-opacity",
          node.kind === "center" ? "0.35" : "0.25",
        );
        c.setAttribute("stroke-width", node.kind === "center" ? "5" : "3.5");
      }
    }
  }

  /**
   * One connected graph keeps the kind colours (item/author/tag…); a graph
   * that falls apart is coloured by component instead — Gephi's rule of
   * letting structure own the palette. The centre node keeps its accent.
   */
  private nodeColor(node: ZNode): string {
    if (node.kind === "center") return this.theme.center;
    if (this.compCount > 1) {
      const comp = this.compOf.get(node.id);
      if (comp !== undefined) {
        return COMPONENT_PALETTE[comp % COMPONENT_PALETTE.length];
      }
    }
    return kindColor(this.theme, node.kind);
  }

  // ----------------------------------------------------------- interactions

  private onWheel = (ev: WheelEvent) => {
    // plain wheel scrolls the item pane; only Ctrl/Cmd+wheel (and trackpad
    // pinch, which Firefox reports as ctrlKey wheel) zooms the graph
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const k = Math.min(
      MAX_SCALE,
      Math.max(Math.min(0.2, this.fitScale * 0.5), this.scale * factor),
    );
    if (k === this.scale) return;
    this.autoFit = false;
    // zoom anchored at the cursor: keep the point under it fixed
    const r = this.svg.getBoundingClientRect();
    const sx = r.width > 0 ? ((ev.clientX - r.left) / r.width) * this.width : 0;
    const sy =
      r.height > 0 ? ((ev.clientY - r.top) / r.height) * this.height : 0;
    const lx = (sx - this.width / 2 - this.panX) / this.scale;
    const ly = (sy - this.height / 2 - this.panY) / this.scale;
    this.scale = k;
    this.panX = sx - this.width / 2 - k * lx;
    this.panY = sy - this.height / 2 - k * ly;
    this.applyTransform();
  };

  /** background drag = pan (node circles stop propagation) */
  private onBackgroundDown = (ev: PointerEvent) => {
    if (ev.target !== this.svg) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startPanX = this.panX;
    const startPanY = this.panY;
    const rect = this.svg.getBoundingClientRect();
    const kx = rect.width > 0 ? this.width / rect.width : 1;
    const ky = rect.height > 0 ? this.height / rect.height : 1;
    this.svg.style.cursor = "grabbing";
    const move = (e: PointerEvent) => {
      this.autoFit = false;
      this.panX = startPanX + (e.clientX - startX) * kx;
      this.panY = startPanY + (e.clientY - startY) * ky;
      this.applyTransform();
    };
    const up = () => {
      this.svg.style.cursor = "grab";
      this.svg.removeEventListener("pointermove", move);
      this.svg.removeEventListener("pointerup", up);
      this.svg.removeEventListener("pointercancel", up);
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore: view may already be torn down
      }
    };
    try {
      this.svg.setPointerCapture(ev.pointerId);
    } catch {
      // ignore: view may already be torn down
    }
    this.svg.addEventListener("pointermove", move);
    this.svg.addEventListener("pointerup", up);
    this.svg.addEventListener("pointercancel", up);
  };

  private attachNodeEvents(circle: SVGCircleElement, node: ZNode) {
    // true when the last press turned into a drag; suppresses the click
    let dragOccurred = false;

    circle.addEventListener("focus", () => {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = 0;
      }
      this.moveTabStop(node.id);
      this.focusNeighborhood(node);
    });
    circle.addEventListener("blur", () => {
      if (this.focusedId === node.id) this.clearFocus();
    });
    circle.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (
        [
          "ArrowLeft",
          "ArrowUp",
          "ArrowRight",
          "ArrowDown",
          "Home",
          "End",
        ].includes(ev.key)
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        const ids = [...this.nodeEls.keys()];
        const current = ids.indexOf(node.id);
        const delta = ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 1;
        const index =
          ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? ids.length - 1
              : (current + delta + ids.length) % ids.length;
        (this.nodeEls.get(ids[index]) as unknown as HTMLElement)?.focus({
          preventScroll: true,
        });
      } else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        this.select(node);
        const rect = circle.getBoundingClientRect();
        try {
          this.handlers.onSelect?.(
            node,
            this.win.screenX + rect.left + rect.width / 2,
            this.win.screenY + rect.top + rect.height / 2,
          );
        } catch (e) {
          ztoolkit.log("[graph] keyboard select failed", e);
        }
      }
    });

    circle.addEventListener("pointerdown", (ev: PointerEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      dragOccurred = false;
      // raise above overlapping siblings while pressed / dragged
      if ((this.nodeLayer.lastElementChild as unknown) !== circle) {
        this.nodeLayer.appendChild(circle);
      }
      const startX = ev.clientX;
      const startY = ev.clientY;
      let dragging = false;
      const move = (e: PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(e.clientX - startX, e.clientY - startY) < CLICK_SLOP
        ) {
          return;
        }
        if (!dragging) {
          dragging = true;
          this.autoFit = false;
          this.sim?.alphaTarget(0.3);
        }
        const p = this.toLocal(e.clientX, e.clientY);
        node.fx = p.x;
        node.fy = p.y;
        this.runTicks(60);
      };
      const up = () => {
        circle.removeEventListener("pointermove", move);
        circle.removeEventListener("pointerup", up);
        circle.removeEventListener("pointercancel", up);
        try {
          circle.releasePointerCapture(ev.pointerId);
        } catch {
          // ignore: view may already be torn down
        }
        dragOccurred = dragging;
        if (dragging) {
          this.sim?.alphaTarget(0);
          // the center node stays pinned wherever it was dropped
          if (node.kind !== "center") {
            node.fx = null;
            node.fy = null;
          }
          this.runTicks(90);
        }
      };
      try {
        circle.setPointerCapture(ev.pointerId);
      } catch {
        // ignore: view may already be torn down
      }
      circle.addEventListener("pointermove", move);
      circle.addEventListener("pointerup", up);
      circle.addEventListener("pointercancel", up);
    });

    circle.addEventListener("click", (ev: MouseEvent) => {
      ev.stopPropagation();
      if (dragOccurred) return;
      this.select(node);
      try {
        this.handlers.onSelect?.(node, ev.screenX, ev.screenY);
      } catch (e) {
        try {
          ztoolkit.log("[graph] onSelect handler failed", e);
        } catch {
          // ignore
        }
      }
    });

    circle.addEventListener("dblclick", (ev: MouseEvent) => {
      ev.stopPropagation();
      try {
        this.handlers.onOpen?.(node);
      } catch (e) {
        try {
          ztoolkit.log("[graph] onOpen handler failed", e);
        } catch {
          // ignore
        }
      }
    });

    circle.addEventListener("contextmenu", (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      try {
        this.handlers.onContext?.(node, ev.screenX, ev.screenY);
      } catch (e) {
        try {
          ztoolkit.log("[graph] onContext handler failed", e);
        } catch {
          // ignore
        }
      }
    });

    circle.addEventListener("pointerenter", () => {
      // NEVER move the element in the DOM here: re-inserting the node
      // under the pointer fires pointerleave/pointerenter again and the
      // cursor flips grab ↔ pointer in a loop (visible as a flickering
      // hand). Dim everything outside the neighbourhood instead — and only
      // after a short dwell: sweeping the cursor across a dense graph must
      // not rewrite every element's opacity at each node it crosses.
      if (this.hoverTimer) clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = 0;
        this.focusNeighborhood(node);
      }, 120) as unknown as number;
    });

    circle.addEventListener("pointerleave", () => {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = 0;
      }
      if (this.focusedId && (this.doc.activeElement as unknown) !== circle)
        this.clearFocus();
    });
  }

  private moveTabStop(id: string) {
    if (this.tabStopId === id) return;
    if (this.tabStopId)
      this.nodeEls.get(this.tabStopId)?.setAttribute("tabindex", "-1");
    this.nodeEls.get(id)?.setAttribute("tabindex", "0");
    this.tabStopId = id;
  }

  private select(node: ZNode) {
    if (this.selectedId) {
      const previous = this.nodeEls.get(this.selectedId);
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-pressed", "false");
    }
    const circle = this.nodeEls.get(node.id);
    circle?.classList.add("is-selected");
    circle?.setAttribute("aria-pressed", "true");
    this.selectedId = node.id;
    this.moveTabStop(node.id);
    this.updateLabelVisibility();
  }

  /** hover: keep the node and its direct neighbours crisp, fade the rest */
  private focusNeighborhood(node: ZNode) {
    this.focusedId = node.id;
    const keep = new Set([node.id, ...(this.adj.get(node.id) || [])]);
    for (const [id, c] of this.nodeEls) {
      c.style.opacity = keep.has(id) ? "1" : "0.15";
    }
    this.updateLabelVisibility();
    for (const { el, edge } of this.edgeEls) {
      const [a, b] = edgeEndpointIds(edge);
      const on = a === node.id || b === node.id;
      el.style.opacity = on ? "1" : "0.08";
      el.setAttribute(
        "stroke-width",
        on ? String(Number(edgeWidth(edge)) + 0.6) : edgeWidth(edge),
      );
    }
  }

  private clearFocus() {
    this.focusedId = null;
    for (const c of this.nodeEls.values()) c.style.opacity = "";
    for (const { el, edge } of this.edgeEls) {
      el.style.opacity = "";
      el.setAttribute("stroke-width", edgeWidth(edge));
    }
    this.updateLabelVisibility();
  }
}
