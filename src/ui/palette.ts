/**
 * Zest colour defaults — a calm, academic blue.
 *
 * Values are taken from Zotero's own accent palette so the plugin looks like
 * part of the app in both themes:
 *   --accent-azure #66adff   --accent-blue #4072e5   --accent-teal #59adc4
 *
 * The reading heat map follows the GitHub / Codex contribution-graph model:
 * four discrete intensity steps instead of a continuous ramp, painted with
 * alpha over the row background so selection, hover and dark mode keep
 * compositing correctly.
 *
 * Keep in sync with addon/prefs.js (these are the code-side fallbacks for the
 * same defaults).
 */

/** heat strip / title wash base colour (Zotero --accent-azure) */
export const HEAT_COLOR_DEFAULT = "#66ADFF";
export const HEAT_OPACITY_DEFAULT = 0.7;

/** GitHub-style discrete steps, relative to the user's opacity */
export const HEAT_LEVELS = [0.22, 0.42, 0.68, 1] as const;

/** #Tags badge colour when a tag has no Zotero colour (Zotero --accent-blue) */
export const BADGE_COLOR_DEFAULT = "#4072E5";
