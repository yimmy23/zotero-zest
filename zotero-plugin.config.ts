import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // One channel. A second manifest for prereleases only pays off once there
  // are prereleases to put in it, and an unmaintained one is worse than none:
  // it sat at 1.0.0 while the real channel moved on, ready to offer a
  // downgrade to anyone who ever ran a beta build.
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/update.json`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        // fold constant conditions in the release build: the dev-only eval
        // endpoint compiles to `if (true) return;` and its (dead) body — and
        // its token string — would otherwise ship inside the xpi. Identifiers
        // stay readable, so the bundle is still auditable.
        minifySyntax: process.env.NODE_ENV === "production",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  server: {
    // no Browser Toolbox: it is a separate process that steals window focus,
    // which breaks focus-gated probes (reading tracker) in the dev instance
    devtools: false,
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },
});
