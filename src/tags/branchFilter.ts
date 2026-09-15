import { parseTagRule } from "./match";

/** A displayed branch can contain several unrelated raw tag spellings when
 * the match rule uses regex captures. Keep those names together as one OR. */
export interface TagBranch {
  path: string;
  names: readonly string[];
}

export interface TagBranchSelection {
  branches: readonly TagBranch[];
  linkSymbol: string;
  matchRule: string;
}

/** Compile once per selection. Both item filtering and annotation cards use
 * AND between branches and OR within one branch. Match the same normalized
 * DISPLAY paths the tree builds, so regex captures and virtual parents work
 * without guessing a raw prefix. A delimiter is required before descendants. */
export function compileTagBranches(
  selection: TagBranchSelection,
): (tags: readonly string[]) => boolean {
  const link = selection.linkSymbol || "/";
  const matcher = parseTagRule(selection.matchRule);
  const tests = selection.branches.map((branch) => ({
    path: branch.path,
    prefix: branch.path + link,
    exact: new Set(branch.names),
  }));
  return (tags) => {
    if (!tests.length) return true;
    const paths = tags.map((tag) => {
      const display = matcher.test(tag);
      return display === null
        ? null
        : display.split(link).filter(Boolean).join(link);
    });
    return tests.every(({ path, prefix, exact }) =>
      tags.some(
        (tag, i) =>
          exact.has(tag) || paths[i] === path || !!paths[i]?.startsWith(prefix),
      ),
    );
  };
}
