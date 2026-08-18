import { getExtraLine, setExtraLine } from "../utils/extra";

/**
 * Read status stored in Extra, compatible with the Zotero Reading List
 * plugin: `Read_Status: <label>` + `Read_Status_Date: <ISO 8601>`.
 * Unknown labels (users can rename statuses in Reading List) are shown
 * verbatim and sorted after the built-in ones.
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

export function getReadStatus(item: Zotero.Item): string {
  return getExtraLine(item, STATUS_KEYS)?.value?.trim() || "";
}

/** 0-4 for built-ins, 5 for custom labels, 6 for none — a sort rank */
export function statusRank(status: string): number {
  if (!status) return 6;
  const i = (READ_STATUSES as readonly string[]).indexOf(status);
  return i >= 0 ? i : 5;
}

export async function setReadStatus(
  item: Zotero.Item,
  status: string | null,
): Promise<void> {
  if (!item.isRegularItem()) return;
  if (!status) {
    await setExtraLine(item, STATUS_KEYS, null);
    await setExtraLine(item, STATUS_DATE_KEYS, null);
    return;
  }
  const changed = await setExtraLine(item, STATUS_KEYS, status);
  if (changed) {
    await setExtraLine(item, STATUS_DATE_KEYS, new Date().toISOString());
  }
}

/** next status in the cycle New → To Read → In Progress → Read → Not Reading → New */
export function nextStatus(cur: string): ReadStatus {
  const i = (READ_STATUSES as readonly string[]).indexOf(cur);
  return READ_STATUSES[(i + 1) % READ_STATUSES.length];
}
