import {
  zestConfig,
  newId,
  type TabGroupConfig,
  type TabSessionConfig,
} from "../core/config";

/**
 * Tab groups and saved sessions.
 *
 * Zotero has no tab-group concept (checked on 10.0: no group API on
 * `Zotero_Tabs`), so the grouping lives here, keyed by the ITEM the tab shows
 * rather than by the tab id — tab ids are per session, item keys are not, so a
 * group survives restarts and even a different machine.
 *
 * Nothing here touches Zotero state; the sidebar reads this model and drives
 * `Zotero_Tabs` through its five public-ish methods.
 */

export type TabGroup = TabGroupConfig;
export type TabSession = TabSessionConfig;

/**
 * Groups and sessions are first-class fields of zest-config.json — the config
 * store re-sanitises the whole document on every write, so anything stored as
 * a free-form key would be dropped the next time an unrelated setting changed.
 */
export function groups(): TabGroup[] {
  return zestConfig.get().tabGroups;
}

export function sessions(): TabSession[] {
  return zestConfig.get().tabSessions;
}

export function itemKeyOf(item: Zotero.Item | undefined | null): string {
  if (!item) return "";
  return `${item.libraryID}/${item.key}`;
}

export function addGroup(name: string): TabGroup {
  const group: TabGroup = {
    id: newId("tg"),
    name: name.slice(0, 60) || "Group",
    members: [],
  };
  zestConfig.update((draft) => {
    draft.tabGroups.push(group);
  });
  return group;
}

export function renameGroup(id: string, name: string) {
  zestConfig.update((draft) => {
    const g = draft.tabGroups.find((x) => x.id === id);
    if (g) g.name = name.slice(0, 60) || g.name;
  });
}

export function removeGroup(id: string) {
  zestConfig.update((draft) => {
    draft.tabGroups = draft.tabGroups.filter((g) => g.id !== id);
  });
}

export function setGroupCollapsed(id: string, collapsed: boolean) {
  zestConfig.update((draft) => {
    const g = draft.tabGroups.find((x) => x.id === id);
    if (g) g.collapsed = collapsed;
  });
}

/** the config store keeps the first N members on write, so cap here too */
const MAX_MEMBERS = 500;

export function assignToGroup(memberKey: string, groupID: string | null) {
  if (!memberKey) return;
  zestConfig.update((draft) => {
    for (const g of draft.tabGroups) {
      g.members = g.members.filter((m) => m !== memberKey);
    }
    if (groupID) {
      const target = draft.tabGroups.find((g) => g.id === groupID);
      // keep the newest: sanitizeKeyList truncates from the front, so a group
      // at capacity would otherwise silently ignore every new member
      if (target)
        target.members = [...target.members, memberKey].slice(-MAX_MEMBERS);
    }
  });
}

/** drop member keys whose item no longer exists (deleted, or moved library) */
export function pruneGroups() {
  const alive = (key: string) => {
    const slash = key.indexOf("/");
    if (slash <= 0) return false;
    const libraryID = Number(key.slice(0, slash));
    const itemKey = key.slice(slash + 1);
    if (!Number.isInteger(libraryID) || !itemKey) return false;
    try {
      return !!Zotero.Items.getIDFromLibraryAndKey(libraryID, itemKey);
    } catch {
      // library gone
      return false;
    }
  };
  const groupsNow = groups();
  const dead = groupsNow.some((g) => g.members.some((m) => !alive(m)));
  if (!dead) return;
  zestConfig.update((draft) => {
    for (const g of draft.tabGroups) g.members = g.members.filter(alive);
  });
}

export function groupOf(memberKey: string): TabGroup | undefined {
  return groups().find((g) => g.members.includes(memberKey));
}

export function saveSession(name: string, items: string[]): TabSession {
  const session: TabSession = {
    id: newId("ts"),
    name: name.slice(0, 60) || new Date().toISOString().slice(0, 16),
    saved: Date.now(),
    items,
  };
  zestConfig.update((draft) => {
    draft.tabSessions = [...draft.tabSessions, session].slice(-20);
  });
  return session;
}

export function removeSession(id: string) {
  zestConfig.update((draft) => {
    draft.tabSessions = draft.tabSessions.filter((s) => s.id !== id);
  });
}
