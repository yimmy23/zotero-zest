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
  // Zotero remembers the user's pick; honour it when it is still there
  const preferred = (item as any).getField?.("primaryAttachmentID");
  const pinned = atts.find((a) => a.id === Number(preferred));
  if (pinned) return pinned;
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
