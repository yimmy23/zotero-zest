/**
 * The "#Tags" match grammar (kept compatible with zotero-style's
 * `textTagsColumn.match` pref so users can paste their old rule):
 *
 *   "#"            tags starting with "#", shown without the prefix
 *   "~~/"          every tag NOT starting with "/", shown as-is (several
 *                  characters after ~~ form a character class: "~~/#" =
 *                  not starting with "/" nor "#", as in the original)
 *   "/^#(.+)/i"    JS regex; capture groups are joined for display,
 *                  no groups → whole tag
 */

export interface TagMatcher {
  rule: string;
  /** display text for a matching tag, or null when it does not match */
  test(tag: string): string | null;
  /** the nesting prefix used by the nested-tag tree ("" for regex rules) */
  prefix: string;
  negate: boolean;
}

const cache = new Map<string, TagMatcher>();

export function parseTagRule(raw: string | undefined | null): TagMatcher {
  const rule = (raw ?? "").trim() || "#";
  const hit = cache.get(rule);
  if (hit) return hit;
  let m: TagMatcher;
  const re = rule.match(/^\/(.+)\/([a-z]*)$/);
  if (re) {
    let rx: RegExp | null = null;
    try {
      rx = new RegExp(re[1], re[2].replace(/g/g, ""));
    } catch {
      rx = null;
    }
    m = {
      rule,
      prefix: "",
      negate: false,
      test: (tag) => {
        if (!rx) return null;
        const r = tag.match(rx);
        if (!r) return null;
        if (r.length > 1) {
          const parts = r.slice(1).filter((x) => x !== undefined && x !== "");
          return parts.length ? parts.join("") : tag;
        }
        return tag;
      },
    };
  } else if (rule.startsWith("~~")) {
    const chars = rule.slice(2);
    m = {
      rule,
      prefix: chars,
      negate: true,
      test: (tag) => (chars && chars.includes(tag[0] ?? "") ? null : tag),
    };
  } else {
    const prefix = rule;
    m = {
      rule,
      prefix,
      negate: false,
      // remainder empty (tag equals the prefix) → nothing to show
      test: (tag) =>
        tag.startsWith(prefix) ? tag.slice(prefix.length).trim() || null : null,
    };
  }
  if (cache.size > 50) cache.clear();
  cache.set(rule, m);
  return m;
}
