import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { readingStore } from "./store";
import { askMergeMode } from "./exportImport";

/**
 * One-time importer for legacy zotero-style / Ethereal Style reading
 * records (spec: research/progress-storage.md §8).
 *
 * Generations recognised:
 *  G2  "Addon Item" (computerProgram) parent, one child note per paper:
 *      note text = `${itemKey}\n{"readingTime":{"page":N,"data":{"0":sec,…}}}`
 *      (page indexes 0-based; a `"-1"` key = the PR #801 off-by-one build →
 *      shift the whole record by +1)
 *  G1  "ZoteroStyle" parent, notes `{pageTime:{…}, pageNum, noteKey|itemKey, title}`
 *  G3  JSON file (`storage.in = file`): `{ "<itemKey>": { readingTime: {…} } }`
 *      (older: keyed by numeric item.id — converted on this machine only)
 *  also `<dataDir>/zoterostyle.json` (publication-tag cache that may carry
 *  readingTime), and legacy prefs pointing at the parents.
 *
 * Read-only w.r.t. legacy data: nothing is deleted or modified. All
 * libraries are scanned INCLUDING the trash (the old plugin kept writing
 * to trashed Addon Items). Duplicate records for one item merge per-page
 * with max by default (a File-mode copy of the same data would otherwise
 * double the count); the user can pick "sum" instead.
 */

export interface LegacyRecord {
  libraryID: number;
  itemKey: string;
  itemID?: number;
  totalPages: number;
  secondsByPage: Map<number, number>;
  source: { kind: "note" | "note-v1" | "file"; ref: string };
  offsetFixed?: boolean;
  unresolved?: boolean;
}

export interface ScanReport {
  parents: number;
  notes: number;
  parsed: number;
  skipped: number;
  files: number;
  offsetFixed: number;
  unresolved: number;
  merged: number;
  totalSeconds: number;
  details: string[];
}

const LEGACY_TITLES = ["Addon Item", "ZoteroStyle"];

function unescapeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function parseLegacyNote(
  noteHTML: string,
): { key?: string; payload: any } | null {
  if (!noteHTML) return null;
  const text = unescapeEntities(noteHTML.replace(/<[^>]+>/g, "\n"));
  const brace = text.indexOf("{");
  if (brace < 0) return null;
  const head = text.slice(0, brace).trim();
  const end = text.lastIndexOf("}");
  if (end < brace) return null;
  let payload: any;
  try {
    payload = JSON.parse(text.slice(brace, end + 1));
  } catch {
    return null;
  }
  const keyMatch = head.match(/([A-Z0-9]{8})\s*$/);
  return { key: keyMatch ? keyMatch[1] : undefined, payload };
}

/** Normalise `{page, data}` → Map (with -1 detection). */
function normalisePages(data: any): {
  map: Map<number, number>;
  offsetFixed: boolean;
} {
  const map = new Map<number, number>();
  if (!data || typeof data !== "object") return { map, offsetFixed: false };
  const entries: Array<[number, number]> = [];
  for (const [k, v] of Object.entries(data)) {
    const idx = Number(k);
    const sec = Number(v);
    if (!Number.isInteger(idx) || !Number.isFinite(sec) || sec <= 0) continue;
    entries.push([idx, sec]);
  }
  const offsetFixed = entries.some(([i]) => i === -1);
  for (const [i, s] of entries) {
    const idx = offsetFixed ? i + 1 : i;
    if (idx < 0) continue;
    map.set(idx, (map.get(idx) || 0) + s);
  }
  return { map, offsetFixed };
}

function recordFromPayload(
  payload: any,
  keyHint: string | undefined,
  libraryID: number,
  source: LegacyRecord["source"],
): LegacyRecord | null {
  // G2
  if (payload?.readingTime && typeof payload.readingTime === "object") {
    const rt = payload.readingTime;
    const { map, offsetFixed } = normalisePages(rt.data);
    if (!map.size) return null;
    let maxIdx = -1;
    for (const i of map.keys()) if (i > maxIdx) maxIdx = i;
    const totalPages = Math.max(Number(rt.page) || 0, maxIdx + 1);
    if (!keyHint) return null;
    return {
      libraryID,
      itemKey: keyHint,
      totalPages,
      secondsByPage: map,
      source,
      offsetFixed,
    };
  }
  // G1
  if (payload?.pageTime && typeof payload.pageTime === "object") {
    const { map, offsetFixed } = normalisePages(payload.pageTime);
    if (!map.size) return null;
    let maxIdx = -1;
    for (const i of map.keys()) if (i > maxIdx) maxIdx = i;
    const key = payload.noteKey || payload.itemKey || keyHint;
    if (!key || !/^[A-Z0-9]{8}$/.test(String(key))) return null;
    return {
      libraryID,
      itemKey: String(key),
      totalPages: Math.max(Number(payload.pageNum) || 0, maxIdx + 1),
      secondsByPage: map,
      source: { kind: "note-v1", ref: source.ref },
      offsetFixed,
    };
  }
  return null;
}

/** Find candidate parents + notes via SQL (fast, includes trash). */
async function scanNotes(report: ScanReport): Promise<LegacyRecord[]> {
  const out: LegacyRecord[] = [];
  const titles = LEGACY_TITLES.map(() => "?").join(",");
  const rows: any[] =
    (await Zotero.DB.queryAsync(
      `SELECT p.libraryID AS libraryID, p.key AS parentKey, v.value AS parentTitle,
            n.itemID AS noteID, ni.key AS noteKey, n.note AS note
     FROM items p
     JOIN itemData d ON d.itemID = p.itemID
     JOIN fieldsCombined f ON f.fieldID = d.fieldID AND f.fieldName = 'title'
     JOIN itemDataValues v ON v.valueID = d.valueID
     JOIN itemTypes t ON t.itemTypeID = p.itemTypeID AND t.typeName = 'computerProgram'
     JOIN itemNotes n ON n.parentItemID = p.itemID
     JOIN items ni ON ni.itemID = n.itemID
     WHERE v.value IN (${titles})`,
      LEGACY_TITLES,
    )) || [];
  const parents = new Set<string>();
  for (const r of rows) {
    parents.add(`${r.libraryID}/${r.parentKey}`);
    report.notes++;
    const parsed = parseLegacyNote(r.note);
    if (!parsed) {
      report.skipped++;
      continue;
    }
    const rec = recordFromPayload(parsed.payload, parsed.key, r.libraryID, {
      kind: "note",
      ref: `${r.libraryID}/${r.parentKey}/${r.noteKey}`,
    });
    if (!rec) {
      report.skipped++;
      continue;
    }
    report.parsed++;
    if (rec.offsetFixed) report.offsetFixed++;
    out.push(rec);
  }
  report.parents = parents.size;
  return out;
}

async function scanFile(
  path: string,
  report: ScanReport,
): Promise<LegacyRecord[]> {
  const out: LegacyRecord[] = [];
  try {
    if (!(await IOUtils.exists(path))) return out;
    const text = (await Zotero.File.getContentsAsync(path)) as string;
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return out;
    report.files++;
    const userLib = Zotero.Libraries.userLibraryID;
    for (const [k, v] of Object.entries<any>(data)) {
      let key = k;
      let lib = userLib;
      if (/^\d+$/.test(k)) {
        // G3a: keyed by item.id (only meaningful on this machine)
        const item = Zotero.Items.get(Number(k)) as Zotero.Item | false;
        if (!item) {
          report.skipped++;
          continue;
        }
        key = item.key;
        lib = item.libraryID;
      }
      if (!/^[A-Z0-9]{8}$/.test(key)) continue;
      const rec = recordFromPayload(v, key, lib, { kind: "file", ref: path });
      if (!rec) continue;
      report.parsed++;
      if (rec.offsetFixed) report.offsetFixed++;
      out.push(rec);
    }
  } catch (e) {
    report.details.push(`file ${path}: ${e}`);
  }
  return out;
}

function resolveItem(rec: LegacyRecord) {
  const tryLib = (lib: number) => {
    try {
      const it = Zotero.Items.getByLibraryAndKey(lib, rec.itemKey);
      return it && it.isRegularItem() ? it : null;
    } catch {
      return null;
    }
  };
  let item = tryLib(rec.libraryID);
  if (!item) {
    for (const lib of Zotero.Libraries.getAll()) {
      if (lib.libraryID === rec.libraryID) continue;
      item = tryLib(lib.libraryID);
      if (item) {
        rec.libraryID = lib.libraryID;
        break;
      }
    }
  }
  if (item) rec.itemID = item.id;
  else rec.unresolved = true;
}

export async function scanLegacy(extraFiles: string[] = []): Promise<{
  records: LegacyRecord[];
  report: ScanReport;
}> {
  const report: ScanReport = {
    parents: 0,
    notes: 0,
    parsed: 0,
    skipped: 0,
    files: 0,
    offsetFixed: 0,
    unresolved: 0,
    merged: 0,
    totalSeconds: 0,
    details: [],
  };
  const records: LegacyRecord[] = [];
  try {
    records.push(...(await scanNotes(report)));
  } catch (e) {
    report.details.push(`notes: ${e}`);
  }
  const files = new Set<string>(extraFiles);
  try {
    const f = Zotero.Prefs.get(
      "extensions.zotero.zoterostyle.storage.filename",
      true,
    );
    if (typeof f === "string" && f) files.add(f);
  } catch {
    // ignore
  }
  files.add(PathUtils.join(Zotero.DataDirectory.dir, "zoterostyle.json"));
  for (const f of files) records.push(...(await scanFile(f, report)));
  for (const r of records) {
    resolveItem(r);
    if (r.unresolved) report.unresolved++;
    for (const s of r.secondsByPage.values()) report.totalSeconds += s;
  }
  return { records, report };
}

/** Merge into the store (per (library,key)); unresolved records are kept
 *  under their original key so they revive if the item is restored. */
export async function applyLegacy(
  records: LegacyRecord[],
  mode: "max" | "sum",
  report: ScanReport,
  onProgress?: (done: number, total: number) => void,
) {
  // coalesce duplicates first (same item from several notes/files) with max,
  // then merge into the store with the chosen mode
  const byKey = new Map<string, LegacyRecord>();
  for (const r of records) {
    const k = `${r.libraryID}/${r.itemKey}`;
    const cur = byKey.get(k);
    if (!cur) {
      byKey.set(k, { ...r, secondsByPage: new Map(r.secondsByPage) });
      continue;
    }
    for (const [i, s] of r.secondsByPage) {
      cur.secondsByPage.set(i, Math.max(cur.secondsByPage.get(i) || 0, s));
    }
    cur.totalPages = Math.max(cur.totalPages, r.totalPages);
  }
  let done = 0;
  for (const r of byKey.values()) {
    await readingStore.mergeRecord(
      {
        libraryID: r.libraryID,
        itemKey: r.itemKey,
        pages: r.totalPages,
        page: r.secondsByPage,
      },
      mode,
    );
    report.merged++;
    onProgress?.(++done, byKey.size);
  }
}

/** Menu entry: scan → confirm → merge → report. */
export async function migrateLegacyUI() {
  const win = Zotero.getMainWindow();
  const pw = new ztoolkit.ProgressWindow(getString("migrate-title"), {
    closeTime: -1,
    closeOtherProgressWindows: true,
  })
    .createLine({ text: getString("migrate-scanning"), type: "default" })
    .show();
  const { records, report } = await scanLegacy();
  pw.close();
  if (!records.length) {
    Services.prompt.alert(
      win as any,
      getString("migrate-title"),
      getString("migrate-nothing", {
        args: { parents: report.parents, notes: report.notes },
      }),
    );
    return;
  }
  const hours = (report.totalSeconds / 3600).toFixed(1);
  const mode = askMergeMode(records.length);
  if (!mode) return;
  const pw2 = new ztoolkit.ProgressWindow(getString("migrate-title"), {
    closeTime: -1,
    closeOtherProgressWindows: true,
  })
    .createLine({ text: `0/${records.length}`, type: "default", progress: 0 })
    .show();
  await applyLegacy(records, mode, report, (d, t) =>
    pw2.changeLine({ text: `${d}/${t}`, progress: (d / t) * 100 }),
  );
  pw2.changeLine({
    text: getString("migrate-done", {
      args: { merged: report.merged, hours },
    }),
    type: "success",
    progress: 100,
  });
  pw2.startCloseTimer(5000);
  const summary = [
    getString("migrate-report-line", {
      args: {
        parents: report.parents,
        notes: report.notes,
        parsed: report.parsed,
        skipped: report.skipped,
        files: report.files,
        offset: report.offsetFixed,
        unresolved: report.unresolved,
        merged: report.merged,
        hours,
      },
    }),
    ...report.details.slice(0, 10),
    "",
    getString("migrate-legacy-kept"),
  ].join("\n");
  Services.prompt.alert(win as any, getString("migrate-title"), summary);
  ztoolkit.log(`[${config.addonName}] migration report`, report);
}
