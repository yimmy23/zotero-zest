import type { MatrixRow } from "./matrixModel";

interface AttachmentScope {
  attachment: Zotero.Item;
  all: boolean;
  annotations: Map<string, Zotero.Item>;
}

/** Bad or unloaded optional fields must not discard an otherwise valid mark. */
function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function identity(item: Zotero.Item): string {
  return `${item.libraryID}/${item.key || item.id}`;
}

function encodePosition(value: string): string {
  // These links also travel inside Markdown, where literal parentheses and
  // quotes can terminate a link even though encodeURIComponent permits them.
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

type LibraryScope = string | false;

function sourceURL(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  libraryScopes: Map<number, LibraryScope>,
): string {
  try {
    if (
      !/^[A-Z0-9]+$/.test(attachment.key) ||
      !/^[A-Z0-9]+$/.test(annotation.key)
    )
      return "";
    const libraryID = attachment.libraryID;
    let scope = libraryScopes.get(libraryID);
    if (scope === undefined) {
      if (libraryID === Zotero.Libraries.userLibraryID) scope = "library";
      else {
        const groupID = (() => {
          try {
            return Zotero.Groups.getGroupIDFromLibraryID(libraryID) as number;
          } catch {
            return Number.NaN;
          }
        })();
        scope =
          Number.isInteger(groupID) && groupID > 0
            ? `groups/${groupID}`
            : false;
      }
      libraryScopes.set(libraryID, scope);
    }
    if (!scope) return "";
    const params: string[] = [];
    const raw = safely(() => annotation.annotationPosition, "");
    const position = safely(() => JSON.parse(raw), null);
    if (Number.isInteger(position?.pageIndex) && position.pageIndex >= 0) {
      params.push(`page=${position.pageIndex + 1}`);
    } else if (
      position?.type === "FragmentSelector" &&
      typeof position.value === "string"
    ) {
      params.push(`cfi=${encodePosition(position.value)}`);
    } else if (
      position?.type === "CssSelector" &&
      typeof position.value === "string"
    ) {
      params.push(`sel=${encodePosition(position.value)}`);
    }
    params.push(`annotation=${annotation.key}`);
    return `zotero://open-pdf/${scope}/items/${attachment.key}?${params.join("&")}`;
  } catch {
    // Feeds and unavailable group metadata have no reliable application link.
    return "";
  }
}

/** Shared traversal; null yields are work checkpoints, not annotation rows. */
function* scan(items: Zotero.Item[]): Generator<MatrixRow | null> {
  const cachedItems = new Map<number, Zotero.Item | undefined>();
  const titles = new Map<string, string>();
  const scopes = new Map<string, AttachmentScope>();
  // A scan can contain many annotations in one library. Group identity is
  // stable for the scan, so resolve it once while retaining every source link.
  const libraryScopes = new Map<number, LibraryScope>();
  const parents = new Set<string>();
  const seen = new Set<string>();
  const getItem = (id: number): Zotero.Item | undefined => {
    if (!id) return undefined;
    if (!cachedItems.has(id)) {
      cachedItems.set(
        id,
        safely(() => Zotero.Items.get(id) as Zotero.Item, undefined) ||
          undefined,
      );
    }
    return cachedItems.get(id);
  };
  const titleOf = (item: Zotero.Item): string => {
    const key = identity(item);
    if (!titles.has(key)) {
      titles.set(
        key,
        safely(() => String(item.getField("title") || ""), ""),
      );
    }
    return titles.get(key)!;
  };
  const addAttachment = (
    attachment: Zotero.Item | undefined,
    annotation?: Zotero.Item,
  ) => {
    if (!attachment || attachment.deleted || !attachment.isAttachment()) return;
    const key = identity(attachment);
    let scope = scopes.get(key);
    if (!scope) {
      scope = { attachment, all: false, annotations: new Map() };
      scopes.set(key, scope);
    }
    if (annotation) scope.annotations.set(identity(annotation), annotation);
    else scope.all = true;
  };

  // Resolve scope first: selecting a child must not pull in its sibling PDFs.
  for (const item of items) {
    yield null;
    try {
      if (!item || item.deleted) continue;
      if (item.id) cachedItems.set(item.id, item);
      if (item.isRegularItem()) {
        const key = identity(item);
        if (parents.has(key)) continue;
        parents.add(key);
        for (const id of item.getAttachments()) {
          try {
            addAttachment(getItem(id));
          } catch {
            // A broken attachment does not hide its siblings.
          }
          yield null;
        }
      } else if (item.isAttachment()) {
        addAttachment(item);
      } else if (item.isAnnotation()) {
        addAttachment(getItem(item.parentItemID as number), item);
      }
    } catch {
      // A stale tree row must not discard the remaining selection.
    }
  }

  for (const scope of scopes.values()) {
    const attachment = scope.attachment;
    let annotations: Iterable<Zotero.Item>;
    let owner: Zotero.Item;
    try {
      if (attachment.deleted) continue;
      const parent = getItem(attachment.parentItemID as number);
      if (parent?.deleted) continue;
      owner = parent?.isRegularItem() ? parent : attachment;
      if (scope.all) {
        const values = attachment.getAnnotations();
        annotations = Array.isArray(values) ? values : [];
      } else {
        annotations = scope.annotations.values();
      }
    } catch {
      // Linked URLs and unloaded child lists do not have readable annotations.
      continue;
    }
    for (const annotation of annotations) {
      yield null;
      try {
        if (
          !annotation ||
          annotation.deleted ||
          !annotation.isAnnotation() ||
          annotation.parentItemID !== attachment.id ||
          annotation.libraryID !== attachment.libraryID
        )
          continue;
        const key = identity(annotation);
        if (seen.has(key)) continue;
        seen.add(key);
        const text = safely(() => String(annotation.annotationText || ""), "");
        const comment = safely(
          () => String(annotation.annotationComment || ""),
          "",
        );
        const tags = safely(
          () =>
            [...new Set(annotation.getTags().map((tag) => tag.tag))].filter(
              (tag) => typeof tag === "string" && !!tag,
            ),
          [],
        );
        const color = safely(
          () => String(annotation.annotationColor || ""),
          "",
        );
        const itemTitle = titleOf(owner);
        const attachmentTitle = titleOf(attachment);
        yield {
          annotation,
          attachment,
          key: annotation.key,
          page: safely(() => String(annotation.annotationPageLabel || ""), ""),
          text,
          comment,
          color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "",
          type: safely(() => String(annotation.annotationType || ""), ""),
          tags,
          itemTitle,
          itemID: owner.id,
          itemIdentity: identity(owner),
          attachmentTitle,
          sourceURL: sourceURL(annotation, attachment, libraryScopes),
          searchText: [
            text,
            comment,
            itemTitle,
            attachmentTitle,
            tags.join(" "),
          ]
            .join(" ")
            .toLowerCase(),
        };
      } catch {
        // Only this broken annotation is skipped.
      }
    }
    yield null;
  }
}

/** Synchronous compatibility API for scripts and small, explicit selections. */
export function collectMatrix(items: Zotero.Item[]): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const row of scan(items)) if (row) rows.push(row);
  return rows;
}

/** Large views yield during both scope expansion and annotation extraction. */
export async function collectMatrixAsync(
  items: Zotero.Item[],
  cancelled: () => boolean,
): Promise<MatrixRow[]> {
  if (cancelled()) return [];
  const rows: MatrixRow[] = [];
  const sliceMs = 8;
  const clockCheckInterval = 64;
  let work = 0;
  let deadline = Date.now() + sliceMs;
  for (const row of scan(items)) {
    if (cancelled()) return [];
    if (row) rows.push(row);
    // Keep cancellation responsive on every checkpoint, but avoid paying for
    // a clock read on every annotation. The deadline bounds a busy scan while
    // small views complete without an artificial Promise turn.
    if (++work % clockCheckInterval === 0 && Date.now() >= deadline) {
      await Zotero.Promise.delay(0);
      if (cancelled()) return [];
      deadline = Date.now() + sliceMs;
    }
  }
  return cancelled() ? [] : rows;
}
