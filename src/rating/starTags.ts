/**
 * A legacy rating tag is exactly one to five star glyphs.  This deliberately
 * accepts no surrounding text or whitespace: a tag such as `⭐ Reading` is a
 * meaningful user tag, not a rating source or a duplicate to hide.
 */
const STAR_TAG = /^(?:(?:⭐|★)\uFE0F?){1,5}$/u;
const STAR_UNIT = /(?:⭐|★)\uFE0F?/gu;

export function parseStarRatingTag(tag: unknown): number | undefined {
  if (typeof tag !== "string" || !STAR_TAG.test(tag)) return undefined;
  const count = tag.match(STAR_UNIT)?.length ?? 0;
  return count >= 1 && count <= 5 ? count : undefined;
}
