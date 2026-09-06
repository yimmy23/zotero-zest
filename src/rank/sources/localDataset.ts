import { config } from "../../../package.json";
import {
  zestConfig,
  newId,
  ConfigStore,
  type DatasetMeta,
} from "../../core/config";
import { normalizeJournal, normalizeISSN, allISSNs } from "../normalize";
import type { RankValue } from "../types";

/**
 * Local rank datasets — a user's own journal list (their institution's
 * ranking, a JCR export, a lab spreadsheet).
 *
 * This is the FIRST source in the chain: it is offline, free, and the user
 * owns it, so it wins over anything fetched. Each dataset is one JSON file in
 * `<dataDir>/zest-datasets/<id>.json`; the metadata (name, row count, fields)
 * lives in zest-config.json so the settings pane can list them without
 * loading megabytes.
 *
 * Accepted input:
 *   JSON  { "v": 1, "name": "...", "rows": [ {name?, issn?, ...fields} ] }
 *         or a bare array of such rows
 *   CSV   a header row with `name` and/or `issn`, every other column a field
 */

export interface DatasetRow {
  name?: string;
  issn?: string;
  fields: Record<string, string>;
}

interface LoadedDataset {
  id: string;
  byName: Map<string, DatasetRow | null>;
  byISSN: Map<string, DatasetRow>;
}

const loaded = new Map<string, LoadedDataset>();

function dirPath(): string {
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    `${config.addonRef}-datasets`,
  );
}

function filePath(id: string): string {
  return PathUtils.join(dirPath(), `${id}.json`);
}

/** resolves when the datasets are in memory (the lookup queue waits on it) */
let loading: Promise<void> | undefined;

export function datasetsLoaded(): Promise<void> {
  return loading ?? Promise.resolve();
}

/** load every registered dataset into memory (called once at startup) */
export async function loadDatasets() {
  loading = loadDatasetsInner();
  await loading;
}

async function loadDatasetsInner() {
  loaded.clear();
  for (const meta of zestConfig.get().datasets) {
    try {
      const path = filePath(meta.id);
      if (!(await IOUtils.exists(path))) continue;
      const raw = (await Zotero.File.getContentsAsync(path)) as string;
      // our own file already stores DatasetRow[] ({name, issn, fields}); it
      // must NOT go through the flat-object parser again, which would turn the
      // nested `fields` object into a field literally called "fields"
      const rows = readStoredRows(raw);
      index(meta.id, rows);
    } catch (e) {
      ztoolkit.log(`[rank] dataset ${meta.id} failed to load`, e);
    }
  }
}

/** parse a file written by saveDataset (with a tolerant fallback) */
function readStoredRows(raw: string): DatasetRow[] {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed?.rows;
  if (!Array.isArray(list)) return [];
  const looksStored = list.some(
    (r: any) =>
      r && typeof r === "object" && r.fields && typeof r.fields === "object",
  );
  if (!looksStored) return parseDataset(raw, "json").rows;
  const out: DatasetRow[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(r.fields || {})) {
      if (typeof k !== "string" || !k) continue;
      const value = v === null || v === undefined ? "" : String(v);
      if (value) fields[k.slice(0, 60)] = value.slice(0, 120);
    }
    const name = typeof r.name === "string" ? r.name : undefined;
    const issn = typeof r.issn === "string" ? r.issn : undefined;
    if (!name && !issn) continue;
    out.push({ name, issn, fields });
  }
  return out;
}

function index(id: string, rows: DatasetRow[]) {
  const byName = new Map<string, DatasetRow | null>();
  const byISSN = new Map<string, DatasetRow>();
  for (const row of rows) {
    if (row.name) {
      const key = normalizeJournal(row.name);
      if (key && !byName.has(key)) byName.set(key, row);
      else if (key) {
        const previous = byName.get(key);
        // Same title with conflicting identifiers is ambiguous without an
        // ISSN. Never let file order decide which journal's metric is shown.
        const ids = allISSNs(row.issn);
        const previousIDs = allISSNs(previous?.issn);
        if (
          !previous ||
          !ids.length ||
          !previousIDs.some((id) => ids.includes(id))
        ) {
          byName.set(key, null);
        }
      }
    }
    if (row.issn) {
      for (const key of allISSNs(row.issn)) {
        if (!byISSN.has(key)) byISSN.set(key, row);
      }
    }
  }
  loaded.set(id, { id, byName, byISSN });
}

/** synchronous lookup — datasets live in memory */
export function lookupDataset(
  normalizedName: string,
  issn?: string,
): RankValue[] {
  const out: RankValue[] = [];
  const seen = new Set<string>();
  for (const ds of loaded.values()) {
    const cleanISSN = normalizeISSN(issn);
    const named = ds.byName.get(normalizedName);
    const nameMatches =
      named &&
      (!cleanISSN ||
        !allISSNs(named.issn).length ||
        allISSNs(named.issn).includes(cleanISSN));
    const row =
      (cleanISSN ? ds.byISSN.get(cleanISSN) : undefined) ||
      (nameMatches ? named : undefined);
    if (!row) continue;
    for (const [field, value] of Object.entries(row.fields)) {
      if (!value || seen.has(field.toLowerCase())) continue;
      seen.add(field.toLowerCase());
      out.push({ field, value: String(value), source: "dataset" });
    }
  }
  return out;
}

export interface ParsedDataset {
  name: string;
  rows: DatasetRow[];
  fields: string[];
}

const NAME_KEYS = [
  "name",
  "journal",
  "publication",
  "title",
  "刊名",
  "期刊",
  "期刊名称",
];
const ISSN_KEYS = ["issn", "issn-l", "eissn", "国际标准刊号"];

export function parseDataset(
  text: string,
  kind: "json" | "csv",
): ParsedDataset {
  return kind === "csv" ? parseCsvDataset(text) : parseJsonDataset(text);
}

function rowFrom(obj: Record<string, unknown>): DatasetRow | null {
  const fields: Record<string, string> = {};
  let name: string | undefined;
  let issn: string | undefined;
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = String(rawKey).trim();
    if (!key) continue;
    const value =
      rawValue === null || rawValue === undefined
        ? ""
        : String(rawValue).trim();
    if (!value) continue;
    const lower = key.toLowerCase();
    if (!name && NAME_KEYS.includes(lower)) {
      name = value;
      continue;
    }
    if (!issn && ISSN_KEYS.includes(lower)) {
      issn = value;
      continue;
    }
    fields[key] = value;
  }
  if (!name && !issn) return null;
  return { name, issn, fields };
}

function parseJsonDataset(text: string): ParsedDataset {
  const parsed = JSON.parse(text);
  const list: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.rows)
      ? parsed.rows
      : [];
  const rows: DatasetRow[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = rowFrom(entry as Record<string, unknown>);
    if (row) rows.push(row);
  }
  const fields = new Set<string>();
  for (const r of rows) for (const f of Object.keys(r.fields)) fields.add(f);
  return {
    name: String(parsed?.name || "").slice(0, 80) || "dataset",
    rows,
    fields: [...fields],
  };
}

/** RFC-4180-ish CSV: quotes, embedded commas and newlines */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    // RFC 4180: a bare quote inside an unquoted cell is literal text —
    // flipping into quoted mode swallowed the rest of the row silently
    else if (c === '"') cell += '"';
    else if (c === "," || c === "\t") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

function parseCsvDataset(text: string): ParsedDataset {
  const rows = parseCsvRows(text);
  if (!rows.length) return { name: "dataset", rows: [], fields: [] };
  const header = rows[0].map((h) => h.trim());
  const out: DatasetRow[] = [];
  for (const line of rows.slice(1)) {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) obj[h] = (line[i] ?? "").trim();
    });
    const row = rowFrom(obj);
    if (row) out.push(row);
  }
  const fields = new Set<string>();
  for (const r of out) for (const f of Object.keys(r.fields)) fields.add(f);
  return { name: "dataset", rows: out, fields: [...fields] };
}

/** persist a parsed dataset and register it in the config */
export async function saveDataset(
  name: string,
  parsed: ParsedDataset,
): Promise<DatasetMeta> {
  // the config caps the number of datasets and sanitising silently keeps the
  // FIRST N — so refuse here instead of writing a file nobody will ever read
  if (zestConfig.get().datasets.length >= ConfigStore.LIMITS.datasets) {
    throw new Error(`dataset limit reached (${ConfigStore.LIMITS.datasets})`);
  }
  const id = newId("ds");
  const meta: DatasetMeta = {
    id,
    name: name.slice(0, 120) || parsed.name,
    rows: parsed.rows.length,
    fields: parsed.fields.slice(0, 80),
    updated: Date.now(),
  };
  // register first: if the config rejects it, no orphan file is left behind
  zestConfig.update((draft) => {
    draft.datasets.push(meta);
  });
  if (!zestConfig.get().datasets.some((d) => d.id === id)) {
    throw new Error("dataset rejected by the configuration");
  }
  await IOUtils.makeDirectory(dirPath(), { ignoreExisting: true });
  await Zotero.File.putContentsAsync(
    filePath(id),
    JSON.stringify({ v: 1, name, rows: parsed.rows }),
  );
  index(id, parsed.rows);
  return meta;
}

export async function removeDataset(id: string) {
  zestConfig.update((draft) => {
    draft.datasets = draft.datasets.filter((d) => d.id !== id);
  });
  loaded.delete(id);
  try {
    await IOUtils.remove(filePath(id), { ignoreAbsent: true });
  } catch (e) {
    ztoolkit.log("[rank] dataset delete failed", e);
  }
}

export function datasetFields(): string[] {
  const out = new Set<string>();
  for (const meta of zestConfig.get().datasets) {
    for (const f of meta.fields) out.add(f);
  }
  return [...out];
}
