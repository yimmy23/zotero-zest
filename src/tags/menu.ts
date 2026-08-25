import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { guard } from "../utils/guard";
import { runBatch } from "../ui/batch";
import { setTagRule, removeTagRule, ruleFor } from "./rules";
import { parseTagRule } from "./match";
import { getPref } from "../utils/prefs";
import type { TagNode } from "./tree";

/**
 * Context menu of a nested-tag row: rename the whole branch, copy the segment
 * or the full path, colour it, delete it.
 *
 * Renaming a branch rewrites the prefix of every tag under it. Zotero MERGES
 * tags when the new name already exists and there is no undo, so the
 * confirmation says how many tags and how many items are affected and uses the
 * word "merge" — the original plugin renamed silently, in parallel, without
 * awaiting, against a hardcoded library id.
 */

export interface TagMenuContext {
  node: TagNode;
  realNames: string[];
  libraryID: number;
  linkSymbol: string;
  screenX: number;
  screenY: number;
  onChanged: () => void;
}

export function showTagContextMenu(win: Window, ctx: TagMenuContext) {
  const doc = win.document;
  const id = `${config.addonRef}-tag-menu`;
  let popup = doc.getElementById(id) as any;
  if (!popup) {
    popup = doc.createXULElement("menupopup");
    popup.id = id;
    (doc.getElementById("mainPopupSet") || doc.documentElement)?.appendChild(
      popup,
    );
  }
  while (popup.firstChild) popup.firstChild.remove();

  const item = (label: string, fn: () => void, disabled = false) => {
    const mi = doc.createXULElement("menuitem");
    mi.setAttribute("label", label);
    if (disabled) mi.setAttribute("disabled", "true");
    else mi.addEventListener("command", guard("tag menu", fn));
    popup.appendChild(mi);
  };
  const sep = () => popup.appendChild(doc.createXULElement("menuseparator"));

  item(getString("tags-menu-rename"), () => void renameBranch(win, ctx));
  sep();
  item(getString("tags-menu-copy"), () => copy(ctx.node.segment));
  item(getString("tags-menu-copy-full"), () => copy(ctx.node.name));
  sep();

  // colour: Zotero's own nine slots for real tags, our local rule for the rest
  const colorMenu = doc.createXULElement("menu");
  colorMenu.setAttribute("label", getString("tags-menu-color"));
  const colorPopup = doc.createXULElement("menupopup");
  colorMenu.appendChild(colorPopup);
  const PALETTE = [
    "#FF6666",
    "#FF8C19",
    "#999999",
    "#5FB236",
    "#009980",
    "#2EA8E5",
    "#576DD9",
    "#A28AE5",
    "#A6507B",
  ];
  for (const c of PALETTE) {
    const mi = doc.createXULElement("menuitem");
    mi.setAttribute("label", c);
    mi.setAttribute("style", `color:${c}`);
    mi.addEventListener(
      "command",
      guard("tag colour", () => {
        setTagRule(ctx.node.name, { color: c });
        ctx.onChanged();
      }),
    );
    colorPopup.appendChild(mi);
  }
  const clear = doc.createXULElement("menuitem");
  clear.setAttribute("label", getString("tags-menu-color-clear"));
  clear.addEventListener(
    "command",
    guard("tag colour clear", () => {
      removeTagRule(ctx.node.name);
      ctx.onChanged();
    }),
  );
  colorPopup.appendChild(doc.createXULElement("menuseparator"));
  colorPopup.appendChild(clear);
  popup.appendChild(colorMenu);

  item(getString("tags-menu-emoji"), () => void setEmoji(win, ctx));
  if (ruleFor(ctx.node.name)) {
    item(getString("tags-menu-rule-clear"), () => {
      removeTagRule(ctx.node.name);
      ctx.onChanged();
    });
  }
  sep();
  item(
    getString("tags-menu-delete"),
    () => void deleteBranch(win, ctx),
    !ctx.realNames.length,
  );

  try {
    popup.openPopupAtScreen(ctx.screenX, ctx.screenY, true);
  } catch (e) {
    ztoolkit.log("[tags] menu failed", e);
  }
}

function copy(text: string) {
  try {
    (Zotero.Utilities.Internal as any).copyTextToClipboard(text);
  } catch (e) {
    ztoolkit.log("[tags] copy failed", e);
  }
}

function prompt(win: Window, title: string, label: string, value: string) {
  const out = { value };
  const ok = Services.prompt.prompt(
    win as any,
    title,
    label,
    out,
    null as any,
    { value: false },
  );
  return ok ? out.value : null;
}

async function renameBranch(win: Window, ctx: TagMenuContext) {
  const names = ctx.realNames;
  if (!names.length) return;
  const next = prompt(
    win,
    getString("tags-rename-title"),
    getString("tags-rename-label", { args: { count: names.length } }),
    ctx.node.name,
  );
  if (next === null) return;
  const target = next.trim();
  if (!target || target === ctx.node.name) return;

  // The tree shows DISPLAY names (the #Tags rule strips its prefix: real
  // "#Method/Cohort" is shown as Method ▸ Cohort), while `names` are the real
  // tags. Map each real tag to what the tree shows, rewrite that part, and put
  // the rest of the real tag back — so every tag under the branch keeps its
  // prefix and its suffix.
  const from = ctx.node.name;
  const matcher = parseTagRule(getPref("textTags.match") as string);
  const pairs: Array<[string, string]> = [];
  let unrewritable = 0;
  for (const tag of names) {
    const shown = matcher.test(tag) ?? tag;
    let rewritten: string | null = null;
    if (shown === from) rewritten = target;
    else if (shown.startsWith(from + ctx.linkSymbol))
      rewritten = target + shown.slice(from.length);
    if (rewritten === null) continue;
    const real = tag.endsWith(shown)
      ? tag.slice(0, tag.length - shown.length) + rewritten
      : tag.replace(shown, rewritten);
    if (real !== tag) pairs.push([tag, real]);
    // a multi-capture-group rule can display text that is not a substring of
    // the real tag — such a tag cannot be rewritten mechanically, and
    // dropping it silently made the whole action look broken
    else unrewritable++;
  }
  if (unrewritable) {
    try {
      new ztoolkit.ProgressWindow(getString("tags-rename-title"), {
        closeTime: 6000,
      })
        .createLine({
          text: getString("tags-rename-skipped", {
            args: { count: unrewritable },
          }),
          type: "fail",
        })
        .show();
    } catch {
      // toast is best-effort
    }
  }
  if (!pairs.length) return;

  const existing = new Set(
    ((await Zotero.Tags.getAll(ctx.libraryID)) as Array<{ tag: string }>).map(
      (t) => t.tag,
    ),
  );
  const merges = pairs.filter(([, to]) => existing.has(to)).length;
  const message = merges
    ? getString("tags-rename-confirm-merge", {
        args: { count: pairs.length, merges },
      })
    : getString("tags-rename-confirm", { args: { count: pairs.length } });

  await runBatch(
    getString("tags-rename-title"),
    pairs,
    async ([oldName, newName]) => {
      // the menu context is a snapshot; a sync or another client may have
      // removed the tag while the confirm dialog was open
      if (!Zotero.Tags.getID(oldName)) return;
      await Zotero.Tags.rename(ctx.libraryID, oldName, newName);
    },
    { confirmMessage: message },
  );
  ctx.onChanged();
}

async function deleteBranch(win: Window, ctx: TagMenuContext) {
  const names = ctx.realNames;
  if (!names.length) return;
  await runBatch(
    getString("tags-menu-delete"),
    names,
    async (tag) => {
      const tagID = Zotero.Tags.getID(tag) as number | false;
      if (tagID)
        await (Zotero.Tags as any).removeFromLibrary(ctx.libraryID, [tagID]);
    },
    {
      confirmMessage: getString("tags-delete-confirm", {
        args: { count: names.length, path: ctx.node.name },
      }),
    },
  );
  ctx.onChanged();
}

async function setEmoji(win: Window, ctx: TagMenuContext) {
  const current = ruleFor(ctx.node.name)?.emoji || "";
  const next = prompt(
    win,
    getString("tags-emoji-title"),
    getString("tags-emoji-label"),
    current,
  );
  if (next === null) return;
  const emoji = next.trim().slice(0, 4);
  setTagRule(ctx.node.name, { emoji: emoji || undefined });
  ctx.onChanged();
}
