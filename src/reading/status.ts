import { getExtraLine, setExtraLines } from "../utils/extra";
import { getPref, getNumPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { readingStore, pagesSeen, type ItemReading } from "./store";
import { hasReadableAttachment } from "../utils/items";

/**
 * Read status.
 *
 * Two layers, one answer:
 *
 *   manual  — `Read_Status: <label>` (+ `Read_Status_Date`) in Extra, the
 *             Zotero Reading List format. Written only on a user action (or by
 *             the opt-in automation in statusAuto.ts). Unknown labels (Reading
 *             List lets people rename statuses) are shown verbatim and sort
 *             after the built-ins.
 *   auto    — when Extra says nothing, the status is READ from what already
 *             happened: Zest's own reading record (seconds per page), Zotero's
 *             own last-read stamp and resume position (both synced, so a paper
 *             opened on another machine counts), and whether there is anything
 *             to read at all. Nothing is written; the value moves with the
 *             data, and a manual status always wins.
 *
 * `effectiveStatus()` is what every surface shows; `getReadStatus()` is only
 * the manual layer and is what the writers compare against.
 */

export const READ_STATUSES = [
  "New",
  "To Read",
  "In Progress",
  "Read",
  "Not Reading",
] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

export const STATUS_KEYS = ["Read_Status"];
export const STATUS_DATE_KEYS = ["Read_Status_Date"];

export const STATUS_SLUG: Record<string, string> = {
  New: "new",
  "To Read": "to-read",
  "In Progress": "in-progress",
  Read: "read",
  "Not Reading": "not-reading",
};

export type StatusSource = "manual" | "auto" | "none";
export interface EffectiveStatus {
  status: string;
  source: StatusSource;
}

/** a reading record shorter than this is a glance, not reading */
const IN_PROGRESS_MIN_SECONDS = 30;

/** the manual layer only: the Extra line, or "" */
export function getReadStatus(item: Zotero.Item): string {
  return getExtraLine(item, STATUS_KEYS)?.value?.trim() || "";
}

/** 0-4 for built-ins, 5 for custom labels, 6 for none — a sort rank */
export function statusRank(status: string): number {
  if (!status) return 6;
  const i = (READ_STATUSES as readonly string[]).indexOf(status);
  return i >= 0 ? i : 5;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "New":
      return getString("status-new");
    case "To Read":
      return getString("status-to-read");
    case "In Progress":
      return getString("status-in-progress");
    case "Read":
      return getString("status-read");
    case "Not Reading":
      return getString("status-not-reading");
    default:
      return status;
  }
}

export async function setReadStatus(
  item: Zotero.Item,
  status: string | null,
): Promise<void> {
  if (!item.isRegularItem()) return;
  if (!status) {
    await setExtraLines(item, [
      [STATUS_KEYS, null],
      [STATUS_DATE_KEYS, null],
    ]);
    return;
  }
  if (getReadStatus(item) === status) return;
  // one save: status + date together (one modify notification, one sync bump)
  await setExtraLines(item, [
    [STATUS_KEYS, status],
    [STATUS_DATE_KEYS, new Date().toISOString()],
  ]);
}

/* ------------------------------------------------------------------ */
/* the automatic layer                                                 */

/**
 * "Read" by Zest's own measure: the share of pages seen and the total time
 * both clear the thresholds in Settings. Shared by the derived status and by
 * the opt-in automation that writes Extra, so the two never disagree.
 */
export function readThresholdMet(rec: ItemReading | undefined): boolean {
  if (!rec || !rec.pages) return false;
  const threshold = getNumPref("statusAuto.readThreshold", 90) / 100;
  const minMinutes = getNumPref("statusAuto.minMinutes", 5);
  if (rec.total < minMinutes * 60) return false;
  return pagesSeen(rec) / rec.pages >= threshold;
}

/** Zotero 10's own synced signals: a last-read stamp on any attachment, or a
 *  saved resume position (which also exists for files read before 10.0) */
function zoteroSaysOpened(item: Zotero.Item): boolean {
  try {
    if ((item as any).getItemLastRead?.()) return true;
  } catch {
    // not an item that carries it
  }
  try {
    const atts = Zotero.Items.get(item.getAttachments(false)) as Zotero.Item[];
    for (const att of atts) {
      try {
        if (!att.isFileAttachment()) continue;
        const pos = (att as any).getAttachmentLastPageIndex?.();
        if (pos !== null && pos !== undefined && pos !== "") return true;
      } catch {
        // non-file attachment or unloaded
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * What the data says, for an item with no manual status:
 *   Read         pages seen and time both over the thresholds
 *   In Progress  a real reading record (≥ 30 s), or Zotero saw it opened /
 *                a page turned on some device
 *   New          there is something to read and nobody has opened it
 *   ""           nothing to read (no PDF / EPUB / snapshot) — no opinion
 */
export function deriveStatus(item: Zotero.Item): string {
  const rec = readingStore.getForItem(item);
  if (rec) {
    if (readThresholdMet(rec)) return "Read";
    if (rec.total >= IN_PROGRESS_MIN_SECONDS) return "In Progress";
  }
  if (zoteroSaysOpened(item)) return "In Progress";
  if (hasReadableAttachment(item)) return "New";
  return "";
}

/** the status every surface shows: manual first, then derived */
export function effectiveStatus(item: Zotero.Item): EffectiveStatus {
  const manual = getReadStatus(item);
  if (manual) return { status: manual, source: "manual" };
  if (!getPref("status.derive")) return { status: "", source: "none" };
  const derived = deriveStatus(item);
  return derived
    ? { status: derived, source: "auto" }
    : { status: "", source: "none" };
}
