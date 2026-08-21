/**
 * Upgrade-ordering probe — run inside the DEV Zotero instance:
 *   scripts/dev-eval.sh -f scripts/upgrade-probe.js
 *
 * DESTRUCTIVE: it shuts the plugin down. Restart the dev instance afterwards.
 * That is why it lives outside the phase probes.
 *
 * On an upgrade Zotero loads the NEW copy before the old one shuts down, so
 * every teardown has to ask "is this still mine?" before putting anything
 * back. The prototype hooks are covered non-destructively in phase-e; the
 * plugin's own global (`Zotero.Zest`) can only be checked by really running
 * onShutdown, which is what this does.
 *
 * Symptom when it regresses: the plugin keeps working — columns, tag pane,
 * everything the new copy installed — but `Zotero.Zest` is undefined, so every
 * note template and script that calls `Zotero.Zest.api` fails with
 * `can't access property "api", Zotero.Zest is undefined`.
 */
const out = { ok: [], fail: [], notes: [] };
const check = (n, c, note) => {
  (c ? out.ok : out.fail).push(n);
  if (note) out.notes.push(`${n}: ${note}`);
};

const outgoing = Zotero.Zest;
check("global.presentBeforeShutdown", !!outgoing?.api);

// the incoming copy claims the name while the old copy is still alive
const incoming = { __incomingCopy: true, api: { marker: 1 } };
Zotero.Zest = incoming;

await outgoing.hooks.onShutdown();

check(
  "global.outgoingCopyLeavesTheNewOneAlone",
  Zotero.Zest === incoming,
  `Zotero.Zest is ${typeof Zotero.Zest}`,
);
check("global.apiStillReachableAfterUpgrade", Zotero.Zest?.api?.marker === 1);

out.notes.push("the plugin is now shut down — restart the dev instance");
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 1);
