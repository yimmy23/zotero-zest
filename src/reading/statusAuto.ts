import { getPref } from "../utils/prefs";
import { readingStore, keyOfItem } from "./store";
import { getReadStatus, setReadStatus, readThresholdMet } from "./status";

/**
 * Read-status automation that WRITES Extra (opt-out via prefs), modelled on
 * Zotero Reading List's behaviour so both plugins agree:
 *  - first sample of an item in this session and status is New / To Read
 *    (or empty, only if `statusAuto.markEmpty` is on) → "In Progress"
 *  - the item CROSSES the threshold during this session (pages seen ≥ x %
 *    of the primary attachment's pages and total ≥ minMinutes) → "Read".
 *    Items that already satisfy the threshold when the session starts are
 *    never re-marked, so a manual revert (Read → In Progress) is respected.
 *
 * The displayed status does not depend on this: `effectiveStatus()` derives
 * the same answer from the reading record without writing anything. This
 * layer only exists for people who want the status IN Extra — synced, and
 * visible to Reading List.
 */

const autoReadDone = new Set<string>();

/** Call once per item per session BEFORE the first sample is credited. */
export function seedAutoStatus(item: Zotero.Item) {
  try {
    if (readThresholdMet(readingStore.getForItem(item)))
      autoReadDone.add(keyOfItem(item));
  } catch {
    // never let bookkeeping throw into the tracker
  }
}

/** a reading session ended (tab/file closed): the next open starts afresh */
export function forgetAutoStatus(item: Zotero.Item) {
  try {
    autoReadDone.delete(keyOfItem(item));
  } catch {
    // ignore
  }
}

export async function onReadingStarted(item: Zotero.Item) {
  try {
    if (!getPref("statusAuto.enable")) return;
    if (!item.isRegularItem() || !item.isEditable()) return;
    const cur = getReadStatus(item);
    if (cur === "New" || cur === "To Read") {
      await setReadStatus(item, "In Progress");
    } else if (!cur && getPref("statusAuto.markEmpty")) {
      await setReadStatus(item, "In Progress");
    }
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
    if (!readThresholdMet(readingStore.getForItem(item))) return;
    autoReadDone.add(key);
    const cur = getReadStatus(item);
    if (cur === "Read" || cur === "Not Reading") return;
    if (!cur && !getPref("statusAuto.markEmpty")) return;
    await setReadStatus(item, "Read");
  } catch (e) {
    ztoolkit.log("[statusAuto] progress failed", e);
  }
}
