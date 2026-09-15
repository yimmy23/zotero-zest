/**
 * Graph data builder. Assembles a ZGraphData from a scope of Zotero items —
 * no network access, no rendering. Pure data; rendering lives in ./view.
 *
 * Ported from references-plugin/src/graph/build.ts, but the data model is
 * different: Zest's graph is built entirely from local Zotero item state
 * (relations / creators / tags / collections), not from an external
 * metadata source, so there is no "origin work" fetch step — the caller
 * hands us the item scope directly. (The author resolver additionally
 * reads the locally cached OpenAlex authorships — still no network.)
 */

import { authorResolverSteps, firstLastIndices } from "./authorIdentity";
import { runSliced, sortSteps, WorkCancelled, type WorkOptions } from "./work";
export { buildAuthorResolver } from "./authorIdentity";

export type ZNodeKind = "center" | "item" | "author" | "tag" | "collection";

export interface ZNode {
  /** stable, unique: "i:<libraryID>/<itemKey>", "a:<name>", "t:<tag>", "c:<collectionID>" */
  id: string;
  /** display label; for items "Lastname, 2024" */
  label: string;
  kind: ZNodeKind;
  /** drives radius (item: number of links; author/tag/collection: item count) */
  weight: number;
  /** set for kind "item"/"center" so the host can select/open it */
  itemID?: number;
  /** full title for the tooltip */
  title?: string;
  /** extra tooltip line (author nodes: institution from OpenAlex) */
  hint?: string;
  /** author nodes: who this is, for the author menu */
  author?: { family: string; given: string; oaId?: string };
  // layout state — mutated by d3-force in ./view
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface ZEdge {
  source: string | ZNode;
  target: string | ZNode;
  weight: number;
}

export type GraphMode = "related" | "author" | "tag" | "collection";

export interface ZGraphData {
  nodes: ZNode[];
  edges: ZEdge[];
  mode: GraphMode;
  truncated?: boolean;
  /** items that had no link in this mode and were left out (issue #2: they
   *  used to be laid out as a ring of dots around the edge of the pane) */
  isolated?: number;
}

/** category kinds produced by the bipartite modes */
type CategoryMode = "author" | "tag" | "collection";
interface Category {
  id: string;
  label: string;
  hint?: string;
  authorRef?: { family: string; given: string; oaId?: string };
}

// ------------------------------------------------------------------ public

export async function buildGraph(
  items: Zotero.Item[],
  mode: GraphMode,
  opts: WorkOptions & {
    maxNodes: number;
    centerItemID?: number;
    /** author mode: every author, or first + last by position, not correspondence */
    authorRoles?: "all" | "firstlast";
    /** bipartite modes: category must be shared by at least this many items */
    minShared?: number;
  },
): Promise<ZGraphData> {
  const empty: ZGraphData = { nodes: [], edges: [], mode, truncated: false };
  try {
    return await runSliced(build(), opts);
    function* build(): Generator<void, ZGraphData> {
      const regular: Zotero.Item[] = [];
      for (const item of items) {
        if (isRegularItemSafe(item)) regular.push(item);
        yield;
      }
      switch (mode) {
        case "related":
          return yield* buildRelatedGraph(regular, opts);
        case "author":
        case "tag":
        case "collection":
          return yield* buildBipartiteGraph(regular, mode, opts);
        default:
          return empty;
      }
    }
  } catch (e) {
    if (e instanceof WorkCancelled) return empty;
    try {
      ztoolkit.log("[graph] buildGraph failed", e);
    } catch {
      // ignore: logging itself must never throw out of buildGraph
    }
    return empty;
  }
}

// ------------------------------------------------------------- item access
// Every accessor below wraps a single Zotero call so one malformed item
// (bad field data, unloaded relation, …) degrades to an empty/blank value
// instead of aborting the whole build.

function isRegularItemSafe(item: Zotero.Item): boolean {
  try {
    return item.isRegularItem();
  } catch {
    return false;
  }
}

/** "i:<libraryID>/<itemKey>", or null when the item's own identity can't be read */
function itemNodeId(item: Zotero.Item): string | null {
  try {
    const key = item.key;
    if (!key) return null;
    return `i:${item.libraryID}/${key}`;
  } catch {
    return null;
  }
}

function itemIDOf(item: Zotero.Item): number | undefined {
  try {
    return item.id;
  } catch {
    return undefined;
  }
}

function safeTitle(item: Zotero.Item): string {
  try {
    return (item.getField("title") as string) || "";
  } catch {
    return "";
  }
}

function safeFirstCreator(item: Zotero.Item): string {
  try {
    return (item.firstCreator || "").trim();
  } catch {
    return "";
  }
}

/** first 4-digit year found in the date field, or "" */
function safeYear(item: Zotero.Item): string {
  try {
    const date = item.getField("date") as string;
    const m = typeof date === "string" ? date.match(/\d{4}/) : null;
    return m ? m[0] : "";
  } catch {
    return "";
  }
}

/** "<first creator lastname>, <year>", falling back to the title's first 18 chars */
function itemLabel(item: Zotero.Item, title: string): string {
  const label = [safeFirstCreator(item), safeYear(item)]
    .filter(Boolean)
    .join(", ");
  return label || title.slice(0, 18);
}

function itemRelatedKeys(item: Zotero.Item): string[] {
  try {
    return item.relatedItems || [];
  } catch {
    return [];
  }
}

function itemTags(item: Zotero.Item): ReturnType<Zotero.Item["getTags"]> {
  try {
    return item.getTags();
  } catch {
    return [];
  }
}

function itemCollectionIDs(item: Zotero.Item): number[] {
  try {
    return item.getCollections();
  } catch {
    return [];
  }
}

function resolveRelatedItem(
  libraryID: number,
  key: string,
): Zotero.Item | null {
  try {
    const found = Zotero.Items.getByLibraryAndKey(libraryID, key);
    return found ? found : null;
  } catch {
    return null;
  }
}

function collectionName(collectionID: number): string {
  try {
    const c = Zotero.Collections.get(collectionID);
    return c ? c.name : "";
  } catch {
    return "";
  }
}

function makeItemNode(item: Zotero.Item, id: string): ZNode {
  const title = safeTitle(item);
  return {
    id,
    label: itemLabel(item, title),
    kind: "item",
    weight: 0,
    itemID: itemIDOf(item),
    title,
  };
}

// ------------------------------------------------------------ mode: related

function* buildRelatedGraph(
  items: Zotero.Item[],
  opts: { maxNodes: number; centerItemID?: number },
): Generator<void, ZGraphData> {
  const nodes: ZNode[] = [];
  const nodeIds = new Set<string>();
  for (const item of items) {
    yield;
    const id = itemNodeId(item);
    if (!id || nodeIds.has(id)) continue;
    nodeIds.add(id);
    nodes.push(makeItemNode(item, id));
  }

  // relations are stored on both endpoints in Zotero; collapse both
  // directions into a single weight-1 edge.
  const edgeKeys = new Set<string>();
  const edges: ZEdge[] = [];
  for (const item of items) {
    yield;
    const srcId = itemNodeId(item);
    if (!srcId || !nodeIds.has(srcId)) continue;
    let libraryID: number;
    try {
      libraryID = item.libraryID;
    } catch {
      continue;
    }
    for (const key of itemRelatedKeys(item)) {
      yield;
      const related = resolveRelatedItem(libraryID, key);
      if (!related) continue;
      const tgtId = itemNodeId(related);
      if (!tgtId || tgtId === srcId || !nodeIds.has(tgtId)) continue;
      const pairKey =
        srcId < tgtId ? `${srcId}\u0000${tgtId}` : `${tgtId}\u0000${srcId}`;
      if (edgeKeys.has(pairKey)) continue;
      edgeKeys.add(pairKey);
      edges.push({ source: srcId, target: tgtId, weight: 1 });
    }
  }

  // isolated items (degree 0) end up with weight 0, which naturally sorts
  // to the back of truncateToBudget — i.e. dropped first, kept otherwise.
  yield* applyDegreeWeights(nodes, edges);
  return yield* finalizeGraph(nodes, edges, "related", opts);
}

// ----------------------------------------------------------- mode: bipartite

function* buildBipartiteGraph(
  items: Zotero.Item[],
  mode: CategoryMode,
  opts: {
    maxNodes: number;
    centerItemID?: number;
    authorRoles?: "all" | "firstlast";
    minShared?: number;
  },
): Generator<void, ZGraphData> {
  const itemNodes: ZNode[] = [];
  const itemIds = new Set<string>();
  const catNodes = new Map<string, ZNode>();
  const catMembers = new Map<string, Set<string>>();
  const rawEdges: Array<{ itemId: string; catId: string }> = [];
  // author mode resolves identities over the whole scope first (clustering
  // needs to see every name variant, not one item at a time)
  const resolver = mode === "author" ? yield* authorResolverSteps(items) : null;

  for (const item of items) {
    yield;
    const id = itemNodeId(item);
    if (!id || itemIds.has(id)) continue;
    itemIds.add(id);
    itemNodes.push(makeItemNode(item, id));

    const cats = resolver
      ? resolver.categoriesFor(
          item,
          opts.authorRoles === "firstlast" ? firstLastIndices(item) : undefined,
        )
      : categoriesFor(item, mode as Exclude<CategoryMode, "author">);
    for (const cat of cats) {
      yield;
      if (!catNodes.has(cat.id)) {
        catNodes.set(cat.id, {
          id: cat.id,
          label: cat.label,
          kind: mode,
          weight: 0,
          hint: cat.hint,
          author: cat.authorRef,
        });
      }
      let members = catMembers.get(cat.id);
      if (!members) {
        members = new Set();
        catMembers.set(cat.id, members);
      }
      if (members.has(id)) continue;
      members.add(id);
      rawEdges.push({ itemId: id, catId: cat.id });
    }
  }

  for (const [catId, members] of catMembers) {
    yield;
    const node = catNodes.get(catId);
    if (node) node.weight = members.size;
  }

  // categories shared by too few items only add noise — the threshold is
  // the user's (default 2), unless it would drop every category and leave
  // a graph with no bipartite structure at all
  const minShared = Math.max(2, opts.minShared || 2);
  let keptCatIds = new Set<string>();
  for (const node of catNodes.values()) {
    if (node.weight >= minShared) keptCatIds.add(node.id);
    yield;
  }
  if (keptCatIds.size === 0) keptCatIds = new Set(catNodes.keys());
  const edges: ZEdge[] = [];
  for (const edge of rawEdges) {
    if (keptCatIds.has(edge.catId))
      edges.push({ source: edge.itemId, target: edge.catId, weight: 1 });
    yield;
  }
  yield* applyDegreeWeights(itemNodes, edges);
  for (const node of catNodes.values()) {
    if (keptCatIds.has(node.id)) itemNodes.push(node);
    yield;
  }
  return yield* finalizeGraph(itemNodes, edges, mode, opts);
}

function categoriesFor(
  item: Zotero.Item,
  mode: Exclude<CategoryMode, "author">,
): Category[] {
  switch (mode) {
    case "tag":
      return tagCategories(item);
    case "collection":
      return collectionCategories(item);
  }
}

function tagCategories(item: Zotero.Item): Category[] {
  const out: Category[] = [];
  for (const t of itemTags(item)) {
    if (t.type === 1) continue; // automatic tag — skip
    const name = (t.tag || "").trim();
    if (!name) continue;
    out.push({ id: `t:${name}`, label: name });
  }
  return out;
}

function collectionCategories(item: Zotero.Item): Category[] {
  const out: Category[] = [];
  for (const collectionID of itemCollectionIDs(item)) {
    const name = collectionName(collectionID);
    if (!name) continue;
    out.push({ id: `c:${collectionID}`, label: name });
  }
  return out;
}

// ---------------------------------------------------------------- shared

function edgeEndpointId(end: string | ZNode): string {
  return typeof end === "string" ? end : end.id;
}

function* applyDegreeWeights(nodes: ZNode[], edges: ZEdge[]): Generator<void> {
  const degree = new Map<string, number>();
  for (const e of edges) {
    yield;
    const s = edgeEndpointId(e.source);
    const t = edgeEndpointId(e.target);
    degree.set(s, (degree.get(s) || 0) + 1);
    degree.set(t, (degree.get(t) || 0) + 1);
  }
  for (const n of nodes) {
    yield;
    n.weight = degree.get(n.id) || 0;
  }
}

function* finalizeGraph(
  nodes: ZNode[],
  edges: ZEdge[],
  mode: GraphMode,
  opts: { maxNodes: number; centerItemID?: number },
): Generator<void, ZGraphData> {
  if (opts.centerItemID !== undefined) {
    for (const n of nodes) {
      yield;
      if (n.kind === "item" && n.itemID === opts.centerItemID) {
        n.kind = "center";
      }
    }
  }
  // a node without a single edge says nothing in a relation graph, and the
  // force layout pushes such nodes to the border where they read as a frame
  // of noise (issue #2) — leave them out and say how many, keeping the centre
  const degree = new Map<string, number>();
  for (const e of edges) {
    yield;
    const a = edgeEndpointId(e.source);
    const b = edgeEndpointId(e.target);
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
  }
  const connected: ZNode[] = [];
  let isolated = 0;
  for (const node of nodes) {
    if (node.kind === "center" || (degree.get(node.id) || 0) > 0)
      connected.push(node);
    else if (node.kind === "item") isolated++;
    yield;
  }
  const limit = Number.isFinite(opts.maxNodes)
    ? Math.max(0, Math.floor(opts.maxNodes))
    : 0;
  const result = yield* truncateToBudget(connected, edges, limit);
  if (result.truncated) yield* applyDegreeWeights(result.nodes, result.edges);
  return { ...result, mode, isolated: isolated || undefined };
}

/** Spend the node budget on complete edges, prioritising the centre and
 * high-degree neighbourhoods. Every admitted non-centre node has an edge;
 * rejected endpoint pairs never consume a slot. */
function* truncateToBudget(
  nodes: ZNode[],
  edges: ZEdge[],
  maxNodes: number,
): Generator<void, { nodes: ZNode[]; edges: ZEdge[]; truncated: boolean }> {
  if (nodes.length <= maxNodes) return { nodes, edges, truncated: false };
  const byID = new Map<string, ZNode>();
  const adjacent = new Map<string, ZEdge[]>();
  let center: ZNode | undefined;
  for (const node of nodes) {
    byID.set(node.id, node);
    if (node.kind === "center") center = node;
    yield;
  }
  for (const edge of edges) {
    for (const id of [
      edgeEndpointId(edge.source),
      edgeEndpointId(edge.target),
    ]) {
      let links = adjacent.get(id);
      if (!links) adjacent.set(id, (links = []));
      links.push(edge);
    }
    yield;
  }
  const keptIDs = new Set<string>();
  if (center && maxNodes > 0) keptIDs.add(center.id);
  const ranked = yield* sortSteps(nodes, (a, b) => b.weight - a.weight);
  // The centre's neighbourhood is admitted before any other component.
  if (center) ranked.unshift(center);
  for (const node of ranked) {
    for (const edge of adjacent.get(node.id) || []) {
      const source = edgeEndpointId(edge.source);
      const target = edgeEndpointId(edge.target);
      const cost = Number(!keptIDs.has(source)) + Number(!keptIDs.has(target));
      if (keptIDs.size + cost <= maxNodes) {
        keptIDs.add(source);
        keptIDs.add(target);
      }
      yield;
    }
    if (keptIDs.size >= maxNodes) break;
    yield;
  }
  const kept: ZNode[] = [];
  for (const id of keptIDs) {
    const node = byID.get(id);
    if (node) kept.push(node);
    yield;
  }
  const keptEdges: ZEdge[] = [];
  for (const edge of edges) {
    if (
      keptIDs.has(edgeEndpointId(edge.source)) &&
      keptIDs.has(edgeEndpointId(edge.target))
    )
      keptEdges.push(edge);
    yield;
  }
  return { nodes: kept, edges: keptEdges, truncated: true };
}
