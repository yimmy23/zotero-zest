/**
 * The `Map` rewrite grammar, kept compatible with zotero-style so an existing
 * configuration can be pasted in:
 *
 *   sci=中科院分区          exact match → replacement
 *   /^JCR ?(\d)$/=Q$1       regex (with $1 back-references) → replacement
 *   sciwarn=                empty replacement → hide this entry
 *
 * Entries are separated by newlines or commas (full-width commas are accepted
 * because the pref is routinely pasted from Chinese docs). Rules are applied
 * to field NAMES and field VALUES independently; the first matching rule wins.
 */

export interface RewriteRule {
  raw: string;
  re?: RegExp;
  from?: string;
  to: string;
}

const cache = new Map<string, RewriteRule[]>();

export function parseRewriteRules(
  text: string | undefined | null,
): RewriteRule[] {
  const src = (text ?? "").trim();
  if (!src) return [];
  const hit = cache.get(src);
  if (hit) return hit;
  const rules: RewriteRule[] = [];
  for (const line of src.split(/[\n\r]+|[,，](?![^/]*\/=)/)) {
    const entry = line.trim();
    if (!entry) continue;
    const eq = splitOnRewriteEquals(entry);
    if (!eq) continue;
    const [left, right] = eq;
    const re = left.match(/^\/(.+)\/([a-z]*)$/);
    if (re) {
      try {
        rules.push({
          raw: entry,
          re: new RegExp(re[1], re[2].replace(/g/g, "")),
          to: right,
        });
      } catch {
        // invalid regex → ignore the rule rather than breaking the column
      }
    } else if (left) {
      rules.push({ raw: entry, from: left, to: right });
    }
  }
  if (cache.size > 40) cache.clear();
  cache.set(src, rules);
  return rules;
}

/** split at the first "=" that is not inside a /regex/ */
function splitOnRewriteEquals(entry: string): [string, string] | null {
  let inRe = false;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (c === "/" && (i === 0 || entry[i - 1] !== "\\")) inRe = !inRe;
    if (c === "=" && !inRe) {
      return [entry.slice(0, i).trim(), entry.slice(i + 1).trim()];
    }
  }
  return null;
}

/**
 * Apply the rules. Returns the rewritten string, or null when a rule maps the
 * input to an empty string (= "hide this").
 */
export function applyRewrite(
  rules: RewriteRule[],
  input: string,
): string | null {
  for (const r of rules) {
    if (r.from !== undefined) {
      if (r.from === input) return r.to === "" ? null : r.to;
      continue;
    }
    if (r.re && r.re.test(input)) {
      const out = input.replace(r.re, r.to);
      return out === "" ? null : out;
    }
  }
  return input;
}
