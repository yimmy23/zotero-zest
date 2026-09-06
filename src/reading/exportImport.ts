import { csvCell } from "../utils/csv";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { readingStore, dayOf } from "./store";

/**
 * Reading data export / import — first-class citizens.
 *
 * JSON (lossless, importable):
 * { "format": "zest-reading", "version": 2, "exported": ISO,
 *   "items": [ { libraryID, library, itemKey, title?, pages, firstRead, lastRead,
 *                pages_seconds: { "<pageIndex>": sec }, days: { "YYYY-MM-DD": sec } } ] }
 * CSV (long format, importable): libraryID,itemKey,title,kind,key,seconds
 *   kind = "page" (key = 0-based page index) | "day" (key = YYYY-MM-DD) | "meta"
 *   (key = pages|firstRead|lastRead).
 * `library` carries a stable group/user identity; libraryID is only a local
 * hint for older readers. Imports validate the target before merging. Legacy
 * files without identity are accepted only when their item key is unique.
 */

export interface ExportedAtt {
  pages: number;
  pages_seconds: Record<string, number>;
}
export interface ExportedLibrary {
  type: "user" | "group" | "local";
  groupID?: number;
  userID?: number;
  /** Identifies an unsynced profile, never a credential. */
  localUserKey?: string;
}
export interface ExportedItem {
  libraryID: number;
  library?: ExportedLibrary;
  itemKey: string;
  title?: string;
  /** primary attachment's page count / page map (display view) */
  pages: number;
  pages_seconds: Record<string, number>;
  /** per-attachment maps; attKey '' = unattributed (legacy imports) */
  attachments?: Record<string, ExportedAtt>;
  firstRead: number;
  lastRead: number;
  days: Record<string, number>;
}

function libraryIdentity(libraryID: number): ExportedLibrary {
  try {
    const type = Zotero.Libraries.getType(libraryID);
    if (type === "group") {
      return {
        type,
        groupID: Zotero.Groups.getGroupIDFromLibraryID(libraryID),
      };
    }
    if (type === "user") {
      const userID = Zotero.Users.getCurrentUserID();
      return userID
        ? { type, userID }
        : { type, localUserKey: Zotero.Users.getLocalUserKey() };
    }
    return { type: "local", localUserKey: Zotero.Users.getLocalUserKey() };
  } catch {
    // Unknown identity must not be mistaken for a legacy portable record.
    return { type: "local" };
  }
}

function readLibrary(raw: any): ExportedLibrary | undefined {
  if (raw === undefined) return undefined;
  if (!raw || !["user", "group", "local"].includes(raw.type))
    return { type: "local" };
  const positiveID = (v: any) =>
    Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
  return {
    type: raw.type,
    userID: positiveID(raw?.userID),
    groupID: positiveID(raw?.groupID),
    localUserKey:
      typeof raw?.localUserKey === "string" &&
      /^[a-z0-9]{8}$/i.test(raw.localUserKey)
        ? raw.localUserKey
        : undefined,
  };
}

function titleOf(libraryID: number, itemKey: string): string {
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    return item ? (item.getField("title") as string) || "" : "";
  } catch {
    return "";
  }
}

export function collectExport(): ExportedItem[] {
  const out: ExportedItem[] = [];
  for (const it of readingStore.items.values()) {
    if (!it.total) continue;
    const pages_seconds: Record<string, number> = {};
    for (const [i, s] of it.page) pages_seconds[String(i)] = s;
    const attachments: Record<string, ExportedAtt> = {};
    for (const [ak, a] of it.atts) {
      const ps: Record<string, number> = {};
      for (const [i, s] of a.page) ps[String(i)] = s;
      attachments[ak] = { pages: a.pages, pages_seconds: ps };
    }
    const days: Record<string, number> = {};
    for (const [d, s] of it.days) days[d] = s;
    out.push({
      libraryID: it.libraryID,
      library: libraryIdentity(it.libraryID),
      itemKey: it.itemKey,
      title: titleOf(it.libraryID, it.itemKey),
      pages: it.pages,
      pages_seconds,
      attachments,
      firstRead: it.firstRead,
      lastRead: it.lastRead,
      days,
    });
  }
  out.sort((a, b) => b.lastRead - a.lastRead);
  return out;
}

export function toJSON(items: ExportedItem[]): string {
  return JSON.stringify(
    {
      format: "zest-reading",
      version: 2,
      exported: new Date().toISOString(),
      items,
    },
    null,
    1,
  );
}

export function toCSV(items: ExportedItem[]): string {
  const rows = [
    "libraryID,itemKey,title,kind,key,seconds,attKey,libraryType,libraryUserID,libraryGroupID,libraryLocalKey",
  ];
  for (const it of items) {
    const base = `${it.libraryID},${it.itemKey},${csvCell(it.title || "")}`;
    const library = [
      it.library?.type,
      it.library?.userID,
      it.library?.groupID,
      it.library?.localUserKey,
    ]
      .map((v) => csvCell(String(v ?? "")))
      .join(",");
    const push = (kind: string, key: string, seconds: number, attKey = "") =>
      rows.push(
        `${base},${kind},${key},${seconds},${csvCell(attKey)},${library}`,
      );
    push("meta", "firstRead", it.firstRead);
    push("meta", "lastRead", it.lastRead);
    const atts = it.attachments || {
      "": { pages: it.pages, pages_seconds: it.pages_seconds },
    };
    for (const [ak, a] of Object.entries(atts)) {
      push("meta", "pages", a.pages, ak);
      for (const [k, s] of Object.entries(a.pages_seconds))
        push("page", k, s, ak);
    }
    for (const [k, s] of Object.entries(it.days)) push("day", k, s);
  }
  return rows.join("\n") + "\n";
}

/** minimal RFC-4180 parser (quotes, escaped quotes, CRLF) */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}

export function fromCSV(text: string): ExportedItem[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iLib = col("libraryid"),
    iKey = col("itemkey"),
    iTitle = col("title"),
    iKind = col("kind"),
    iK = col("key"),
    iSec = col("seconds"),
    iAtt = col("attkey"),
    iType = col("librarytype"),
    iUser = col("libraryuserid"),
    iGroup = col("librarygroupid"),
    iLocal = col("librarylocalkey");
  if (iLib < 0 || iKey < 0 || iKind < 0 || iK < 0 || iSec < 0) {
    throw new Error(
      "CSV header must contain libraryID,itemKey,kind,key,seconds",
    );
  }
  const map = new Map<string, ExportedItem>();
  for (const r of rows.slice(1)) {
    const libraryID = Number(r[iLib]);
    const itemKey = (r[iKey] || "").trim();
    if (!Number.isInteger(libraryID) || !/^[A-Z0-9]{8}$/.test(itemKey))
      continue;
    const library = readLibrary(
      iType >= 0 && r[iType]
        ? {
            type: r[iType],
            userID: r[iUser],
            groupID: r[iGroup],
            localUserKey: r[iLocal],
          }
        : undefined,
    );
    const id = `${JSON.stringify(library)}/${libraryID}/${itemKey}`;
    let it = map.get(id);
    if (!it) {
      it = {
        libraryID,
        library,
        itemKey,
        title: iTitle >= 0 ? r[iTitle] : "",
        pages: 0,
        pages_seconds: {},
        attachments: {},
        firstRead: 0,
        lastRead: 0,
        days: {},
      };
      map.set(id, it);
    }
    const kind = (r[iKind] || "").trim();
    const key = (r[iK] || "").trim();
    const sec = Number(r[iSec]);
    const ak = iAtt >= 0 ? (r[iAtt] || "").trim() : "";
    if (ak && !/^[A-Z0-9]{8}$/.test(ak)) continue;
    // only rows that carry page data create an attachment entry: the day and
    // first/last-read rows have an empty attachment column, and making an ""
    // attachment for them put a phantom bucket on every imported item
    const att = () => (it.attachments![ak] ??= { pages: 0, pages_seconds: {} });
    if (kind === "page") {
      if (/^(-1|\d+)$/.test(key) && Number.isFinite(sec) && sec > 0)
        att().pages_seconds[key] = sec;
    } else if (kind === "day") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(sec) && sec > 0)
        it.days[key] = sec;
    } else if (kind === "meta") {
      if (key === "pages") att().pages = sec | 0;
      else if (key === "firstRead") it.firstRead = sec | 0;
      else if (key === "lastRead") it.lastRead = sec | 0;
    }
  }
  return [...map.values()];
}

export function fromJSON(text: string): ExportedItem[] {
  const data = JSON.parse(text);
  const list: any[] = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(list)) throw new Error("not a zest-reading export");
  const out: ExportedItem[] = [];
  const readPages = (src: any): Record<string, number> => {
    const ps: Record<string, number> = {};
    for (const [k, v] of Object.entries(src || {})) {
      if (/^(-1|\d+)$/.test(k) && Number.isFinite(Number(v)) && Number(v) > 0)
        ps[k] = Number(v);
    }
    return ps;
  };
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const libraryID = Number(raw.libraryID);
    const itemKey = String(raw.itemKey || "");
    if (!Number.isInteger(libraryID) || !/^[A-Z0-9]{8}$/.test(itemKey))
      continue;
    const attachments: Record<string, ExportedAtt> = {};
    if (raw.attachments && typeof raw.attachments === "object") {
      for (const [ak, a] of Object.entries<any>(raw.attachments)) {
        if (ak && !/^[A-Z0-9]{8}$/.test(ak)) continue;
        attachments[ak] = {
          pages: Number(a?.pages) | 0,
          pages_seconds: readPages(a?.pages_seconds || a?.page),
        };
      }
    } else {
      attachments[""] = {
        pages: Number(raw.pages) | 0,
        pages_seconds: readPages(raw.pages_seconds || raw.page),
      };
    }
    const days: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.days || {})) {
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(k) &&
        Number.isFinite(Number(v)) &&
        Number(v) > 0
      )
        days[k] = Number(v);
    }
    out.push({
      libraryID,
      library: readLibrary(raw.library),
      itemKey,
      title: typeof raw.title === "string" ? raw.title : "",
      pages: Number(raw.pages) | 0,
      pages_seconds: readPages(raw.pages_seconds || raw.page),
      attachments,
      firstRead: Number(raw.firstRead) | 0,
      lastRead: Number(raw.lastRead) | 0,
      days,
    });
  }
  return out;
}

export interface ImportResult {
  /** Successfully merged records; retained for existing callers. */
  items: number;
  matched: number;
  /** All unimported records, including ambiguous keys. */
  skipped: number;
  ambiguous: number;
  seconds: number;
}

function validTarget(libraryID: number, key: string): boolean {
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
    return (
      !!item &&
      !item.deleted &&
      (item.isRegularItem() || (item.isAttachment() && !item.parentID))
    );
  } catch {
    return false;
  }
}

function resolveLibrary(
  it: ExportedItem,
  libraryIDs: number[],
): number | "missing" | "ambiguous" {
  if (!/^[A-Z0-9]{8}$/.test(it.itemKey)) return "missing";
  const identity = it.library;
  if (identity) {
    let libraryID: number | false = false;
    try {
      if (identity.type === "group" && identity.groupID) {
        libraryID = Zotero.Groups.getLibraryIDFromGroupID(identity.groupID);
      } else if (identity.type === "user") {
        const sameUser = identity.userID
          ? identity.userID === Zotero.Users.getCurrentUserID()
          : !!identity.localUserKey &&
            identity.localUserKey === Zotero.Users.getLocalUserKey();
        if (sameUser) libraryID = Zotero.Libraries.userLibraryID;
      } else if (
        identity.type === "local" &&
        identity.localUserKey &&
        identity.localUserKey === Zotero.Users.getLocalUserKey()
      ) {
        libraryID = it.libraryID;
      }
    } catch {
      return "missing";
    }
    return libraryID !== false && validTarget(libraryID, it.itemKey)
      ? libraryID
      : "missing";
  }
  // A machine-local libraryID cannot disambiguate another computer's export.
  // Check every current library, so a duplicate key is reported, not guessed.
  const matches = libraryIDs.filter((id) => validTarget(id, it.itemKey));
  return matches.length === 1
    ? matches[0]
    : matches.length
      ? "ambiguous"
      : "missing";
}

/** Resolve portable identities, validate targets, then merge matched records. */
export async function importItems(
  items: ExportedItem[],
  mode: "max" | "sum",
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = {
    items: 0,
    matched: 0,
    skipped: 0,
    ambiguous: 0,
    seconds: 0,
  };
  let libraryIDs: number[] = [];
  try {
    libraryIDs = Zotero.Libraries.getAll().map((lib) => lib.libraryID);
  } catch {
    // Stable identities can still resolve if library enumeration is unavailable.
  }
  for (const [index, it] of items.entries()) {
    const libraryID = resolveLibrary(it, libraryIDs);
    if (typeof libraryID !== "number") {
      result.skipped++;
      if (libraryID === "ambiguous") result.ambiguous++;
      onProgress?.(index + 1, items.length);
      continue;
    }
    const atts = it.attachments || {
      "": { pages: it.pages, pages_seconds: it.pages_seconds },
    };
    await readingStore.mergeRecord(
      {
        libraryID,
        itemKey: it.itemKey,
        atts: Object.fromEntries(
          Object.entries(atts).map(([ak, a]) => [
            ak,
            { pages: a.pages, page: a.pages_seconds },
          ]),
        ),
        days: it.days,
        firstRead: it.firstRead,
        lastRead: it.lastRead,
      },
      mode,
    );
    for (const a of Object.values(atts))
      for (const s of Object.values(a.pages_seconds)) result.seconds += s;
    result.items++;
    result.matched++;
    onProgress?.(index + 1, items.length);
  }
  return result;
}

/* ---------------- UI entry points (file pickers) ---------------- */

export async function exportReadingDataUI(format: "json" | "csv") {
  await readingStore.load();
  if (!readingStore.loaded) {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text: getString("db-unavailable"), type: "fail" })
      .show();
    return;
  }
  const items = collectExport();
  if (!items.length) {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text: getString("export-nothing"), type: "default" })
      .show();
    return;
  }
  const ext = format === "json" ? "json" : "csv";
  const name = `zest-reading-${dayOf()}.${ext}`;
  const picker = new ztoolkit.FilePicker(
    getString("export-title"),
    "save",
    [[format.toUpperCase(), `*.${ext}`]],
    name,
  );
  const path = await picker.open();
  if (!path) return;
  const text = format === "json" ? toJSON(items) : toCSV(items);
  await Zotero.File.putContentsAsync(path, text);
  new ztoolkit.ProgressWindow(config.addonName)
    .createLine({
      text: getString("export-done", { args: { count: items.length } }),
      type: "success",
    })
    .show();
}

/** Ask merge mode: 0 = max, 1 = sum, 2 = cancel */
export function askMergeMode(count: number): "max" | "sum" | null {
  const win = Zotero.getMainWindow();
  const ps = Services.prompt as any;
  const flags =
    ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING +
    ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING +
    ps.BUTTON_POS_2 * ps.BUTTON_TITLE_CANCEL;
  const idx = ps.confirmEx(
    win as any,
    getString("import-title"),
    getString("import-mode-question", { args: { count } }),
    flags,
    getString("import-mode-max"),
    getString("import-mode-sum"),
    "",
    "",
    {} as any,
  );
  return idx === 0 ? "max" : idx === 1 ? "sum" : null;
}

export async function importReadingDataUI() {
  const picker = new ztoolkit.FilePicker(getString("import-title"), "open", [
    ["JSON / CSV", "*.json; *.csv"],
  ]);
  const path = await picker.open();
  if (!path) return;
  let items: ExportedItem[];
  try {
    const text = (await Zotero.File.getContentsAsync(path)) as string;
    items = /\.csv$/i.test(path) ? fromCSV(text) : fromJSON(text);
  } catch (e) {
    Services.prompt.alert(
      Zotero.getMainWindow() as any,
      getString("import-title"),
      getString("import-parse-failed", { args: { error: String(e) } }),
    );
    return;
  }
  if (!items.length) {
    Services.prompt.alert(
      Zotero.getMainWindow() as any,
      getString("import-title"),
      getString("import-nothing"),
    );
    return;
  }
  const mode = askMergeMode(items.length);
  if (!mode) return;
  const pw = new ztoolkit.ProgressWindow(getString("import-title"), {
    closeTime: -1,
    closeOtherProgressWindows: true,
  })
    .createLine({ text: `0/${items.length}`, type: "default", progress: 0 })
    .show();
  let res: ImportResult;
  try {
    res = await importItems(items, mode, (done, total) =>
      pw.changeLine({
        text: `${done}/${total}`,
        progress: (done / total) * 100,
      }),
    );
  } catch (e) {
    // the database refused (locked, read-only): say so instead of leaving a
    // progress window hanging at n/N
    ztoolkit.log("[import] failed", e);
    pw.changeLine({
      text: getString("import-write-failed", { args: { error: String(e) } }),
      type: "fail",
      progress: 100,
    });
    pw.startCloseTimer(6000);
    return;
  }
  pw.changeLine({
    text: getString("import-result", {
      args: {
        count: res.items,
        hours: (res.seconds / 3600).toFixed(1),
        skipped: res.skipped,
        ambiguous: res.ambiguous,
      },
    }),
    type: res.skipped ? "default" : "success",
    progress: 100,
  });
  pw.startCloseTimer(4000);
}
