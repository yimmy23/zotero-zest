import { config } from "../../package.json";
import { setTimeout, clearTimeout } from "../utils/timers";

/**
 * `<dataDir>/zest-config.json` — user configuration that is too structured
 * for a pref: column view groups, tag rules, imported rank-dataset metadata.
 *
 * Why a file and not Zotero's SyncedSettings: the sync server only accepts a
 * fixed whitelist of setting keys, so a custom key would silently break the
 * user's sync (verified against the dataserver's Settings whitelist during
 * Phase A). Instead the file lives next to zotero.sqlite and the settings
 * pane offers explicit export/import.
 *
 * Everything is validated on the way in and on the way out — the file is user
 * editable and travels between machines.
 */

export const CONFIG_VERSION = 1;

export interface ViewGroupColumn {
  dataKey: string;
  width?: number;
  hidden?: boolean;
  ordinal?: number;
}

export interface ViewGroup {
  id: string;
  name: string;
  columns: ViewGroupColumn[];
  sortField?: string;
  /** 1 = ascending, -1 = descending (Zotero's own convention) */
  sortDirection?: number;
}

/** local colour/emoji rule for a tag prefix (Zotero only has 9 colour slots) */
export interface TagRule {
  /** tag prefix, e.g. "Method/" — matched case-sensitively like Zotero tags */
  prefix: string;
  color?: string;
  textColor?: string;
  emoji?: string;
}

export interface DatasetMeta {
  id: string;
  name: string;
  rows: number;
  fields: string[];
  updated: number;
}

/** a tab group: members are `${libraryID}/${itemKey}`, so they survive restarts */
export interface TabGroupConfig {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
  members: string[];
}

export interface TabSessionConfig {
  id: string;
  name: string;
  saved: number;
  items: string[];
}

export interface ZestConfig {
  v: number;
  viewGroups: ViewGroup[];
  tagRules: TagRule[];
  datasets: DatasetMeta[];
  tabGroups: TabGroupConfig[];
  tabSessions: TabSessionConfig[];
}

const EMPTY: ZestConfig = {
  v: CONFIG_VERSION,
  viewGroups: [],
  tagRules: [],
  datasets: [],
  tabGroups: [],
  tabSessions: [],
};

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length <= max ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const colour = (v: unknown): string | undefined => {
  const s = str(v, 32);
  return s && /^(#[0-9a-f]{3,8}|auto|)$/i.test(s.trim()) ? s.trim() : undefined;
};

function sanitizeViewGroup(raw: any): ViewGroup | null {
  const name = str(raw?.name, 80);
  if (!name) return null;
  const columns: ViewGroupColumn[] = [];
  if (Array.isArray(raw.columns)) {
    for (const c of raw.columns.slice(0, 60)) {
      const dataKey = str(c?.dataKey, 120);
      if (!dataKey) continue;
      const w = num(c?.width);
      const o = num(c?.ordinal);
      columns.push({
        dataKey,
        width:
          w !== undefined
            ? Math.max(20, Math.min(2000, Math.round(w)))
            : undefined,
        hidden: c?.hidden === true,
        ordinal: o !== undefined ? Math.max(0, Math.round(o)) : undefined,
      });
    }
  }
  if (!columns.length) return null;
  const dir = num(raw.sortDirection);
  return {
    id: str(raw.id, 40) || `vg${Math.abs(hash(name + columns.length))}`,
    name,
    columns,
    sortField: str(raw.sortField, 120),
    sortDirection: dir === -1 || dir === 1 ? dir : undefined,
  };
}

function sanitizeTagRule(raw: any): TagRule | null {
  const prefix = str(raw?.prefix, 200);
  if (!prefix) return null;
  const emoji = str(raw?.emoji, 8);
  return {
    prefix,
    color: colour(raw?.color),
    textColor: colour(raw?.textColor),
    emoji: emoji || undefined,
  };
}

function sanitizeDataset(raw: any): DatasetMeta | null {
  const id = str(raw?.id, 60);
  const name = str(raw?.name, 120);
  if (!id || !name || !/^[a-z0-9_-]+$/i.test(id)) return null;
  return {
    id,
    name,
    rows: Math.max(0, Math.round(num(raw?.rows) ?? 0)),
    fields: Array.isArray(raw?.fields)
      ? (raw.fields
          .map((f: unknown) => str(f, 60))
          .filter(Boolean)
          .slice(0, 80) as string[])
      : [],
    updated: Math.max(0, Math.round(num(raw?.updated) ?? 0)),
  };
}

function sanitizeKeyList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is string => typeof m === "string" && m.length <= 80)
    .slice(0, max);
}

function sanitizeTabGroup(raw: any): TabGroupConfig | null {
  const name = str(raw?.name, 60);
  if (!name) return null;
  return {
    id: str(raw?.id, 40) || newId("tg"),
    name,
    color: colour(raw?.color),
    collapsed: raw?.collapsed === true,
    members: sanitizeKeyList(raw?.members, 500),
  };
}

function sanitizeTabSession(raw: any): TabSessionConfig | null {
  const name = str(raw?.name, 60);
  if (!name) return null;
  return {
    id: str(raw?.id, 40) || newId("ts"),
    name,
    saved: Math.max(0, Math.round(num(raw?.saved) ?? 0)),
    items: sanitizeKeyList(raw?.items, 200),
  };
}

export function sanitizeConfig(raw: any): ZestConfig {
  const out: ZestConfig = {
    v: CONFIG_VERSION,
    viewGroups: [],
    tagRules: [],
    datasets: [],
    tabGroups: [],
    tabSessions: [],
  };
  if (!raw || typeof raw !== "object") return out;
  const seen = new Set<string>();
  for (const g of Array.isArray(raw.viewGroups)
    ? raw.viewGroups.slice(0, 50)
    : []) {
    const vg = sanitizeViewGroup(g);
    if (!vg || seen.has(vg.id)) continue;
    seen.add(vg.id);
    out.viewGroups.push(vg);
  }
  const prefixes = new Set<string>();
  for (const r of Array.isArray(raw.tagRules)
    ? raw.tagRules.slice(0, 200)
    : []) {
    const rule = sanitizeTagRule(r);
    if (!rule || prefixes.has(rule.prefix)) continue;
    prefixes.add(rule.prefix);
    out.tagRules.push(rule);
  }
  const ids = new Set<string>();
  for (const d of Array.isArray(raw.datasets)
    ? raw.datasets.slice(0, 20)
    : []) {
    const ds = sanitizeDataset(d);
    if (!ds || ids.has(ds.id)) continue;
    ids.add(ds.id);
    out.datasets.push(ds);
  }
  const groupIDs = new Set<string>();
  for (const g of Array.isArray(raw.tabGroups)
    ? raw.tabGroups.slice(0, 100)
    : []) {
    const group = sanitizeTabGroup(g);
    if (!group || groupIDs.has(group.id)) continue;
    groupIDs.add(group.id);
    out.tabGroups.push(group);
  }
  const sessionIDs = new Set<string>();
  for (const entry of Array.isArray(raw.tabSessions)
    ? raw.tabSessions.slice(0, 20)
    : []) {
    const session = sanitizeTabSession(entry);
    if (!session || sessionIDs.has(session.id)) continue;
    sessionIDs.add(session.id);
    out.tabSessions.push(session);
  }
  return out;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export class ConfigStore {
  private data: ZestConfig = { ...EMPTY };
  private path = "";
  private loaded = false;
  private writeTimer?: number;
  private listeners = new Set<() => void>();

  async init() {
    if (this.loaded) return;
    try {
      this.path = PathUtils.join(
        Zotero.DataDirectory.dir,
        `${config.addonRef}-config.json`,
      );
      if (await IOUtils.exists(this.path)) {
        const raw = (await Zotero.File.getContentsAsync(this.path)) as string;
        this.data = sanitizeConfig(JSON.parse(raw));
      }
    } catch (e) {
      ztoolkit.log("[zest] config load failed", e);
      this.data = { ...EMPTY };
    }
    this.loaded = true;
    // readers that memoised the empty default before the file resolved must be
    // told: rules.ts caches on first read and an empty array is truthy
    this.notify();
  }

  private notify() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        ztoolkit.log("[zest] config listener failed", e);
      }
    }
  }

  get(): Readonly<ZestConfig> {
    return this.data;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** mutate + persist; the callback gets a deep copy it may edit freely */
  update(mutate: (draft: ZestConfig) => void) {
    const draft: ZestConfig = JSON.parse(JSON.stringify(this.data));
    mutate(draft);
    this.data = sanitizeConfig(draft);
    this.scheduleWrite();
    this.notify();
  }

  /** how many entries of each kind sanitizeConfig will keep */
  static readonly LIMITS = { viewGroups: 50, tagRules: 200, datasets: 20 };

  private scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      this.flush().catch((e) => ztoolkit.log("[zest] config write failed", e));
    }, 600);
  }

  async flush() {
    if (!this.loaded || !this.path) return;
    await Zotero.File.putContentsAsync(
      this.path,
      JSON.stringify(this.data, null, 1),
    );
  }

  async shutdown() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    try {
      await this.flush();
    } catch (e) {
      ztoolkit.log("[zest] config flush on shutdown failed", e);
    }
  }
}

export const zestConfig = new ConfigStore();

/* ------------------------------------------------------------------ */
/* whole-configuration export / import (settings pane + Tools menu)    */
/* ------------------------------------------------------------------ */

const PREF_ROOT = `extensions.zotero.${config.addonRef}.`;
/** never exported: credentials live in the login manager, not in a backup */
const SECRET_MARKERS = [
  "secret",
  "secretkey",
  "apikey",
  "api_key",
  "token",
  "password",
];

export interface ConfigBundle {
  kind: "zest-config";
  v: number;
  exported: string;
  app: { zotero: string; zest: string };
  prefs: Record<string, string | number | boolean>;
  config: ZestConfig;
}

function isSecret(name: string) {
  const l = name.toLowerCase();
  return SECRET_MARKERS.some((s) => l.includes(s));
}

export function exportBundle(): ConfigBundle {
  const prefs: Record<string, string | number | boolean> = {};
  try {
    const branch = Services.prefs.getBranch(PREF_ROOT);
    for (const name of branch.getChildList("")) {
      if (isSecret(name)) continue;
      switch (branch.getPrefType(name)) {
        case Services.prefs.PREF_STRING:
          prefs[name] = branch.getStringPref(name);
          break;
        case Services.prefs.PREF_INT:
          prefs[name] = branch.getIntPref(name);
          break;
        case Services.prefs.PREF_BOOL:
          prefs[name] = branch.getBoolPref(name);
          break;
      }
    }
  } catch (e) {
    ztoolkit.log("[zest] pref export failed", e);
  }
  return {
    kind: "zest-config",
    v: CONFIG_VERSION,
    exported: new Date().toISOString(),
    app: { zotero: Zotero.version, zest: config.addonRef },
    prefs,
    config: JSON.parse(JSON.stringify(zestConfig.get())),
  };
}

export interface ImportReport {
  prefs: number;
  viewGroups: number;
  tagRules: number;
  datasets: number;
  skipped: number;
}

/**
 * Import a bundle. Only prefs that already exist on our default branch are
 * accepted (so a stale or hostile file cannot create arbitrary preferences),
 * and only with their declared type.
 */
export function importBundle(raw: any, replace: boolean): ImportReport {
  const report: ImportReport = {
    prefs: 0,
    viewGroups: 0,
    tagRules: 0,
    datasets: 0,
    skipped: 0,
  };
  if (!raw || raw.kind !== "zest-config")
    throw new Error("not a Zest configuration file");
  const defaults = Services.prefs.getDefaultBranch(PREF_ROOT);
  const branch = Services.prefs.getBranch(PREF_ROOT);
  const known = new Set(defaults.getChildList(""));
  for (const [name, value] of Object.entries<any>(raw.prefs || {})) {
    if (!known.has(name) || isSecret(name)) {
      report.skipped++;
      continue;
    }
    try {
      switch (defaults.getPrefType(name)) {
        case Services.prefs.PREF_STRING:
          if (typeof value !== "string" || value.length > 20000)
            throw new Error("type");
          branch.setStringPref(name, value);
          break;
        case Services.prefs.PREF_INT:
          if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error("type");
          branch.setIntPref(name, Math.round(value));
          break;
        case Services.prefs.PREF_BOOL:
          if (typeof value !== "boolean") throw new Error("type");
          branch.setBoolPref(name, value);
          break;
        default:
          throw new Error("type");
      }
      report.prefs++;
    } catch {
      report.skipped++;
    }
  }
  const incoming = sanitizeConfig(raw.config);
  zestConfig.update((draft) => {
    if (replace) {
      draft.viewGroups = incoming.viewGroups;
      draft.tagRules = incoming.tagRules;
      draft.datasets = incoming.datasets;
      draft.tabGroups = incoming.tabGroups;
      draft.tabSessions = incoming.tabSessions;
    } else {
      const gIds = new Set(draft.viewGroups.map((g) => g.id));
      const gNames = new Set(draft.viewGroups.map((g) => g.name));
      for (const g of incoming.viewGroups) {
        if (gIds.has(g.id) || gNames.has(g.name)) continue;
        draft.viewGroups.push(g);
      }
      const prefixes = new Set(draft.tagRules.map((r) => r.prefix));
      for (const r of incoming.tagRules) {
        if (prefixes.has(r.prefix)) continue;
        draft.tagRules.push(r);
      }
      const dIds = new Set(draft.datasets.map((d) => d.id));
      for (const d of incoming.datasets) {
        if (dIds.has(d.id)) continue;
        draft.datasets.push(d);
      }
      const tgIds = new Set(draft.tabGroups.map((g) => g.id));
      for (const g of incoming.tabGroups) {
        if (tgIds.has(g.id)) continue;
        draft.tabGroups.push(g);
      }
    }
  });
  const after = zestConfig.get();
  report.viewGroups = after.viewGroups.length;
  report.tagRules = after.tagRules.length;
  report.datasets = after.datasets.length;
  return report;
}
