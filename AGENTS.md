# AGENTS.md — working on Zest

Zest is a Zotero 10 plugin (TypeScript, esbuild, zotero-plugin-scaffold). This file is the contract:
what the pieces are, what must stay true, and how to prove a change works. `plan.md` holds the design
history and the verified Zotero API facts; the README is for users.

## Layout

```
src/
  index.ts hooks.ts addon.ts   startup / shutdown / per-window bind / pref observers
  columns/                     every item-tree column + registry helpers + title decoration
  authors/pipeline.ts          resolveRoles → normalize → select → format → decorate
  cite/                        citation counts: Extra format, sources (Crossref/OpenAlex/S2)
  rank/                        journal ranks: local dataset → easyScholar → OpenAlex, cache, Map rewrite
  reading/                     tracker, store (zest.sqlite), heat, read status + automation, import/export
  annots/density.ts            annotation summaries for the column and the panel cards
  tags/                        nested tag tree, scope pass, rules, tag context menu
  views/                       getItems filter pipeline, item-type filter, column views,
                               collection counts, reveal guard
  panes/                       item-pane sections, statistics window, annotation matrix
  tabs/                        vertical tab sidebar + groups/sessions model
  graph/                       d3-force panel
  core/                        config store, JSON caches, sqlite, HTTP, secrets
  ui/                          stylesheet + accent tokens, icon set, palette, batch runner
  utils/                       Extra lines, CSV, guard, prefs, timers, locale, item helpers
addon/                         manifest, prefs.js, locales (en-US, zh-CN), preferences pane, dialog host
scripts/                       dev-eval.sh, dev-shot.py, phase-c/d/e probes
```

## Invariants

These are not style preferences. Breaking one is a bug even if everything still compiles.

1. **Zest extends Zotero; it never degrades it.** Anything that replaces a native surface (nested tag
   tree, vertical tabs, collection counts, title decoration) is off by default, reversible, and
   disables itself when its feature probe fails. Filters compose with Zotero's own search rather than
   overriding it. Native gestures stay native: a modified click (Shift/Cmd/Ctrl/Alt, non-primary
   button) belongs to Zotero's selection handling — see `isPlainClick` in `columns/registry.ts`.
2. **`Extra` is the user's field.** Write only on an explicit user action, only the line you own, and
   never reformat, reorder or delete anything else — including blank lines and other plugins' records
   (`GSCC:`, `ZSCC:`, `openalex.cit_count:`). All writes go through `utils/extra.ts` or
   `cite/extraFormat.ts`; never use toolkit's `replaceExtraFields`.
3. **Secrets never leave the login manager.** No key in prefs (except the explicit legacy fallback), in
   a log line, in Zotero's URL cache, in an exported bundle, or in an error message. Secret-bearing
   requests go through `core/http.ts` with `secret: true`, which bypasses Zotero's HTTP logging.
4. **Nothing hits the network unless the user asked.** Auto-fetch is a preference; a batch stops when a
   source throttles; back-off is never cleared by a "force" flag.
5. **Full teardown restores Zotero exactly.** Every install has an uninstall that puts back the
   prototype method, the DOM, the stylesheet, the menus, the native tag selector and the native tab
   bar — verified per window and on plugin shutdown.
6. **Never touch the user's own Zotero.** Development runs against `.scaffold/dev-profile` only; the
   kill command is scoped to that path. Do not read, write or launch `/Applications/Zotero.app` with
   the user's profile.
7. **Render paths stay cheap.** `dataProvider` and `renderCell` run per row per frame: no DB call, no
   recursive walk, no JSON parse, no network. Anything expensive is precomputed off the render path
   and repainted through `refreshItems` / `redraw`.
8. **One state per window.** Filters, tree state, sidebars and dialogs are keyed by window; closing one
   window must not disturb another.
9. **No AI attribution** in commits, PRs or issues, and **no version bumps or releases** unless the
   maintainer asks for one.

## Conventions

- Zotero CSS variables only in the main window (`--fill-*`, `--accent-*`, `--zotero-font-size`); the
  two dialog windows carry their own palette because they do not inherit Zotero's stylesheet.
- The accent is one preference (`ui.accent`) written onto the root as `--zest-accent`;
  `--zest-accent-strong` and `--zest-accent-wash*` derive from it in `ui/styles.ts`. Do not hardcode a
  hue anywhere else.
- Strings live in `addon/locale/*/addon.ftl` (used from JS via `getString`) and `preferences.ftl` (used
  from the settings XHTML via `data-l10n-id`). XUL elements need Fluent **attribute** form
  (`id =\n    .label = …`); a value-form message renders blank. Keep en-US and zh-CN in sync and add
  new ids to `typings/i10n.d.ts`.
- Every private-API call is feature-probed and wrapped in `guard()`; a failed probe disables that
  feature and logs once.
- Errors are logged with `ztoolkit.log("[area] what failed", e)` and never rethrown into Zotero's own
  call stacks.

## Verifying a change

There is no unit-test harness; the plugin is verified against a running Zotero 10 dev instance.

```bash
npm start                                   # dev instance with an isolated profile
npx tsc --noEmit -p . && npx eslint src --max-warnings=0
npm run build                               # .scaffold/build/zest.xpi

scripts/dev-eval.sh 'return Zotero.version' # run arbitrary JS inside the dev instance
scripts/dev-eval.sh -f scripts/phase-c-probe.js   # tags · ranks · views · graph · reader
scripts/dev-eval.sh -f scripts/phase-d-probe.js   # authors · citations · panels · stats · matrix · tabs
scripts/dev-eval.sh -f scripts/phase-e-probe.js   # the audit regression suite
scripts/dev-shot.py out.png [selector] [--dark|--light|--prefs|--stats|--matrix]
```

A change is done when all three probes pass, `tsc` and `eslint` are clean, and — for anything visual —
a screenshot in both themes shows the result. Prefs defaults only load at plugin startup: after editing
`addon/prefs.js`, restart the dev instance rather than relying on the hot reload.

When you touch one of the invariants above, add an assertion to `scripts/phase-e-probe.js` so the next
change cannot quietly undo it.
