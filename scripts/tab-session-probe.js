/** Native exact-attachment round trip; isolated scaffold profile only. */
if (!/[\\/]\.scaffold[\\/]dev-data$/.test(Zotero.DataDirectory.dir))
  throw new Error(
    "This probe requires the isolated scaffold dev-data directory",
  );
const out = { ok: [], fail: [], notes: [] };
const check = (name, condition) => (condition ? out.ok : out.fail).push(name);
const win = Zotero.getMainWindow();
const tabs = win.Zotero_Tabs;
const previousSelected = tabs.selectedID;
const ownItems = [];
const sessionIDs = [];
const delay = (ms) => Zotero.Promise.delay(ms);
try {
  // The source must be a synthetic PDF already inside this disposable profile.
  const candidates = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID);
  let file;
  for (const item of candidates) {
    if (!item.isPDFAttachment?.()) continue;
    const path = await item.getFilePathAsync();
    if (
      path?.startsWith(Zotero.DataDirectory.dir + "/storage/") &&
      (await IOUtils.exists(path))
    ) {
      file = path;
      break;
    }
  }
  if (!file) throw new Error("Seed a synthetic PDF in the dev profile first");
  const parent = new Zotero.Item("journalArticle");
  parent.libraryID = Zotero.Libraries.userLibraryID;
  parent.setField("title", "Phase A exact session fixture");
  await parent.saveTx();
  ownItems.push(parent);
  const attachments = [];
  for (const title of ["Article", "Supplement"]) {
    const attachment = await Zotero.Attachments.importFromFile({
      file,
      parentItemID: parent.id,
    });
    attachments.push(attachment);
    ownItems.push(attachment);
    attachment.setField("title", title);
    await attachment.saveTx();
  }
  const note = new Zotero.Item("note");
  note.libraryID = parent.libraryID;
  note.parentID = parent.id;
  note.setNote("<p>Phase A session note</p>");
  await note.saveTx();
  ownItems.push(note);
  for (const attachment of attachments)
    await Zotero.Reader.open(attachment.id, undefined, {
      openInBackground: true,
    });
  await Zotero.Notes.open(note.id, undefined, { openInBackground: true });
  await delay(300);
  const supplementaryTab = tabs._tabs.find(
    (t) => t.data?.itemID === attachments[1].id,
  );
  if (!supplementaryTab) throw new Error("Supplementary reader did not open");
  tabs.select(supplementaryTab.id);
  await delay(100);
  const captured = dev.tabsSidebar.captureSession(win, "Phase A capture");
  if (!captured) throw new Error("Session not captured");
  sessionIDs.push(captured.id);
  const wanted = new Set([...attachments, note].map((i) => i.key));
  const entries = captured.items.filter(
    (e) => typeof e !== "string" && wanted.has(e.key),
  );
  check(
    "sessions.captureKeepsBothAttachmentsAndNote",
    entries.length === 3 &&
      entries[0].key === attachments[0].key &&
      entries[1].key === attachments[1].key &&
      entries[2].key === note.key &&
      entries[2].kind === "note",
  );
  check(
    "sessions.captureKeepsSelectedSupplement",
    captured.selected?.key === attachments[1].key,
  );
  const session = dev.tabsModel.saveSession(
    "Phase A round trip",
    entries,
    captured.selected,
  );
  sessionIDs.push(session.id);
  const documentIDs = new Set([...attachments, note].map((i) => i.id));
  for (const tab of [...tabs._tabs])
    if (documentIDs.has(tab.data?.itemID)) tabs.close(tab.id);
  await delay(300);
  await dev.tabsSidebar.restoreSession(win, session.id);
  const restored = tabs._tabs.filter((t) => documentIDs.has(t.data?.itemID));
  check(
    "sessions.nativeRestoreExactDocumentsAndOrder",
    JSON.stringify(restored.map((t) => t.data.itemID)) ===
      JSON.stringify([...attachments, note].map((i) => i.id)),
  );
  check(
    "sessions.nativeRestoreSelectedSupplement",
    restored.find((t) => t.id === tabs.selectedID)?.data.itemID ===
      attachments[1].id,
  );
} catch (e) {
  out.fail.push("sessions.probeCompleted");
  out.notes.push(String(e));
} finally {
  const ids = new Set(ownItems.map((i) => i.id));
  for (const tab of [...tabs._tabs])
    if (ids.has(tab.data?.itemID)) tabs.close(tab.id);
  await delay(200);
  for (const id of sessionIDs) dev.tabsModel.removeSession(id);
  for (const item of ownItems.reverse()) {
    try {
      if (Zotero.Items.exists(item.id)) await item.eraseTx();
    } catch (e) {
      out.fail.push("sessions.cleanup");
      out.notes.push(String(e));
    }
  }
  if (tabs._tabs.some((t) => t.id === previousSelected))
    tabs.select(previousSelected);
  await dev.zestConfig.flush();
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return JSON.stringify(out, null, 2);
