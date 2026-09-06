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

import { buildAuthorResolver, firstLastIndices } from "./authorIdentity";
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
  opts: {
    maxNodes: number;
    centerItemID?: number;
    /** author mode: every author, or only first + last (corresponding slot) */
    authorRoles?: "all" | "firstlast";
    /** bipartite modes: category must be shared by at least this many items */
    minShared?: number;
  },
): Promise<ZGraphData> {
  const empty: ZGraphData = { nodes: [], edges: [], mode, truncated: false };
  try {
    const regular = items.filter(isRegularItemSafe);
    switch (mode) {
      case "related":
        return buildRelatedGraph(regular, opts);
      case "author":
      case "tag":
      case "collection":
        return buildBipartiteGraph(regular, mode, opts);
      default:
        return empty;
    }
  } catch (e) {
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

function buildRelatedGraph(
  items: Zotero.Item[],
  opts: { maxNodes: number; centerItemID?: number },
): ZGraphData {
  const nodes: ZNode[] = [];
  const nodeIds = new Set<string>();
  for (const item of items) {
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
    const srcId = itemNodeId(item);
    if (!srcId || !nodeIds.has(srcId)) continue;
    let libraryID: number;
    try {
      libraryID = item.libraryID;
    } catch {
      continue;
    }
    for (const key of itemRelatedKeys(item)) {
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
  applyDegreeWeights(nodes, edges);
  return finalizeGraph(nodes, edges, "related", opts);
}

// ----------------------------------------------------------- mode: bipartite

function buildBipartiteGraph(
  items: Zotero.Item[],
  mode: CategoryMode,
  opts: {
    maxNodes: number;
    centerItemID?: number;
    authorRoles?: "all" | "firstlast";
    minShared?: number;
  },
): ZGraphData {
  const itemNodes: ZNode[] = [];
  const itemIds = new Set<string>();
  const catNodes = new Map<string, ZNode>();
  const catMembers = new Map<string, Set<string>>();
  const rawEdges: Array<{ itemId: string; catId: string }> = [];
  // author mode resolves identities over the whole scope first (clustering
  // needs to see every name variant, not one item at a time)
  const resolver = mode === "author" ? buildAuthorResolver(items) : null;

  for (const item of items) {
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
    const node = catNodes.get(catId);
    if (node) node.weight = members.size;
  }

  // categories shared by too few items only add noise — the threshold is
  // the user's (default 2), unless it would drop every category and leave
  // a graph with no bipartite structure at all
  const minShared = Math.max(2, opts.minShared || 2);
  let keptCatIds = new Set(
    [...catNodes.values()]
      .filter((n) => n.weight >= minShared)
      .map((n) => n.id),
  );
  if (keptCatIds.size === 0) {
    keptCatIds = new Set(catNodes.keys());
  }

  const edges: ZEdge[] = rawEdges
    .filter((e) => keptCatIds.has(e.catId))
    .map((e) => ({ source: e.itemId, target: e.catId, weight: 1 }));

  // item weight = number of links, same convention as "related" mode
  applyDegreeWeights(itemNodes, edges);

  const catNodeList = [...catNodes.values()].filter((n) =>
    keptCatIds.has(n.id),
  );
  return finalizeGraph([...itemNodes, ...catNodeList], edges, mode, opts);
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

function applyDegreeWeights(nodes: ZNode[], edges: ZEdge[]): void {
  const degree = new Map<string, number>();
  for (const e of edges) {
    const s = edgeEndpointId(e.source);
    const t = edgeEndpointId(e.target);
    degree.set(s, (degree.get(s) || 0) + 1);
    degree.set(t, (degree.get(t) || 0) + 1);
  }
  for (const n of nodes) {
    n.weight = degree.get(n.id) || 0;
  }
}

function finalizeGraph(
  nodes: ZNode[],
  edges: ZEdge[],
  mode: GraphMode,
  opts: { maxNodes: number; centerItemID?: number },
): ZGraphData {
  if (opts.centerItemID !== undefined) {
    for (const n of nodes) {
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
    const a = edgeEndpointId(e.source);
    const b = edgeEndpointId(e.target);
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
  }
  const connected = nodes.filter(
    (n) => n.kind === "center" || (degree.get(n.id) || 0) > 0,
  );
  const isolated = nodes.length - connected.length;
  const {
    nodes: kept,
    edges: keptEdges,
    truncated,
  } = truncateToBudget(connected, edges, Math.max(0, opts.maxNodes));
  // A budget can remove a node's last neighbour. Recompute visible degree
  // after choosing the budget (the original degree still drives priority),
  // then discard those new isolates while retaining an isolated centre.
  if (truncated) applyDegreeWeights(kept, keptEdges);
  const visible = truncated
    ? kept.filter((n) => n.kind === "center" || n.weight > 0)
    : kept;
  // The footer counts omitted library items, not category nodes.
  const totalIsolated =
    isolated +
    (truncated
      ? kept.filter((n) => n.kind === "item" && n.weight === 0).length
      : 0);
  return {
    nodes: visible,
    edges: keptEdges,
    mode,
    truncated,
    isolated: totalIsolated || undefined,
  };
}

/**
 * Keep the highest-weight nodes within maxNodes (center always kept), drop
 * the rest, and drop any edge that lost an endpoint. Weight-0 nodes (e.g.
 * isolated items with no relations) sort to the back and are dropped
 * first, satisfying the "related" mode's isolated-node rule for free.
 */
function truncateToBudget(
  nodes: ZNode[],
  edges: ZEdge[],
  maxNodes: number,
): { nodes: ZNode[]; edges: ZEdge[]; truncated: boolean } {
  if (nodes.length <= maxNodes) {
    return { nodes, edges, truncated: false };
  }
  const center = nodes.filter((n) => n.kind === "center");
  const rest = nodes
    .filter((n) => n.kind !== "center")
    .slice()
    .sort((a, b) => b.weight - a.weight);
  const budget = Math.max(0, maxNodes - center.length);
  const kept = [...center, ...rest.slice(0, budget)];
  const keptIds = new Set(kept.map((n) => n.id));
  const keptEdges = edges.filter(
    (e) =>
      keptIds.has(edgeEndpointId(e.source)) &&
      keptIds.has(edgeEndpointId(e.target)),
  );
  return { nodes: kept, edges: keptEdges, truncated: true };
}
