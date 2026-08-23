/**
 * Small item helpers shared by the panels and the tab sidebar.
 *
 * `getBestAttachment` is async in Zotero (it hits the DB), and every caller
 * here renders synchronously or drives a tab, so these wrap the sync paths and
 * fall back the way Zotero itself does: a PDF/EPUB/snapshot before anything
 * else, and only then the first attachment.
 */

const READABLE = ["application/pdf", "application/epub+zip", "text/html"];

/** the attachment a reader would open, chosen synchronously */
export function bestAttachment(
  item: Zotero.Item | undefined | null,
): Zotero.Item | undefined {
  if (!item?.isRegularItem?.()) return undefined;
  let atts: Zotero.Item[];
  try {
    atts = Zotero.Items.get(item.getAttachments()).filter(
      (a): a is Zotero.Item => a instanceof Zotero.Item && !a.deleted,
    );
  } catch {
    return undefined;
  }
  if (!atts.length) return undefined;
  for (const type of READABLE) {
    const hit = atts.find((a) => {
      try {
        return a.attachmentContentType === type && a.isFileAttachment();
      } catch {
        return false;
      }
    });
    if (hit) return hit;
  }
  return atts[0];
}

/** true when writes to this item will actually persist */
export function itemIsEditable(item: Zotero.Item | undefined | null): boolean {
  try {
    return !!item?.isEditable?.();
  } catch {
    return false;
  }
}

/** true when the item has a file Zotero's reader can open (PDF / EPUB / snapshot) */
export function hasReadableAttachment(item: Zotero.Item): boolean {
  try {
    if (!item.isRegularItem()) return false;
    for (const id of item.getAttachments(false)) {
      const a = Zotero.Items.get(id) as Zotero.Item | false;
      if (!a) continue;
      try {
        if (a.isFileAttachment() && READABLE.includes(a.attachmentContentType))
          return true;
      } catch {
        // unloaded
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * The rows the reading tracker credits: regular items, and a top-level
 * attachment (a PDF dropped in without a parent) which the tracker records
 * under its own key. Columns and the title decoration accept both so time
 * spent on a parent-less PDF is not tracked and then hidden.
 */
export function isTrackedItem(item: Zotero.Item): boolean {
  try {
    return item.isRegularItem() || (item.isAttachment() && !item.parentID);
  } catch {
    return false;
  }
}

/** open an attachment in the reader at a location (page / annotation) */
export async function openAttachmentAt(
  attachment: Zotero.Item,
  location: Record<string, unknown>,
): Promise<void> {
  await (Zotero as any).FileHandlers.open(attachment, { location });
}
