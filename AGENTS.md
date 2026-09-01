# AGENTS.md — working on Zest

Zest is a Zotero 10 plugin (TypeScript, esbuild, zotero-plugin-scaffold). This file is the contract:
what the pieces are, what must stay true, and how to prove a change works. `plan.md` holds the design
history and the verified Zotero API facts; the README is for users.

## Layout

```
src/
  index.ts hooks.ts addon.ts   startup / shutdown / per-window bind / pref observers
  api.ts                       `Zotero.Zest.api` — read-only surface for Better Notes templates,
                               Actions & Tags scripts and Run JavaScript. Never throws, never
                               returns an internal type, never writes
  columns/                     every item-tree column + registry helpers + title decoration
  authors/pipeline.ts          resolveRoles → normalize → select → format → decorate
  cite/                        citation counts: Extra format, sources (Crossref/OpenAlex/S2)
  rank/                        journal ranks: local dataset → easyScholar → OpenAlex, cache, Map rewrite
  reading/                     tracker, store (zest.sqlite), heat, read status (manual layer in
                               Extra + the automatic layer derived from the record and Zotero's own
                               last-read stamp), the status picker popup, automation, import/export
  annots/density.ts            annotation summaries for the column and the panel cards
  tags/                        nested tag tree, scope pass, rules, tag context menu
  views/                       getItems filter pipeline, column views, collection counts, reveal guard
  reader/                      the readerCustomThemes repair only — Zest adds nothing to the reader
                               (maintainer's call, 2026-08-23)
  panes/                       item-pane sections, statistics window, annotation matrix
  tabs/                        vertical tab sidebar + groups/sessions model
  graph/                       d3-force panel + author identity (authorIdentity: name
                               clustering + cached OpenAlex ids; authorFetch: bounded
                               authorship top-up); authors/authorMenu.ts is the click menu
                               (library filter + online search) both the panel and the
                               graph open
  core/                        config store, JSON caches, sqlite, HTTP, secrets
  ui/                          stylesheet + accent tokens, icon set, palette, batch runner
  utils/                       Extra lines, CSV, guard, prefs, timers, locale, item helpers
addon/                         manifest, prefs.js, locales (en-US, zh-CN), preferences pane, dialog host
scripts/                       dev-eval.sh, dev-shot.py, phase-c/d/e probes,
                               upgrade-probe.js (destructive; upgrade ordering)
assets/                        icon sources; NOT shipped (build packs addon/** only).
                               favicon.svg regenerates addon/content/icons/favicon{,@0.5x}.png
                               via `rsvg-convert -w 96 -h 96` / `-w 48 -h 48`
```

Everything under `addon/` ends up in the xpi, so an unreferenced file there is dead weight that
users download. Design sources live in `assets/`.

## Invariants

These are not style preferences. Breaking one is a bug even if everything still compiles.

1. **Zest extends Zotero; it never degrades it.** Anything that replaces a native surface (nested tag
   tree, vertical tabs, collection counts) is off by default, reversible, and disables itself when
   its feature probe fails. Title decoration only adds to the Title cell (heat, bold) and ships on;
   it is still reversible and probe-gated. **Zest does not duplicate what Zotero 10 already ships**:
   no reader colour presets, no Creator-column copy, no item-type filter, nothing
   inside the reader — a native feature is the answer, not a second copy (see the 2026-08-23 audit
   in session-notes). But "derived from, consolidates or visualises a native feature" is NOT
   duplication — the maintainer's rule (2026-08-23): Zest's job is exactly that. So the Venue
   column (one column across item types), the Authors columns (Creator column with rules), the
   panel's title / one-line author list / abstract (with the translation plugin's translations shown
   whole — read from Extra, never written) and its row of outbound links all stay. Filters compose with Zotero's own search rather than
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
5. **Full teardown restores Zotero exactly — and nothing else.** And the other way round: Zotero
   strips every registration under our plugin ID when a copy finishes shutting down (item-tree
   columns, item-pane sections, menus, reader listeners, the settings pane — `PluginAPIBase`'s
   shutdown observer). An in-place upgrade overlaps the outgoing copy's async teardown with the
   incoming copy's startup, so `hooks.ts` watches `Zotero.Plugins` and re-registers everything when
   the sweep hits a copy that is still alive. Every install has an uninstall that
   puts back the prototype method, the DOM, the stylesheet, the menus, the native tag selector and the
   native tab bar — verified per window and on plugin shutdown. A prototype hook goes back **only
   while our own wrapper is still the function on the prototype**: another plugin, or the incoming
   copy during an upgrade, may have wrapped on top of us, and restoring the original there would
   delete their hook. When that happens, leave the chain in place and switch our own wrapper off
   (`itemFilter.uninstall`, `uninstallTitleDecor`). The install side needs the same test before it
   unwinds a previous wrapper. **The same rule covers the plugin's own global**: `onShutdown` hands
   `Zotero[addonInstance]` back only when it still points at this copy's `addon`, and `index.ts`
   claims it whenever this copy has no `addon` yet. Deleting a global the incoming copy already owns
   leaves a running plugin with no handle — the UI keeps working and `Zotero.Zest.api` is gone.
6. **Never touch the user's own Zotero.** Development runs against `.scaffold/dev-profile` only; the
   kill command is scoped to that path. Do not read, write or launch `/Applications/Zotero.app` with
   the user's profile.
7. **Render paths stay cheap, and hidden surfaces compute nothing.** `dataProvider` and `renderCell`
   run per row per frame: no DB call, no recursive walk, no JSON parse, no network. Anything expensive
   is precomputed off the render path and repainted through `refreshItems` / `redraw`. A surface that
   is off screen does no work at all: the nested tag tree stops refreshing behind the "All" tab and
   while its master switch is off (`treeActive` in `tags/nestedTree.ts`). The other half of that deal
   is that everything which brings it back — a tab, the toolbar menu, Settings, a hand-edited pref —
   goes through `syncTagPanes`, which refetches; skip it and the pane returns showing stale tags.
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
- Zotero fires a preference observer on an **exact** pref name — a prefix or branch registration never
  fires (verified on 10.0). So every preference a column reads while drawing has to be named in one of
  the two lists in `columns/index.ts`: `dataProvider` reads need `refreshAllRows` (the row cache holds
  the old value), `renderCell` reads need `redrawAll`. Adding a control to `preferences.xhtml` without
  adding its pref there produces a setting that silently does nothing until something else invalidates
  the tree.
- **Fixing a class of bug means sweeping its siblings**: after any fix, `grep -rn` the repo for
  the same shape and fix or report every other instance (the 2026-08-25 audit found three shipped
  fixes — CRLF preservation, `onItemChange` visibility, `keepZero` — whose twins were missed).
  Method wrappers use `utils/wrap.ts` (per-copy alive set) — never restore "the original"
  unconditionally.
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
scripts/dev-eval.sh -f scripts/phase-f-probe.js   # read-status derivation + picker, IF heat, removals
scripts/dev-eval.sh -f scripts/upgrade-probe.js   # DESTRUCTIVE: shuts the plugin down; restart after
scripts/dev-shot.py out.png [selector] [--dark|--light|--prefs|--stats|--matrix]
```

A change is done when all four probes pass, `tsc` and `eslint` are clean, and — for anything visual —
a screenshot in both themes shows the result. Prefs defaults only load at plugin startup: after editing
`addon/prefs.js`, restart the dev instance rather than relying on the hot reload.

When you touch one of the invariants above, add an assertion to `scripts/phase-e-probe.js` so the next
change cannot quietly undo it.

## Releasing

Releases are cut locally with the GitHub CLI after the verification above and GitHub CI both pass.
Publish the versioned `zest.xpi` first, then replace the rolling `release/update.json`, and independently
download both public assets to confirm the advertised version, URL and hash before reporting success.

GitHub Release notes are user-facing and bilingual: include only changes, fixes and upgrade guidance.
Do not include a `验证 / Validation` section, probe or test counts, lint/build details, archive checks,
SHA-512, MD5 or other checksum values. Keep that evidence in the task record rather than the Release body.
