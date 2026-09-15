export type TagRename = [from: string, to: string];

/**
 * Zotero merges a destination immediately. Move every destination that is
 * itself a source first, so its original items cannot be carried along by a
 * later rename. The plan uses native trimmed names and rejects cycles before
 * any write. A failure must stop this plan: its dependent moves are unsafe.
 */
export function planTagRenames(
  pairs: readonly TagRename[],
  existing: ReadonlySet<string>,
): { ordered: TagRename[]; merges: number } {
  const moves = new Map<string, string>();
  for (const [from, to] of pairs) {
    const source = from.trim();
    const target = to.trim();
    if (!source || !target) throw new Error("Empty tag rename");
    if (source === target) continue;
    if (moves.has(source) && moves.get(source) !== target)
      throw new Error("Conflicting tag rename");
    moves.set(source, target);
  }
  const waiting = new Map<string, string[]>();
  const ready: string[] = [];
  const destinations = new Set<string>();
  let merges = 0;
  for (const [from, to] of moves) {
    if (moves.has(to)) {
      const dependents = waiting.get(to) ?? [];
      dependents.push(from);
      waiting.set(to, dependents);
    } else ready.push(from);
    if ((existing.has(to) && !moves.has(to)) || destinations.has(to)) merges++;
    destinations.add(to);
  }
  const ordered: TagRename[] = [];
  for (let i = 0; i < ready.length; i++) {
    const from = ready[i];
    ordered.push([from, moves.get(from)!]);
    ready.push(...(waiting.get(from) ?? []));
  }
  if (ordered.length !== moves.size) throw new Error("Cyclic tag rename");
  return { ordered, merges };
}
