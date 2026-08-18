/**
 * Zest colour defaults — a light GitHub green.
 *
 * Blue is Zotero's own selection colour (the item tree paints a selected row
 * with the system SelectedItem blue), so a blue heat wash or badge vanishes
 * into the selection the moment the row is picked. The plugin therefore sits
 * well away from it, on the green of GitHub's contribution graph — which is
 * also within a shade of Zotero's own --accent-green (#39bf68):
 *   base #40c463   deeper step #2da44e
 *
 * Everything is painted with alpha rather than flat fill, including the top
 * heat step, so the row underneath (selection, hover, striping) keeps showing
 * through instead of being covered.
 *
 * The reading heat map follows the GitHub / Codex contribution-graph model:
 * four discrete intensity steps instead of a continuous ramp, painted with
 * alpha over the row background so selection, hover and dark mode keep
 * compositing correctly.
 *
 * Keep in sync with addon/prefs.js (these are the code-side fallbacks for the
 * same defaults).
 */

/** heat strip / title wash base colour (GitHub contribution green) */
export const HEAT_COLOR_DEFAULT = "#40C463";
export const HEAT_OPACITY_DEFAULT = 0.62;

/** GitHub-style discrete steps, relative to the user's opacity; the top step
 *  stops short of 1 so even the hottest page stays translucent */
export const HEAT_LEVELS = [0.18, 0.36, 0.6, 0.88] as const;

/** #Tags badge colour when a tag has no Zotero colour (deeper green; the
 *  badge itself is painted at 0.16 alpha, so this reads pale) */
export const BADGE_COLOR_DEFAULT = "#2DA44E";
