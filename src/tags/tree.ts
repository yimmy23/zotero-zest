import type { TagMatcher } from "./match";

/**
 * Nested tag tree model — pure data, no Zotero and no DOM.
 *
 * A tag like "Method/Cohort/Matched" becomes three nested nodes when the link
 * symbol is "/". Intermediate nodes may not exist as real tags ("Method" on
 * its own): they are still shown, but they cannot be renamed or coloured as a
 * tag — only their whole branch can be filtered.
 */

export interface TagInput {
  tag: string;
  /** items carrying exactly this tag (in the current scope) */
  count: number;
  /** optional item ids, used to de-duplicate counts up the tree */
  itemIDs?: Set<number>;
  /** Zotero colour position (0–8) when the tag has one */
  position?: number;
  color?: string;
}

export interface TagNode {
  /** full tag path down to this node ("Method/Cohort") */
  name: string;
  /** last path segment ("Cohort") */
  segment: string;
  depth: number;
  children: TagNode[];
  /** items with exactly this tag */
  count: number;
  /** items with this tag or any descendant (de-duplicated when itemIDs given) */
  total: number;
  /** false for intermediate path nodes that are not real tags */
  exists: boolean;
  position?: number;
  color?: string;
}

export type TagSortMode = "name" | "count" | "color" | "length";

export const LINK_SYMBOLS = ["/", "\\", ".", "-", "_", ":", ">"] as const;
export type LinkSymbol = (typeof LINK_SYMBOLS)[number];

function newNode(name: string, segment: string, depth: number): TagNode {
  return {
    name,
    segment,
    depth,
    children: [],
    count: 0,
    total: 0,
    exists: false,
  };
}

/**
 * Build the forest. `matcher` (the #Tags rule) decides which tags take part;
 * when it is given, the matched TEXT is what gets split into segments, so a
 * rule like "#" turns "#Method/Cohort" into Method → Cohort while the real
 * tag name is kept for filtering.
 */
export function buildTagTree(
  tags: TagInput[],
  opts: {
    linkSymbol?: string;
    sort?: TagSortMode;
    descending?: boolean;
    matcher?: TagMatcher;
  } = {},
): TagNode[] {
  const link = opts.linkSymbol || "/";
  const roots = new Map<string, TagNode>();
  const byName = new Map<string, TagNode>();
  /** node → item ids of the whole branch, for de-duplicated totals */
  const branchItems = new Map<TagNode, Set<number>>();

  for (const input of tags) {
    const display = opts.matcher ? opts.matcher.test(input.tag) : input.tag;
    if (display === null) continue;
    const segments = display.split(link).filter((s) => s.length);
    if (!segments.length) continue;

    let level = roots;
    let path = "";
    const parentChain: TagNode[] = [];
    let node: TagNode | undefined;
    for (let i = 0; i < segments.length; i++) {
      path = i === 0 ? segments[0] : `${path}${link}${segments[i]}`;
      node = level.get(segments[i]);
      if (!node) {
        node = newNode(path, segments[i], i);
        level.set(segments[i], node);
        byName.set(path, node);
      }
      parentChain.push(node);
      // children map is rebuilt from the array at the end; keep a temp map
      level = childMap(node);
    }
    if (!node) continue;
    node.exists = true;
    node.count += input.count;
    node.position = input.position;
    node.color = input.color;
    // the real tag name may differ from the displayed path (matcher stripped
    // a prefix) — remember it so filtering uses the true tag
    realNames(node).add(input.tag);
    for (const n of parentChain) {
      if (input.itemIDs) {
        const set = branchItems.get(n) ?? new Set<number>();
        for (const id of input.itemIDs) set.add(id);
        branchItems.set(n, set);
      } else {
        n.total += input.count;
      }
    }
  }

  if (branchItems.size) {
    for (const [node, set] of branchItems) node.total = set.size;
  }

  const finish = (map: Map<string, TagNode>): TagNode[] => {
    const list = [...map.values()];
    for (const n of list) n.children = finish(childMap(n));
    return sortNodes(list, opts.sort ?? "name", !!opts.descending);
  };
  return finish(roots);
}

/* child maps and real names live off-object so TagNode stays serialisable */
const childMaps = new WeakMap<TagNode, Map<string, TagNode>>();
const realNameSets = new WeakMap<TagNode, Set<string>>();

function childMap(node: TagNode): Map<string, TagNode> {
  let m = childMaps.get(node);
  if (!m) {
    m = new Map();
    childMaps.set(node, m);
  }
  return m;
}

function realNames(node: TagNode): Set<string> {
  let s = realNameSets.get(node);
  if (!s) {
    s = new Set();
    realNameSets.set(node, s);
  }
  return s;
}

/** the actual Zotero tag names represented by this node (never the path) */
export function tagNamesOf(node: TagNode): string[] {
  return [...realNames(node)];
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortNodes(
  nodes: TagNode[],
  mode: TagSortMode,
  descending: boolean,
): TagNode[] {
  const dir = descending ? -1 : 1;
  const sorted = [...nodes];
  switch (mode) {
    case "count":
      sorted.sort(
        (a, b) => dir * (b.total - a.total || collator.compare(a.name, b.name)),
      );
      break;
    case "color":
      // coloured tags first in Zotero's own position order, then by name
      sorted.sort((a, b) => {
        const pa = a.position ?? 99;
        const pb = b.position ?? 99;
        return dir * (pa - pb || collator.compare(a.name, b.name));
      });
      break;
    case "length":
      sorted.sort(
        (a, b) =>
          dir *
          (a.segment.length - b.segment.length ||
            collator.compare(a.name, b.name)),
      );
      break;
    default:
      sorted.sort((a, b) => dir * collator.compare(a.name, b.name));
  }
  return sorted;
}

/** every real tag name in this node's branch — what a click filters by */
export function branchTagNames(
  node: TagNode,
  out = new Set<string>(),
): Set<string> {
  for (const n of tagNamesOf(node)) out.add(n);
  for (const c of node.children) branchTagNames(c, out);
  return out;
}

export function walk(nodes: TagNode[], fn: (n: TagNode) => void) {
  for (const n of nodes) {
    fn(n);
    walk(n.children, fn);
  }
}

export function countNodes(nodes: TagNode[]): number {
  let n = 0;
  walk(nodes, () => n++);
  return n;
}
