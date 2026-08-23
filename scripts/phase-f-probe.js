/**
 * Phase F probe — run inside the DEV Zotero instance:
 *   scripts/dev-eval.sh -f scripts/phase-f-probe.js
 *
 * Covers the 2026-08-23 round: the derived read status and its picker, the
 * IF heat ladder, and the removals (no Venue column, nothing registered in
 * the reader, no type-filter menu). Creates and deletes its own probe items,
 * restores every preference it touches, never talks to the network.
 */
const out = { zotero: Zotero.version, ok: [], fail: [], notes: [] };
const win = Zotero.getMainWindow();
const doc = win.document;
const delay = (ms) => Zotero.Promise.delay(ms);
const check = (name, cond, note) => {
  (cond ? out.ok : out.fail).push(name);
  if (note) out.notes.push(`${name}: ${note}`);
};
const prefKey = (name) => `extensions.zotero.zest.${name}`;
const saved = new Map();
const setPref = (name, value) => {
  if (!saved.has(name)) saved.set(name, Zotero.Prefs.get(prefKey(name), true));
  Zotero.Prefs.set(prefKey(name), value, true);
};
const mk = async (fields) => {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = 1;
  for (const [k, v] of Object.entries(fields)) item.setField(k, v);
  await item.saveTx();
  return item;
};
const trash = [];

/* ---------- 1. derived status: nothing to read → no opinion ---------- */
setPref("status.derive", true);
const bare = await mk({ title: "phase-f bare" });
trash.push(bare);
let eff = dev.status.effectiveStatus(bare);
check(
  "status.bare.none",
  eff.source === "none" && eff.status === "",
  JSON.stringify(eff),
);

/* ---------- 2. a set status wins, and clears back to automatic ---------- */
await dev.status.setReadStatus(bare, "To Read");
eff = dev.status.effectiveStatus(bare);
check("status.manual", eff.source === "manual" && eff.status === "To Read");
check(
  "status.extra.line",
  /^Read_Status: To Read$/m.test(bare.getField("extra")) &&
    /^Read_Status_Date: /m.test(bare.getField("extra")),
);
await dev.statusMenu.setStatusForAll([bare], null);
eff = dev.status.effectiveStatus(bare);
check(
  "status.cleared",
  eff.source === "none" && !/Read_Status/.test(bare.getField("extra")),
);

/* ---------- 3. derived from the reading record ---------- */
const read = await mk({ title: "phase-f read" });
trash.push(read);
dev.readingStore.addSample(read.libraryID, read.key, "", 0, 40, 0);
await delay(100);
eff = dev.status.effectiveStatus(read);
check(
  "status.auto.inProgress",
  eff.source === "auto" && eff.status === "In Progress",
  JSON.stringify(eff),
);
// enough pages + minutes → Read (thresholds from prefs)
setPref("statusAuto.readThreshold", 50);
setPref("statusAuto.minMinutes", 1);
for (let p = 0; p < 4; p++)
  dev.readingStore.addSample(read.libraryID, read.key, "", p, 20, 4);
await delay(100);
eff = dev.status.effectiveStatus(read);
check(
  "status.auto.read",
  eff.source === "auto" && eff.status === "Read",
  JSON.stringify(eff),
);
setPref("status.derive", false);
eff = dev.status.effectiveStatus(read);
check("status.derive.off", eff.source === "none");
setPref("status.derive", true);

/* ---------- 4. the Status column: dot + ring, picker opens and writes ---------- */
const view = win.ZoteroPane.itemsView;
await delay(400);
let rowIdx = -1;
for (let i = 0; i < view.rowCount; i++) {
  if (view.getRow(i).ref?.id === read.id) {
    rowIdx = i;
    break;
  }
}
if (rowIdx < 0) {
  out.notes.push("status.column: probe item not in the current view — skipped");
} else {
  view.ensureRowIsVisible(rowIdx);
  await delay(200);
  const rowEl = doc.querySelector(`#item-tree-main-default-row-${rowIdx}`);
  const dot = rowEl?.querySelector(".zest-status-dot");
  check(
    "status.column.ring",
    !!dot &&
      dot.classList.contains("zest-status-auto") &&
      dot.classList.contains("zest-status-read"),
    dot?.className,
  );
  const ring = dot && win.getComputedStyle(dot);
  check(
    "status.column.ringDrawn",
    !!ring &&
      ring.backgroundColor === "rgba(0, 0, 0, 0)" &&
      ring.borderTopWidth === "2px" &&
      ring.borderTopColor !== "rgba(0, 0, 0, 0)",
    ring &&
      `${ring.backgroundColor} / ${ring.borderTopWidth} ${ring.borderTopColor}`,
  );
  const mk2 = (t) =>
    new win.MouseEvent(t, {
      bubbles: true,
      cancelable: true,
      button: 0,
      view: win,
      screenX: 300,
      screenY: 300,
    });
  dot?.dispatchEvent(mk2("mousedown"));
  dot?.dispatchEvent(mk2("mouseup"));
  await delay(300);
  const popup = doc.querySelector("#zest-popupset menupopup");
  const labels = popup
    ? [...popup.querySelectorAll("menuitem")].map((m) =>
        m.getAttribute("label"),
      )
    : [];
  check(
    "status.picker.opens",
    !!popup && ["open", "showing"].includes(popup.state) && labels.length === 7,
    labels.join(" | "),
  );
  const checked =
    popup &&
    [...popup.querySelectorAll('menuitem[type="radio"]')].find(
      (m) => m.getAttribute("checked") === "true",
    );
  check(
    "status.picker.checked",
    !!checked &&
      checked.getAttribute("label") === dev.status.statusLabel("Read"),
  );
  const pick =
    popup && [...popup.querySelectorAll('menuitem[type="radio"]')][1]; // To Read
  pick?.dispatchEvent(new win.Event("command", { bubbles: true }));
  popup?.hidePopup?.();
  await delay(800);
  check(
    "status.picker.writes",
    dev.status.getReadStatus(read) === "To Read",
    dev.status.getReadStatus(read),
  );
  check("status.picker.closed", !doc.querySelector("#zest-popupset menupopup"));
  await dev.statusMenu.setStatusForAll([read], null);
}

/* ---------- 5. IF heat ladder ---------- */
const L = dev.pubTags.ifLevel;
check(
  "if.levels",
  L(0.5, 15) === 0 &&
    L(1, 15) === 1 &&
    L(3, 15) === 2 &&
    L(7.5, 15) === 3 &&
    L(15, 15) === 4 &&
    L(200, 15) === 4,
);
check("if.levels.scale", L(10, 100) === 1 && L(50, 100) === 3);
check(
  "if.prefs",
  ["heat", "bar", "none"].includes(
    String(Zotero.Prefs.get(prefKey("if.style"), true)),
  ),
  String(Zotero.Prefs.get(prefKey("if.style"), true)),
);

/* ---------- 6. removals ---------- */
check("removed.typeFilter", !dev.typeFilter);
check("removed.colorSchemes", !dev.colorSchemes);
const listeners = (Zotero.Reader._registeredListeners || [])
  .filter((l) => l.pluginID === "zest@zotero-zest.app")
  .map((l) => l.type);
check("reader.noListeners", listeners.length === 0, listeners.join(","));

/* ---------- restore ---------- */
for (const [name, value] of saved) {
  if (value === undefined) Zotero.Prefs.clear(prefKey(name), true);
  else Zotero.Prefs.set(prefKey(name), value, true);
}
for (const item of trash) {
  try {
    await dev.readingStore.clearItem(item.libraryID, item.key);
    await item.eraseTx();
  } catch (e) {
    out.notes.push(`cleanup failed: ${e}`);
  }
}
out.summary = `${out.ok.length} ok · ${out.fail.length} fail`;
return JSON.stringify(out, null, 1);
