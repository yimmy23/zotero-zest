import { zestConfig, type TagRule } from "../core/config";
import { getPref } from "../utils/prefs";
import { BADGE_COLOR_DEFAULT } from "../ui/palette";

/**
 * Local tag rules: colour + emoji for a tag PREFIX.
 *
 * Zotero itself only has nine colour slots (`Zotero.Tags.setColor`, position
 * 0–8) and colours are per exact tag. Nested workflows need more than nine
 * and want a whole branch ("Method/…") to share a colour, so Zest keeps its
 * own prefix rules in zest-config.json and *layers* them under Zotero's:
 *
 *   Zotero tag colour  >  longest matching Zest prefix rule  >  default colour
 *
 * Nothing here writes to Zotero. Promoting a rule to a real Zotero colour (so
 * it also shows in the item tree's own swatches) is an explicit user action in
 * the tag tree's context menu.
 */

export interface ResolvedTagStyle {
  color: string;
  textColor?: string;
  emoji?: string;
  /** true when the colour came from Zotero's own tag colours */
  native: boolean;
}

let rulesCache: TagRule[] | null = null;
let rulesVersion = 0;

zestConfig.onChange(() => {
  rulesCache = null;
  rulesVersion++;
});

/** rules sorted longest-prefix-first so the most specific rule wins */
export function tagRules(): TagRule[] {
  if (!rulesCache) {
    rulesCache = [...zestConfig.get().tagRules].sort(
      (a, b) => b.prefix.length - a.prefix.length,
    );
  }
  return rulesCache;
}

/** bump on every rule change — callers use it to invalidate their caches */
export function tagRulesVersion(): number {
  return rulesVersion;
}

export function ruleFor(tag: string): TagRule | undefined {
  for (const r of tagRules()) if (tag.startsWith(r.prefix)) return r;
  return undefined;
}

export function resolveTagStyle(
  tag: string,
  nativeColors: Map<string, { color: string; position: number }>,
): ResolvedTagStyle {
  const native = nativeColors.get(tag)?.color;
  const rule = ruleFor(tag);
  return {
    color:
      native ||
      rule?.color ||
      (getPref("textTags.color") as string) ||
      BADGE_COLOR_DEFAULT,
    textColor: rule?.textColor,
    emoji: rule?.emoji,
    native: !!native,
  };
}

export function setTagRule(prefix: string, patch: Partial<TagRule>) {
  zestConfig.update((draft) => {
    const existing = draft.tagRules.find((r) => r.prefix === prefix);
    if (existing) Object.assign(existing, patch, { prefix });
    else draft.tagRules.push({ prefix, ...patch });
  });
}

export function removeTagRule(prefix: string) {
  zestConfig.update((draft) => {
    draft.tagRules = draft.tagRules.filter((r) => r.prefix !== prefix);
  });
}
