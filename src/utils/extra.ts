/**
 * Line-oriented helpers for the item "Extra" field.
 *
 * Zotero's own parser (`Zotero.Utilities.Internal.extractExtraFields`) only
 * knows Zotero fields / CSL variables; plugin keys such as `Read_Status`,
 * `Rating`, `Citations` stay in the free-text remainder. We therefore treat
 * Extra as a list of lines and upsert exactly one line per key, leaving every
 * other line untouched (never use toolkit's `replaceExtraFields`: it drops
 * lines that are not `Key: Value`).
 *
 * Keys are matched case-insensitively; the write keeps the item's existing
 * spelling of the key when it already has one (so a legacy `rate: 3` line is
 * updated in place instead of a second `Rating:` line being added).
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const reCache = new Map<string, RegExp>();
/** memoised (key arrays are module constants; no g/y flag so sharing is safe) */
function lineRe(keys: string[]): RegExp {
  const k = keys.join("\u0001");
  let re = reCache.get(k);
  if (!re) {
    re = new RegExp(
      `^\\s*(${keys.map(escapeRe).join("|")})\\s*:\\s*(.*?)\\s*$`,
      "i",
    );
    reCache.set(k, re);
  }
  return re;
}

/** Read the first line matching any of `keys` (case-insensitive). */
export function getExtraLine(
  item: Zotero.Item,
  keys: string[],
): { key: string; value: string } | null {
  let extra: string;
  try {
    extra = (item.getField("extra") as string) || "";
  } catch {
    return null;
  }
  if (!extra) return null;
  const re = lineRe(keys);
  for (const line of extra.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) return { key: m[1], value: m[2] };
  }
  return null;
}

/**
 * Compute the new Extra text with `key: value` upserted (value === null
 * removes the line). Pure — does not touch the item. Returns null when
 * nothing changes.
 */
export function upsertExtraText(
  extra: string,
  keys: string[],
  value: string | null,
): string | null {
  const re = lineRe(keys);
  const lines = extra ? extra.split(/\r?\n/) : [];
  const out: string[] = [];
  let done = false;
  let changed = false;
  // only the spelling we actually rewrote counts as a duplicate: `rate:` and
  // `Rating:` are different lines to the user (one may be another plugin's, or
  // a deliberate note), and deleting the other spelling loses data we never
  // showed
  let writtenKey = "";
  for (const line of lines) {
    const m = line.match(re);
    if (m && !done) {
      done = true;
      writtenKey = m[1].toLowerCase();
      if (value === null) {
        changed = true;
        continue; // drop
      }
      const next = `${m[1]}: ${value}`;
      if (next !== line) changed = true;
      out.push(next);
      continue;
    }
    if (m && done && m[1].toLowerCase() === writtenKey) {
      // a second line with the SAME key: that one is a duplicate, drop it
      changed = true;
      continue;
    }
    out.push(line);
  }
  if (!done && value !== null) {
    // append (after a trailing blank line cleanup)
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    out.push(`${keys[0]}: ${value}`);
    changed = true;
  }
  if (!changed) return null;
  return out.join("\n");
}

/** Upsert one Extra line and save the item (skips the write when unchanged). */
export async function setExtraLine(
  item: Zotero.Item,
  keys: string[],
  value: string | null,
): Promise<boolean> {
  let extra: string;
  try {
    extra = (item.getField("extra") as string) || "";
  } catch {
    // unloaded item data
    return false;
  }
  const next = upsertExtraText(extra, keys, value);
  if (next === null) return false;
  item.setField("extra", next);
  await item.saveTx({ skipSelect: true } as any);
  return true;
}

/**
 * Upsert several lines at once and save the item ONCE (skips the write when
 * nothing changes). `entries` = [[keys, value|null], ...].
 */
export async function setExtraLines(
  item: Zotero.Item,
  entries: Array<[string[], string | null]>,
): Promise<boolean> {
  let extra: string;
  try {
    extra = (item.getField("extra") as string) || "";
  } catch {
    return false;
  }
  let next = extra;
  let changed = false;
  for (const [keys, value] of entries) {
    const r = upsertExtraText(next, keys, value);
    if (r !== null) {
      next = r;
      changed = true;
    }
  }
  if (!changed) return false;
  item.setField("extra", next);
  await item.saveTx({ skipSelect: true } as any);
  return true;
}
