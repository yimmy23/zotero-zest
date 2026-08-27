// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      // These probes are loaded as AsyncFunction bodies by dev-eval.sh, so
      // their top-level await/return syntax is intentionally not a JS module.
      ignores: ["scripts/phase-*-probe.js", "scripts/upgrade-probe.js"],
    },
    {
      files: ["**/*.ts"],
      rules: {
        // We disable this rule here because the template
        // contains some unused examples and variables
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
  ],
});
