import { config } from "../../../package.json";
import {
  zestConfig,
  newId,
  ConfigStore,
  type DatasetMeta,
} from "../../core/config";
import { normalizeJournal, allISSNs } from "../normalize";
import { parseRankNumber, type JCRMetadata, type RankValue } from "../types";
import { matchingJCRMetadata, sanitizeJCRMetadata } from "../impactFactor";
import { parseShowJCRRows } from "./showjcr";

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
 *
 * Zest's optional JCR schema (not an arbitrary raw JCR-export parser):
 *   JSON row.jcr = {year: 2024, impactFactor: 8.1,
 *                   categories: [{name: "Oncology", percentile: 91.2, rank?: "20/322"}]}
 *   CSV  sciif,jcrYear,jcrCategory,jifPercentile[,jcrRank]
 * Each journal occupies one row; JSON categories preserve multiple subjects.
 * The metric year and supplied percentile are required, never inferred from Q.
 * Scalar `jcr` remains an ordinary legacy rank field. Flat JCR columns opt in
 * only as the complete sciif/jcrYear/jcrCategory/jifPercentile column group;
 * without that group they remain ordinary custom fields (including jcrRank).
 */

export interface DatasetRow {
  name?: string;
  issn?: string;
  fields: Record<string, string>;
  jcr?: JCRMetadata;
}

interface LoadedDataset {
  id: string;
  byName: Map<string, DatasetRow | null>;
  byISSN: Map<string, DatasetRow>;
}

const loaded = new Map<string, LoadedDataset>();

interface DatasetSession {
  ready: Promise<void>;
  settled: Promise<void>;
  release: () => void;
}

// Plugin copies overlap during upgrades. Keep the handoff on the host, rather
// than either copy's addon object, so incoming config reads wait for the old
// copy's last dataset transaction AND final config flush.
const SESSION_KEY = "__zestDatasetPersistence";
let session: DatasetSession | undefined;
let datasetStopped = false;
let datasetEpoch = 0;
let datasetOperation: Promise<unknown> | undefined;
let finishingSession: Promise<void> | undefined;

export async function startDatasetSession(): Promise<void> {
  if (finishingSession) await finishingSession;
  if (!addon.data.alive) return;
  if (session) return session.ready;
  finishingSession = undefined;
  const host = Zotero as typeof Zotero & {
    [SESSION_KEY]?: DatasetSession;
  };
  const ready = host[SESSION_KEY]?.settled ?? Promise.resolve();
  let release!: () => void;
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  session = { ready, settled: ready.then(() => finished), release };
  host[SESSION_KEY] = session;
  datasetStopped = !addon.data.alive;
  await ready;
}

/** Cancel queued work; a transaction already touching disk must finish safely. */
export async function stopDatasetOperations(): Promise<void> {
  datasetStopped = true;
  datasetEpoch++;
  await datasetOperation?.catch(() => undefined);
}

/** The incoming copy may read configuration only after this final flush. */
export function finishDatasetSession(
  configReady?: Promise<unknown>,
): Promise<void> {
  // Both application and plugin cleanup can reach this entry point. Once the
  // lease is released, this copy must never flush its old config again.
  if (finishingSession) return finishingSession;
  const current = session;
  finishingSession = (async () => {
    try {
      await stopDatasetOperations();
      await current?.ready;
      // init() can still be reading or recovering a damaged config after the
      // hook's bounded startup wait. That recovery may rename a disk file, so
      // it belongs inside the same handoff as writes and the final flush.
      await configReady?.catch((error) =>
        ztoolkit.log("[rank] configuration initialization failed", error),
      );
      await zestConfig.shutdown();
    } finally {
      current?.release();
      const host = Zotero as typeof Zotero & {
        [SESSION_KEY]?: DatasetSession;
      };
      if (current && host[SESSION_KEY] === current) delete host[SESSION_KEY];
      if (session === current) session = undefined;
    }
  })();
  return finishingSession;
}

function queueDatasetOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (datasetStopped || !addon.data.alive)
    return Promise.reject(new Error("Dataset operation cancelled"));
  const epoch = datasetEpoch;
  const before = Promise.all([
    datasetOperation?.catch(() => undefined),
    session?.ready,
  ]);
  const next = before
    .then(() => {
      if (datasetStopped || epoch !== datasetEpoch || !addon.data.alive)
        throw new Error("Dataset operation cancelled");
      return operation();
    })
    .finally(() => {
      if (datasetOperation === next) datasetOperation = undefined;
    });
  datasetOperation = next;
  return next;
}

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
    const identifiers = new Set(allISSNs(r.issn));
    for (const [k, v] of Object.entries<any>(r.fields || {})) {
      if (typeof k !== "string" || !k) continue;
      const value = v === null || v === undefined ? "" : String(v);
      // Older imports accidentally stored second ISSN columns as metrics.
      // Repair only the in-memory index; the user's stored file is untouched.
      if (isISSNKey(k)) {
        for (const id of allISSNs(value)) identifiers.add(id);
        continue;
      }
      if (value) fields[k.slice(0, 60)] = value.slice(0, 120);
    }
    const name = typeof r.name === "string" ? r.name : undefined;
    const issn = [...identifiers].join(", ") || undefined;
    if (!name && !issn) continue;
    const jcr = localJCRMetadata(r.jcr, fields);
    out.push({ name, issn, fields, ...(jcr ? { jcr } : {}) });
  }
  return out;
}

function index(id: string, rows: DatasetRow[]) {
  const byName = new Map<string, DatasetRow | null>();
  const byISSN = new Map<string, DatasetRow>();
  // Index copies: duplicate records must not silently select category data by
  // file order, and marking them ambiguous must not mutate the imported file.
  for (const storedRow of rows) {
    const row = { ...storedRow };
    if (row.name) {
      const key = normalizeJournal(row.name);
      if (key && !byName.has(key)) byName.set(key, row);
      else if (key) {
        const previous = byName.get(key);
        // Same title with conflicting identifiers is ambiguous without an
        // ISSN. Never let file order decide which journal's metric is shown.
        const ids = allISSNs(row.issn);
        const previousIDs = allISSNs(previous?.issn);
        if (previous && previousIDs.some((id) => ids.includes(id))) {
          previous.jcr = undefined;
          row.jcr = undefined;
        }
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
        const previous = byISSN.get(key);
        if (!previous) byISSN.set(key, row);
        else {
          previous.jcr = undefined;
          row.jcr = undefined;
        }
      }
    }
  }
  loaded.set(id, { id, byName, byISSN });
}

/** synchronous lookup — datasets live in memory */
export function lookupDataset(
  normalizedName: string,
  issn?: string,
  /** Aliases already tied together by a journal catalogue or source record. */
  verifiedAliases: string[] = [],
): RankValue[] {
  return lookupDatasetRecord(normalizedName, issn, verifiedAliases).values;
}

/** Keep provenance coupled to the row that actually supplies standard JIF. */
export function lookupDatasetRecord(
  normalizedName: string,
  issn?: string,
  verifiedAliases: string[] = [],
): { values: RankValue[]; jcr?: JCRMetadata } {
  const out: RankValue[] = [];
  const seen = new Set<string>();
  let jcr: JCRMetadata | undefined;
  for (const ds of loaded.values()) {
    const required = allISSNs(issn);
    const identifiers = [...new Set([...required, ...verifiedAliases])];
    const named = ds.byName.get(normalizedName);
    const candidates = new Set(
      identifiers.map((id) => ds.byISSN.get(id)).filter(Boolean),
    );
    // Conflicting identifier rows are ambiguous, even if their titles agree.
    if (candidates.size > 1) continue;
    const identified = [...candidates][0];
    const rowIDs = allISSNs(identified?.issn);
    const identityMatches = required.every(
      (id) =>
        rowIDs.includes(id) ||
        (verifiedAliases.includes(id) &&
          rowIDs.some((known) => verifiedAliases.includes(known))),
    );
    const nameMatches =
      named && (!required.length || !allISSNs(named.issn).length);
    const row =
      (identityMatches ? identified : undefined) ||
      (nameMatches ? named : undefined);
    if (!row) continue;
    for (const [field, value] of Object.entries(row.fields)) {
      if (!value || seen.has(field.toLowerCase())) continue;
      seen.add(field.toLowerCase());
      out.push({ field, value: String(value), source: "dataset" });
      if (field.toLowerCase() === "sciif") jcr = row.jcr;
    }
  }
  return { values: out, ...(jcr ? { jcr } : {}) };
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
const ISSN_KEYS = [
  "issn",
  "issnl",
  "pissn",
  "eissn",
  "printissn",
  "electronicissn",
  "onlineissn",
  "国际标准刊号",
];
const JCR_KEYS = new Set([
  "jcryear",
  "jcrcategory",
  "jifpercentile",
  "jcrrank",
]);

/** Local files cannot claim that their independent data came from the API. */
function localJCRMetadata(
  raw: unknown,
  fields: Record<string, string>,
): JCRMetadata | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const candidate = raw as Record<string, unknown>;
  if (candidate.source !== undefined && candidate.source !== "dataset")
    return undefined;
  return matchingJCRMetadata(
    sanitizeJCRMetadata({ ...candidate, source: "dataset" }),
    Object.entries(fields).map(([field, value]) => ({
      field,
      value,
      source: "dataset",
    })),
  );
}

function isISSNKey(key: string) {
  return ISSN_KEYS.includes(
    key
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, ""),
  );
}

export function parseDataset(
  text: string,
  kind: "json" | "csv",
): ParsedDataset {
  return kind === "csv" ? parseCsvDataset(text) : parseJsonDataset(text);
}

function rowFrom(obj: Record<string, unknown>): DatasetRow | null {
  const fields: Record<string, string> = {};
  const metadata: Record<string, unknown> = {};
  const keys = new Set(Object.keys(obj).map((key) => key.trim().toLowerCase()));
  const hasFlatJCRSchema = [
    "sciif",
    "jcryear",
    "jcrcategory",
    "jifpercentile",
  ].every((key) => keys.has(key));
  let name: string | undefined;
  const identifiers = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = String(rawKey).trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (
      (lower === "jcr" &&
        rawValue !== null &&
        typeof rawValue === "object" &&
        !Array.isArray(rawValue)) ||
      (hasFlatJCRSchema && JCR_KEYS.has(lower))
    ) {
      metadata[lower] = rawValue;
      continue;
    }
    const value =
      rawValue === null || rawValue === undefined
        ? ""
        : String(rawValue).trim();
    if (!value) continue;
    if (!name && NAME_KEYS.includes(lower)) {
      name = value;
      continue;
    }
    if (isISSNKey(key)) {
      for (const id of allISSNs(value)) identifiers.add(id);
      continue;
    }
    fields[key] = value;
  }
  const issn = [...identifiers].join(", ") || undefined;
  if (!name && !issn) return null;
  const sciif = Object.entries(fields).find(
    ([field]) => field.toLowerCase() === "sciif",
  );
  const jcr = localJCRMetadata(
    metadata.jcr ?? {
      year: /^\d{4}$/.test(String(metadata.jcryear).trim())
        ? Number(metadata.jcryear)
        : undefined,
      impactFactor: sciif ? parseRankNumber(sciif[1]) : undefined,
      categories: [
        {
          name: metadata.jcrcategory,
          percentile: metadata.jifpercentile,
          ...(metadata.jcrrank ? { rank: metadata.jcrrank } : {}),
        },
      ],
    },
    fields,
  );
  return { name, issn, fields, ...(jcr ? { jcr } : {}) };
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
  const showjcr = parseShowJCRRows(rows);
  if (showjcr) return showjcr;
  // A broken ShowJCR table must not appear as a successful generic import.
  if (
    rows[0].some((h) => /^IF\(\d{4}\)$/i.test(h.trim())) &&
    rows[0].some((h) => /^(Category_|IF (Rank|Quartile)\()/i.test(h.trim()))
  )
    throw new Error("Invalid or mixed-year ShowJCR columns");
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
export function saveDataset(
  name: string,
  parsed: ParsedDataset,
): Promise<DatasetMeta> {
  return queueDatasetOperation(() => saveDatasetInner(name, parsed));
}

async function saveDatasetInner(
  name: string,
  parsed: ParsedDataset,
): Promise<DatasetMeta> {
  // Preserve the configured source order while the startup index is loading.
  await datasetsLoaded();
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

export const SHOWJCR_DATASET_ID = "showjcr-jcr";

/** Replace the managed table only after a complete download and parse. */
export function saveShowJCRDataset(
  parsed: ParsedDataset,
): Promise<DatasetMeta> {
  // Downloads coalesce at the transport layer. Distinct local imports run in
  // order so a later file is never reported as saved while silently discarded.
  return queueDatasetOperation(() => persistShowJCRDataset(parsed));
}

async function persistShowJCRDataset(
  parsed: ParsedDataset,
): Promise<DatasetMeta> {
  await datasetsLoaded();
  if (zestConfig.isDamaged)
    throw new Error("Configuration is damaged; import was not saved");
  if (!parsed.rows.length || !parsed.name.startsWith("ShowJCR"))
    throw new Error("No valid ShowJCR records");
  const id = SHOWJCR_DATASET_ID;
  const previous = zestConfig.get().datasets.find((entry) => entry.id === id);
  if (
    !previous &&
    zestConfig.get().datasets.length >= ConfigStore.LIMITS.datasets
  )
    throw new Error(`dataset limit reached (${ConfigStore.LIMITS.datasets})`);
  const path = filePath(id);
  const existed = await IOUtils.exists(path);
  const bytes = existed ? await IOUtils.read(path) : undefined;
  const meta: DatasetMeta = {
    id,
    name: parsed.name.slice(0, 120),
    rows: parsed.rows.length,
    fields: parsed.fields.slice(0, 80),
    updated: Date.now(),
  };
  const tmpPath = `${path}.tmp`;
  let replaced = false;
  let registered = false;
  try {
    await IOUtils.makeDirectory(dirPath(), { ignoreExisting: true });
    await IOUtils.writeUTF8(
      path,
      JSON.stringify({ v: 1, name: meta.name, rows: parsed.rows }),
      { tmpPath, flush: true },
    );
    replaced = true;
    zestConfig.update((draft) => {
      const at = draft.datasets.findIndex((entry) => entry.id === id);
      if (at >= 0) draft.datasets[at] = meta;
      else draft.datasets.push(meta);
    });
    registered = true;
    if (!zestConfig.get().datasets.some((entry) => entry.id === id))
      throw new Error("Dataset rejected by the configuration");
    await zestConfig.flush();
    // Publishing the index last keeps the old table visible on every failure.
    index(id, parsed.rows);
    return meta;
  } catch (error) {
    if (registered) {
      zestConfig.update((draft) => {
        const at = draft.datasets.findIndex((entry) => entry.id === id);
        if (previous && at >= 0) draft.datasets[at] = previous;
        else if (previous) draft.datasets.push(previous);
        else draft.datasets = draft.datasets.filter((entry) => entry.id !== id);
      });
    }
    if (replaced) {
      if (bytes) await IOUtils.write(path, bytes, { tmpPath, flush: true });
      else await IOUtils.remove(path, { ignoreAbsent: true });
    }
    if (registered) await zestConfig.flush();
    throw error;
  } finally {
    await IOUtils.remove(tmpPath, { ignoreAbsent: true }).catch((error) =>
      ztoolkit.log("[rank] ShowJCR temporary file cleanup failed", error),
    );
  }
}

export function removeDataset(id: string): Promise<void> {
  // All dataset writes share the shutdown barrier. A pending delete also
  // cannot overtake an import and remove its replacement file.
  return queueDatasetOperation(() => removeDatasetInner(id));
}

async function removeDatasetInner(id: string): Promise<void> {
  // An in-flight startup read must finish before its index can be removed.
  await datasetsLoaded();
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
