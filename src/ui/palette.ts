/**
 * Zest colour defaults — a calm, academic teal.
 *
 * Blue is Zotero's own selection colour (the item tree paints a selected row
 * with the system SelectedItem blue), so a blue heat wash or badge vanishes
 * into the selection the moment the row is picked. The plugin therefore sits
 * one hue over, on Zotero's own teal:
 *   --accent-teal #59adc4   (deeper step #2f8296)   --accent-green #39bf68
 *
 * The reading heat map follows the GitHub / Codex contribution-graph model:
 * four discrete intensity steps instead of a continuous ramp, painted with
 * alpha over the row background so selection, hover and dark mode keep
 * compositing correctly.
 *
 * Keep in sync with addon/prefs.js (these are the code-side fallbacks for the
 * same defaults).
 */

/** heat strip / title wash base colour (Zotero --accent-teal) */
export const HEAT_COLOR_DEFAULT = "#59ADC4";
export const HEAT_OPACITY_DEFAULT = 0.7;

/** GitHub-style discrete steps, relative to the user's opacity */
export const HEAT_LEVELS = [0.22, 0.42, 0.68, 1] as const;

/** #Tags badge colour when a tag has no Zotero colour (deeper teal) */
export const BADGE_COLOR_DEFAULT = "#2F8296";
