import { getExtraLine } from "./extra";

const LEGACY_KEYS = ["Citation Key"];
const keyText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** BBT 6/7+ expose a synchronous cache lookup; fill/update would generate keys. */
function cachedBetterBibTeXKey(item: Zotero.Item): string {
  try {
    if (!Number.isSafeInteger(item.id) || item.id <= 0) return "";
    const manager = (Zotero as any).BetterBibTeX?.KeyManager;
    if (typeof manager?.get !== "function") return "";
    // Keep the receiver: current BBT uses a private #keys member in get().
    const record = manager.get(item.id);
    if (!record || typeof record !== "object") return "";
    // A future async API must not create an unhandled rejection or a late UI
    // update. This adapter deliberately reads only the supported sync cache.
    if (typeof record.then === "function") {
      void Promise.resolve(record).catch(() => {});
      return "";
    }
    if (
      (record.itemID !== undefined && record.itemID !== item.id) ||
      (record.libraryID !== undefined && record.libraryID !== item.libraryID) ||
      (record.itemKey !== undefined && record.itemKey !== item.key)
    )
      return "";
    return keyText(record.citationKey);
  } catch {
    // Optional provider: startup, shutdown or an unavailable cache is empty.
    return "";
  }
}

/** Read an existing writing key; Zotero's internal item.key is unrelated. */
export function citationKeyOf(item: Zotero.Item): string {
  try {
    const native = keyText(item.getField("citationKey"));
    if (native) return native;
  } catch {
    // Older item APIs may not expose the native field; Extra is read-only.
  }
  try {
    const legacy = keyText(getExtraLine(item, LEGACY_KEYS)?.value);
    if (legacy) return legacy;
  } catch {
    // A malformed third-party getter must not take down the information pane.
  }
  return cachedBetterBibTeXKey(item);
}
