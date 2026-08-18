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

function lineRe(keys: string[]): RegExp {
  return new RegExp(
    `^\\s*(${keys.map(escapeRe).join("|")})\\s*:\\s*(.*?)\\s*$`,
    "i",
  );
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
  for (const line of lines) {
    const m = line.match(re);
    if (m && !done) {
      done = true;
      if (value === null) {
        changed = true;
        continue; // drop
      }
      const next = `${m[1]}: ${value}`;
      if (next !== line) changed = true;
      out.push(next);
      continue;
    }
    if (m && done) {
      // duplicate line for the same key: drop it
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
