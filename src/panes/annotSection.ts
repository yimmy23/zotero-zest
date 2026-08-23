import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { guard } from "../utils/guard";
import { openAttachmentAt } from "../utils/items";
import { readableTextColor } from "../ui/color";
import { hexToRgb } from "../reading/heat";
import { selectedTagNames, onTagSelectionChange } from "../tags/nestedTree";
import { iconButton } from "../ui/icons";

/**
 * "Zest · Annotations" item-pane section — locator cards.
 *
 * One card per annotation of the item's attachments: attachment name, page
 * label, highlighted text, comment, and the annotation's OWN tags. Cards are
 * filtered by whatever is selected in the nested tag tree, so "show me every
 * place I tagged something #Method/Cohort" is two clicks.
 *
 * Double-click jumps into the reader AT the annotation via
 * `{ annotationID: annotation.key }` — the item KEY, not the numeric id, and
 * not the `annotationKey` the original plugin passed (Zotero ignores that one,
 * which is why its jumps only ever landed on a page, and not at all when the
 * page label was roman numerals).
 *
 * Section hooks are wrapped by Zotero in try/catch and their throws are
 * swallowed, so every hook here is defensive on its own.
 */

let sectionID: string | false = false;
let unsubscribeSelection: (() => void) | undefined;
/** props.refresh per rendered body, so the tag tree can repaint the cards */
const refreshers = new Map<Element, () => void>();

export function registerAnnotSection() {
  if (sectionID) return;
  const manager = (Zotero as any).ItemPaneManager;
  if (!manager?.registerSection) {
    ztoolkit.log("[annots] ItemPaneManager.registerSection unavailable");
    return;
  }
  const icon = `chrome://${config.addonRef}/content/icons/annots.svg`;
  const icon20 = `chrome://${config.addonRef}/content/icons/20/annots.svg`;
  const result = manager.registerSection({
    paneID: "annots",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("anno-section-header"),
      // Zotero calls setL10nArgs(header.l10nArgs) unconditionally; omitting it
      // writes data-l10n-args="undefined" and Fluent errors on every render
      l10nArgs: JSON.stringify({ count: 0 }),
      icon,
    },
    sidenav: {
      l10nID: getLocaleID("anno-section-sidenav"),
      l10nArgs: JSON.stringify({ count: 0 }),
      icon: icon20,
    },
    onInit: (props: any) => {
      // props.item is undefined here — the section is appended before the item
      // is assigned; only remember the refresh handle
      try {
        if (props?.body && typeof props.refresh === "function") {
          refreshers.set(props.body, props.refresh);
        }
      } catch (e) {
        ztoolkit.log("[annots] onInit failed", e);
      }
    },
    onDestroy: (props: any) => {
      try {
        if (props?.body) refreshers.delete(props.body);
      } catch {
        // window gone
      }
    },
    onRender: (props: any) => {
      try {
        renderCards(props);
      } catch (e) {
        ztoolkit.log("[annots] render failed", e);
      }
    },
  });
  unsubscribeSelection = onTagSelectionChange(() => refreshAnnotSections());
  sectionID = typeof result === "string" ? result : false;
  if (!sectionID) ztoolkit.log("[annots] registerSection rejected the options");
}

export function unregisterAnnotSection() {
  unsubscribeSelection?.();
  unsubscribeSelection = undefined;
  refreshers.clear();
  if (!sectionID) return;
  try {
    (Zotero as any).ItemPaneManager?.unregisterSection?.(sectionID);
  } catch (e) {
    ztoolkit.log("[annots] unregister failed", e);
  }
  sectionID = false;
}

/** repaint every open section (the tag selection changed) */
export function refreshAnnotSections() {
  for (const refresh of refreshers.values()) {
    try {
      refresh();
    } catch {
      // stale container
    }
  }
}

export interface CardAnnotation {
  annotation: Zotero.Item;
  attachment: Zotero.Item;
  key: string;
  page: string;
  text: string;
  comment: string;
  color: string;
  type: string;
  tags: string[];
}

/** every annotation of the item's attachments, in reading order */
export function collectAnnotations(item: Zotero.Item): CardAnnotation[] {
  const out: CardAnnotation[] = [];
  let attIDs: number[];
  try {
    attIDs = item.getAttachments();
  } catch {
    return out;
  }
  for (const attID of attIDs) {
    let att: Zotero.Item;
    let anns: Zotero.Item[];
    try {
      att = Zotero.Items.get(attID) as Zotero.Item;
      if (!att || typeof (att as any).getAnnotations !== "function") continue;
      // throws for linked-URL attachments
      anns = (att as any).getAnnotations() as Zotero.Item[];
    } catch {
      continue;
    }
    for (const a of anns) {
      try {
        if ((a as any).deleted) continue;
        out.push({
          annotation: a,
          attachment: att,
          key: a.key,
          page: String((a as any).annotationPageLabel || ""),
          text: String((a as any).annotationText || ""),
          comment: String((a as any).annotationComment || ""),
          color: String((a as any).annotationColor || ""),
          type: String((a as any).annotationType || ""),
          tags: (a.getTags?.() || []).map((t: any) => t.tag),
        });
      } catch {
        // skip broken annotation
      }
    }
  }
  // Zotero already returns annotations ordered by sortIndex inside one
  // attachment; keep that and only stabilise across attachments
  return out;
}

/** AND across selected prefixes, prefix-match inside each (same rule as the tree) */
export function matchesPrefixes(tags: string[], prefixes: string[]): boolean {
  if (!prefixes.length) return true;
  for (const p of prefixes) {
    if (!tags.some((t) => t === p || t.startsWith(p))) return false;
  }
  return true;
}

function renderCards(props: any) {
  const body: HTMLElement = props.body;
  const doc: Document = props.doc || body.ownerDocument;
  const item: Zotero.Item | undefined = props.item;
  body.textContent = "";
  body.classList.add("zest-annot-cards");

  // Inside a reader tab Zotero already shows its own annotation sidebar with
  // tag and colour filters — duplicating it there would be noise, so the
  // section only appears in the library pane.
  if (props.tabType === "reader") {
    props.setEnabled?.(false);
    return;
  }

  if (!item || !(item instanceof Zotero.Item) || !item.isRegularItem()) {
    props.setEnabled?.(false);
    return;
  }
  props.setEnabled?.(true);

  const all = collectAnnotations(item);
  // the tag selection is per window; a second main window must not follow the
  // first one's tree
  const win = (props.doc?.defaultView || body.ownerDocument?.defaultView) as
    Window | undefined;
  const prefixes = selectedTagNames(win);
  const shown = all.filter((a) => matchesPrefixes(a.tags, prefixes));

  props.setSectionSummary?.(shown.length ? String(shown.length) : "");
  props.setL10nArgs?.(JSON.stringify({ count: shown.length }));

  if (prefixes.length) {
    const chips = doc.createElement("div");
    chips.className = "zest-annot-filters";
    for (const p of prefixes) {
      const chip = doc.createElement("span");
      chip.className = "zest-annot-chip";
      chip.textContent = p;
      chips.appendChild(chip);
    }
    body.appendChild(chips);
  }

  if (!all.length) {
    body.appendChild(
      emptyState(
        doc,
        item.getAttachments().length
          ? getString("anno-empty-no-annotation")
          : getString("anno-empty-no-attachment"),
      ),
    );
    return;
  }
  if (!shown.length) {
    body.appendChild(emptyState(doc, getString("anno-empty-filtered")));
    return;
  }

  const dark = !!doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)")
    ?.matches;
  for (const card of shown) body.appendChild(renderCard(doc, card, dark));
}

function emptyState(doc: Document, text: string): HTMLElement {
  const div = doc.createElement("div");
  div.className = "zest-annot-empty";
  div.textContent = text;
  return div;
}

function renderCard(
  doc: Document,
  card: CardAnnotation,
  dark: boolean,
): HTMLElement {
  const el = doc.createElement("div");
  el.className = "zest-annot-card";
  const rgb = hexToRgb(card.color);
  if (rgb) {
    el.style.setProperty("--zest-annot-rgb", `${rgb[0]},${rgb[1]},${rgb[2]}`);
    el.style.setProperty("--zest-annot-line", readableTextColor(rgb, dark));
  }

  const head = doc.createElement("div");
  head.className = "zest-annot-head";
  const where = doc.createElement("span");
  where.className = "zest-annot-where";
  let attName: string;
  try {
    attName = (card.attachment.getField("title") as string) || "";
  } catch {
    attName = "";
  }
  where.textContent = card.page
    ? getString("anno-page", { args: { page: card.page } })
    : attName;
  where.title = attName;
  head.appendChild(where);

  const copy = iconButton(
    doc,
    "copy",
    getString("anno-copy"),
    "zest-annot-copy",
    13,
  );
  copy.addEventListener(
    "click",
    guard("annot copy", (ev: Event) => {
      ev.stopPropagation();
      const text = [card.text, card.comment].filter(Boolean).join("\n");
      try {
        (Zotero.Utilities.Internal as any).copyTextToClipboard(text);
      } catch (e) {
        ztoolkit.log("[annots] copy failed", e);
      }
    }),
  );
  head.appendChild(copy);
  el.appendChild(head);

  const text = doc.createElement("div");
  text.className = "zest-annot-text";
  text.textContent =
    card.text ||
    getString("anno-no-text", { args: { type: card.type || "note" } });
  el.appendChild(text);

  if (card.comment) {
    const comment = doc.createElement("div");
    comment.className = "zest-annot-comment";
    comment.textContent = card.comment;
    el.appendChild(comment);
  }

  if (card.tags.length) {
    const tags = doc.createElement("div");
    tags.className = "zest-annot-tags";
    for (const t of card.tags) {
      const chip = doc.createElement("span");
      chip.className = "zest-annot-tag";
      chip.textContent = t;
      tags.appendChild(chip);
    }
    el.appendChild(tags);
  }

  el.title = getString("anno-card-tip");
  el.addEventListener(
    "dblclick",
    guard("annot open", () => openAnnotation(card)),
  );
  return el;
}

/** open (or navigate) the reader at this annotation */
export async function openAnnotation(card: CardAnnotation) {
  const location = { annotationID: card.key };
  try {
    const readers = (Zotero.Reader as any)._readers as any[] | undefined;
    const open = readers?.find((r) => r.itemID === card.attachment.id);
    if (open?.navigate) {
      await open.navigate(location);
      const tabID = open.tabID;
      if (tabID) {
        // the reader belongs to the main window it was opened in — not
        // necessarily the front-most one
        const win = (open._window || Zotero.getMainWindow()) as any;
        win?.Zotero_Tabs?.select?.(tabID);
        win?.focus?.();
      }
      return;
    }
  } catch (e) {
    ztoolkit.log("[annots] navigate failed, opening instead", e);
  }
  try {
    await openAttachmentAt(card.attachment, location);
  } catch (e) {
    ztoolkit.log("[annots] open failed", e);
  }
}
