import { getString } from "../utils/locale";

/**
 * Reader background presets.
 *
 * Zotero 8 added proper custom reader themes, stored in the `readerCustomThemes`
 * synced setting and selected through `reader.lightTheme` / `reader.darkTheme`.
 * We write into that official mechanism instead of inventing our own — the
 * themes then sync, appear in Zotero's own Appearance popup, and survive an
 * uninstall of this plugin.
 *
 * Rules that keep it safe:
 *   - MERGE by id, never replace the array: the user's own themes must survive;
 *   - ids are prefixed `custom-zest-`, which still starts with "custom" so
 *     Zotero clears a dangling selection if the theme is deleted;
 *   - compare before writing: SyncedSettings.set does a `===` check, so writing
 *     an equal-but-new array marks the setting dirty and re-uploads it;
 *   - write the setting BEFORE the pref, or the pref points at an unknown id
 *     and the reader silently falls back to Original.
 */

export interface ReaderTheme {
  id: string;
  label: string;
  background: string;
  foreground: string;
  invertImages?: boolean;
}

export const PRESETS: ReaderTheme[] = [
  {
    id: "custom-zest-sepia",
    label: "Zest Sepia",
    background: "#F4ECD8",
    foreground: "#3B3228",
  },
  {
    id: "custom-zest-eyecare",
    label: "Zest Eye Care",
    background: "#C7EDCC",
    foreground: "#20342A",
  },
  {
    id: "custom-zest-graphite",
    label: "Zest Graphite",
    background: "#2B2E33",
    foreground: "#D6D9DE",
    invertImages: true,
  },
];

function userLibraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

export function readerThemesAvailable(): boolean {
  return !!(Zotero as any).SyncedSettings?.get;
}

export function currentThemes(): ReaderTheme[] {
  try {
    const value = (Zotero as any).SyncedSettings.get(
      userLibraryID(),
      "readerCustomThemes",
    );
    return Array.isArray(value) ? (value as ReaderTheme[]) : [];
  } catch {
    // UnloadedDataException or no setting yet
    return [];
  }
}

function clean(theme: ReaderTheme): ReaderTheme {
  // Zotero omits invertImages when false — match that exactly so our
  // comparison against the stored value does not always differ
  const out: ReaderTheme = {
    id: theme.id,
    label: theme.label,
    background: theme.background,
    foreground: theme.foreground,
  };
  if (theme.invertImages) out.invertImages = true;
  return out;
}

/** add/update our presets without touching the user's own themes */
export async function installPresets(): Promise<number> {
  if (!readerThemesAvailable()) return 0;
  const existing = currentThemes();
  const merged = [...existing];
  let changed = 0;
  for (const preset of PRESETS) {
    const clean_ = clean(preset);
    const i = merged.findIndex((t) => t?.id === preset.id);
    if (i < 0) {
      merged.push(clean_);
      changed++;
    } else if (JSON.stringify(merged[i]) !== JSON.stringify(clean_)) {
      merged[i] = clean_;
      changed++;
    }
  }
  if (!changed) return 0;
  await (Zotero as any).SyncedSettings.set(
    userLibraryID(),
    "readerCustomThemes",
    merged,
  );
  return changed;
}

export async function removePresets(): Promise<number> {
  if (!readerThemesAvailable()) return 0;
  const existing = currentThemes();
  const ids = new Set(PRESETS.map((p) => p.id));
  const kept = existing.filter((t) => !ids.has(t?.id));
  if (kept.length === existing.length) return 0;
  // drop the selection first if it points at a theme we are removing
  for (const pref of ["reader.lightTheme", "reader.darkTheme"]) {
    const current = String(Zotero.Prefs.get(pref) ?? "");
    if (ids.has(current)) Zotero.Prefs.set(pref, "");
  }
  await (Zotero as any).SyncedSettings.set(
    userLibraryID(),
    "readerCustomThemes",
    kept,
  );
  return existing.length - kept.length;
}

/** "" and the string "false" both mean "no custom theme" (Zotero writes both) */
export function activeTheme(mode: "light" | "dark"): string {
  const raw = String(Zotero.Prefs.get(`reader.${mode}Theme`) ?? "");
  return raw === "false" ? "" : raw;
}

/** select one of our presets (or "" for Zotero's Original) */
export async function selectTheme(mode: "light" | "dark", id: string) {
  if (id) await installPresets();
  Zotero.Prefs.set(`reader.${mode}Theme`, id);
}

export function presetLabel(id: string): string {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return getString("reader-theme-original");
  switch (preset.id) {
    case "custom-zest-sepia":
      return getString("reader-theme-sepia");
    case "custom-zest-eyecare":
      return getString("reader-theme-eyecare");
    default:
      return getString("reader-theme-graphite");
  }
}
