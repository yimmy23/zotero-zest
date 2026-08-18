import { getPref, getNumPref } from "../utils/prefs";
import { readingStore, keyOfItem } from "./store";
import { getReadStatus, setReadStatus } from "./status";

/**
 * Read-status automation (opt-out via prefs):
 *  - first sample of an item in this session and status is empty / New /
 *    To Read → "In Progress"
 *  - pages seen ≥ threshold % of the attachment's pages and total time ≥
 *    minMinutes → "Read" (at most once per item per session, so a manual
 *    revert is not fought)
 */

const autoReadDone = new Set<string>();

export async function onReadingStarted(item: Zotero.Item) {
  try {
    if (!getPref("statusAuto.enable")) return;
    if (!item.isRegularItem() || !item.isEditable()) return;
    const cur = getReadStatus(item);
    if (cur && cur !== "New" && cur !== "To Read") return;
    await setReadStatus(item, "In Progress");
  } catch (e) {
    ztoolkit.log("[statusAuto] start failed", e);
  }
}

export async function onReadingProgress(item: Zotero.Item) {
  try {
    if (!getPref("statusAuto.enable")) return;
    if (!item.isRegularItem() || !item.isEditable()) return;
    const key = keyOfItem(item);
    if (autoReadDone.has(key)) return;
    const rec = readingStore.getForItem(item);
    if (!rec || !rec.pages) return;
    const threshold = getNumPref("statusAuto.readThreshold", 90) / 100;
    const minMinutes = getNumPref("statusAuto.minMinutes", 5);
    if (rec.total < minMinutes * 60) return;
    let seen = 0;
    for (const s of rec.page.values()) if (s >= 5) seen++;
    if (seen / rec.pages < threshold) return;
    const cur = getReadStatus(item);
    if (cur === "Read" || cur === "Not Reading") {
      autoReadDone.add(key);
      return;
    }
    autoReadDone.add(key);
    await setReadStatus(item, "Read");
  } catch (e) {
    ztoolkit.log("[statusAuto] progress failed", e);
  }
}
