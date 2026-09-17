// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      // These probes are loaded as AsyncFunction bodies by dev-eval.sh, so
      // their top-level await/return syntax is intentionally not a JS module.
      ignores: [
        "scripts/phase-*-probe.js",
        "scripts/upgrade-probe.js",
        "scripts/preferences-probe.js",
        "scripts/matrix-probe.js",
        "scripts/tags-probe.js",
        "scripts/native-select-probe.js",
        "scripts/native-tags-layout-probe.js",
        "scripts/sidebar-probe.js",
        "scripts/sidebar-loading-probe.js",
        "scripts/sidebar-readiness-probe.js",
        "scripts/rating-probe.js",
        "scripts/sidebar-controls-probe.js",
        "scripts/achievement-artwork-probe.js",
        "scripts/reading-schema-probe.js",
        "scripts/tab-session-probe.js",
        "scripts/citation-lifecycle-probe.js",
        "scripts/journal-ui-probe.js",
        "scripts/if-percentile-probe.js",
        "scripts/showjcr-probe.js",
        "scripts/jcr-sidebar-probe.js",
      ],
    },
  ],
});
