import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import { readingStore, formatDuration, pagesSeen } from "../reading/store";
import { heatAlphas, heatLevel, hexToRgb } from "../reading/heat";
import { heatColor, heatOpacity } from "../columns/reading";
import { HEAT_LEVELS } from "../ui/palette";
import { effectiveStatus, statusLabel } from "../reading/status";
import { openStatusMenu } from "../reading/statusMenu";
import { getRating, setRating } from "../columns/rating";
import { remarkOf, setRemark } from "../columns/remark";
import {
  getJournalRecord,
  requestJournalRecord,
  displayValuesForUI,
} from "../rank";
import { displayFields, colorForRank, defaultRankColor } from "../rank/rank";
import { rankFieldsForDisplay, rankValueDisplay } from "../rank/display";
import { citationOf, updateCitations } from "../cite";
import { venueOf } from "../rank/normalize";
import {
  bestAttachment,
  itemIsEditable,
  openAttachmentAt,
} from "../utils/items";
import { formatAuthors } from "../authors/pipeline";
import { panelAuthorOptions } from "../columns/authors";
import { cachedAuthorships, findCachedAuthor } from "../graph/authorIdentity";
import { openAuthorMenu } from "../authors/authorMenu";
import { ensureAuthorships } from "../graph/authorFetch";
import { setTimeout, clearTimeout } from "../utils/timers";
import { getExtraBlock } from "../utils/extra";
import { iconButton } from "../ui/icons";
import { abstractParagraphs, normalizeAbstractText } from "./abstractText";
import {
  abstractIdentity,
  cachedAbstract,
  fetchAbstract,
} from "./abstractSource";
import { translateAbstract, translationProvider } from "./abstractTranslation";
import { selectCoreAuthors } from "./coreAuthors";

/**
 * "Zest" item-pane section — the one place that answers "what is this paper,
 * and where am I with it": the title (with its translation when there is
 * one), expandable author details, venue with its rank badges, citation count,
 * reading time with the clickable per-page heat strip, read status, rating,
 * the remark and one structured abstract, with translation only on request.
 *
 * Everything here is a view over data that already exists: reading time from
 * zest.sqlite, rating/status/remark from Extra, ranks and citations from the
 * caches the columns use, and title translations from Extra. Translation is
 * a custom text request, never an item-field rewrite. Rendering itself does
 * not fetch; optional background metadata work is explicitly preference-gated.
 *
 * The maintainer's brief (2026-08-23): the panel is for understanding the
 * paper at a glance, so title and abstract belong here even though Zotero
 * shows the originals elsewhere — with the translation that makes them
 * readable, when one exists.
 *
 * Zotero shows the section in a reader tab's context pane as well (same
 * <item-details> element, item = the attachment's parent), so the status
 * picker here is reachable beside the PDF without Zest adding anything to the
 * reader itself.
 */

let sectionID: string | false = false;
interface SectionState {
  refresh: () => void;
  setEnabled?: (enabled: boolean) => void;
  item?: Zotero.Item;
  itemID?: number;
  timer?: number;
  abstractKey?: string;
  abstractBusy?: boolean;
  abstractRequest?: object;
  abstractMessage?: string;
  translationKey?: string;
  translationText?: string;
  translationSource?: string;
  translationVisible?: boolean;
  translationBusy?: boolean;
  translationRequest?: object;
  translationMessage?: string;
  affiliationsKey?: string;
  affiliationsBusy?: boolean;
  affiliationsRequest?: object;
  affiliationsMessage?: string;
  affiliationsAttempted?: boolean;
  remarkDraft?: string;
  remarkMessage?: string;
  ratingMessage?: string;
  remarkEditor?: HTMLTextAreaElement;
  openSections?: Map<string, boolean>;
}
const sections = new Map<HTMLElement, SectionState>();

function resetTranslation(state: SectionState) {
  state.translationKey = undefined;
  state.translationText = undefined;
  state.translationSource = undefined;
  state.translationVisible = false;
  state.translationBusy = false;
  state.translationRequest = undefined;
  state.translationMessage = "";
}

function cancelTopUp(state: SectionState) {
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.timer = undefined;
}

function sectionState(props: any): SectionState | undefined {
  const body = props?.body as HTMLElement | undefined;
  if (!body) return;
  let state = sections.get(body);
  if (!state && typeof props.refresh === "function") {
    state = { refresh: props.refresh };
    sections.set(body, state);
  }
  if (state && state.itemID !== props.item?.id) {
    cancelTopUp(state);
    state.itemID = props.item?.id;
    state.abstractKey = undefined;
    state.abstractBusy = false;
    state.abstractRequest = undefined;
    state.abstractMessage = "";
    resetTranslation(state);
    state.affiliationsKey = undefined;
    state.affiliationsBusy = false;
    state.affiliationsRequest = undefined;
    state.affiliationsMessage = "";
    state.affiliationsAttempted = false;
    state.remarkDraft = undefined;
    state.remarkMessage = "";
    state.ratingMessage = "";
    state.remarkEditor = undefined;
    state.openSections = new Map();
  }
  if (state) {
    state.item = props.item;
    if (typeof props.setEnabled === "function")
      state.setEnabled = props.setEnabled;
  }
  return state;
}

export function registerInfoSection() {
  if (sectionID) return;
  const manager = (Zotero as any).ItemPaneManager;
  if (!manager?.registerSection) return;
  const result = manager.registerSection({
    paneID: "info",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("info-section-header"),
      l10nArgs: JSON.stringify({ count: 0 }),
      icon: `chrome://${config.addonRef}/content/icons/info.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("info-section-sidenav"),
      l10nArgs: JSON.stringify({ count: 0 }),
      icon: `chrome://${config.addonRef}/content/icons/20/info.svg`,
    },
    onInit: (props: any) => {
      try {
        sectionState(props);
      } catch (e) {
        ztoolkit.log("[info] onInit failed", e);
      }
    },
    onDestroy: (props: any) => {
      try {
        const state = sections.get(props?.body);
        if (state) cancelTopUp(state);
        sections.delete(props?.body);
      } catch {
        // window gone
      }
    },
    // Zotero skips hidden panes in its render loop, so a section that hid
    // itself inside onRender (attachment selected, multi-select) never renders
    // again; visibility has to be decided here, where every item change lands
    onItemChange: (props: any) => {
      try {
        sectionState(props);
        props.setEnabled?.(wantsSection(props?.item));
      } catch (e) {
        ztoolkit.log("[info] item change failed", e);
      }
    },
    onRender: (props: any) => {
      try {
        render(props);
      } catch (e) {
        ztoolkit.log("[info] render failed", e);
      }
    },
  });
  sectionID = typeof result === "string" ? result : false;
}

export function unregisterInfoSection() {
  for (const state of sections.values()) cancelTopUp(state);
  sections.clear();
  if (!sectionID) return;
  try {
    (Zotero as any).ItemPaneManager?.unregisterSection?.(sectionID);
  } catch (e) {
    ztoolkit.log("[info] unregister failed", e);
  }
  sectionID = false;
}

function sectionVisible(
  body: HTMLElement,
  state: SectionState,
  item: Zotero.Item,
): boolean {
  return (
    addon.data.alive &&
    sections.get(body) === state &&
    state.itemID === item.id &&
    wantsSection(item) &&
    body.isConnected &&
    body.getClientRects().length > 0
  );
}

function queueAuthorshipTopUp(
  item: Zotero.Item,
  body: HTMLElement,
  state: SectionState,
) {
  cancelTopUp(state);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void fetchAffiliations(item, body, state, true);
  }, 400);
}

async function fetchAffiliations(
  item: Zotero.Item,
  body: HTMLElement,
  state: SectionState,
  automatic = false,
) {
  if (state.affiliationsBusy || !sectionVisible(body, state, item)) return;
  if (automatic && getPref("info.affiliations.autoFetch") !== true) return;
  cancelTopUp(state);
  const key = String(item.getField("DOI") || "");
  const request = {};
  state.affiliationsKey = key;
  state.affiliationsRequest = request;
  const current = () =>
    addon.data.alive &&
    sections.get(body) === state &&
    state.itemID === item.id &&
    state.affiliationsRequest === request &&
    String(item.getField("DOI") || "") === key;
  const shouldContinue = () =>
    current() &&
    sectionVisible(body, state, item) &&
    (!automatic || getPref("info.affiliations.autoFetch") === true);
  state.affiliationsBusy = true;
  state.affiliationsAttempted = true;
  state.affiliationsMessage = getString("info-affiliations-loading");
  refreshInfoSections(item.id);
  try {
    const changed = await ensureAuthorships([item], {
      ...(automatic ? { automatic: true } : {}),
      details: true,
      shouldContinue,
    });
    if (shouldContinue())
      state.affiliationsMessage = changed
        ? ""
        : getString("info-affiliations-unavailable");
  } catch (e) {
    ztoolkit.log("[info] affiliation lookup failed", e);
    if (shouldContinue())
      state.affiliationsMessage = getString("info-affiliations-unavailable");
  } finally {
    if (current()) {
      state.affiliationsBusy = false;
      state.affiliationsRequest = undefined;
      if (sectionVisible(body, state, item)) refreshInfoSections(item.id);
    }
  }
}

export function refreshInfoSections(itemID?: number) {
  for (const [body, state] of sections) {
    if (itemID !== undefined && state.itemID !== itemID) continue;
    cancelTopUp(state);
    if (itemID !== undefined && !body.getClientRects().length) continue;
    try {
      // Hidden sections defer refresh until visible. Preference changes must
      // restore visibility first, even if the selected item has not changed.
      if (itemID === undefined) state.setEnabled?.(wantsSection(state.item));
      state.refresh();
    } catch {
      // stale container
    }
  }
}

function wantsSection(item: unknown): boolean {
  return (
    !!getPref("info.enable") &&
    item instanceof Zotero.Item &&
    item.isRegularItem()
  );
}

function row(doc: Document, label: string): HTMLElement {
  const el = doc.createElement("div");
  el.className = "zest-info-row";
  const key = doc.createElement("span");
  key.className = "zest-info-key";
  key.textContent = label;
  el.appendChild(key);
  return el;
}

function render(props: any) {
  const body: HTMLElement = props.body;
  const doc: Document = props.doc || body.ownerDocument;
  const item: Zotero.Item | undefined = props.item;
  const state = sectionState(props);
  const editor = state?.remarkEditor;
  const restoreEditor = !!editor && doc.activeElement === editor;
  const selection = restoreEditor
    ? ([
        editor.selectionStart ?? 0,
        editor.selectionEnd ?? 0,
        editor.selectionDirection ?? "none",
      ] as const)
    : undefined;
  if (state) cancelTopUp(state);
  if (state && !getPref("info.abstract")) {
    state.abstractRequest = undefined;
    state.abstractBusy = false;
    state.abstractMessage = "";
    resetTranslation(state);
  }
  body.textContent = "";
  body.classList.add("zest-info");

  if (!wantsSection(item) || !item) {
    props.setEnabled?.(false);
    return;
  }
  props.setEnabled?.(true);
  if (state && state.affiliationsKey !== String(item.getField("DOI") || "")) {
    state.affiliationsKey = String(item.getField("DOI") || "");
    state.affiliationsBusy = false;
    state.affiliationsRequest = undefined;
    state.affiliationsMessage = "";
    state.affiliationsAttempted = false;
  }
  // group libraries and read-only feeds render the section, but every write
  // would fail silently — show the values, disable the controls
  const editable = props.editable !== false && itemIsEditable(item);
  const bibliography = doc.createElement("div");
  bibliography.className = "zest-info-card zest-info-bibliography";
  body.appendChild(bibliography);

  /* ---------- title (+ the translation plugin's translation) ---------- */
  {
    let title: string;
    try {
      title = String(item.getField("title") || "").trim();
    } catch {
      title = "";
    }
    const translation = getExtraBlock(item, TITLE_TRANSLATION_KEYS)?.value;
    if (title || translation) {
      const r = row(doc, getString("info-title"));
      r.classList.add("zest-info-heading");
      const value = doc.createElement("span");
      value.className = "zest-info-value zest-info-title";
      if (translation) {
        const zh = doc.createElement("div");
        zh.className = "zest-info-translation";
        zh.textContent = translation;
        value.appendChild(zh);
      }
      if (title) {
        const orig = doc.createElement("div");
        orig.className = translation ? "zest-info-original" : "";
        orig.textContent = title;
        value.appendChild(orig);
      }
      r.appendChild(value);
      bibliography.appendChild(r);
    }
  }

  // Keep the source next to the title, even when the author list is expanded.
  const sourceSlot = doc.createElement("div");
  sourceSlot.className = "zest-info-source";
  bibliography.appendChild(sourceSlot);

  /* ---------- authors: whole names, with the user's name rules ---------- */
  const authorOptions = panelAuthorOptions();
  // A last-author decoration is not evidence of corresponding authorship.
  const authors = formatAuthors(item, {
    ...authorOptions,
    marks: { ...authorOptions.marks, first: undefined, last: undefined },
  });
  const oaRows = cachedAuthorships(item);
  const core = selectCoreAuthors(
    authors.parts.flatMap((part) => (part.creator ? [part.creator] : [])),
    oaRows,
  );
  if (authors.parts.length) {
    const r = row(doc, getString("info-authors"));
    r.classList.add("zest-info-metadata", "zest-info-authors-block");
    const value = doc.createElement("span");
    value.className = "zest-info-value zest-info-authors";
    const entries: HTMLElement[] = [];
    let entry: HTMLElement | undefined;
    let separator = "";
    for (const part of authors.parts) {
      if (!part.kind && !part.creator) {
        separator += part.text;
        continue;
      }
      if (part.creator) {
        if (separator && entry) {
          const punctuation = doc.createElement("span");
          punctuation.className = "zest-info-author-separator";
          punctuation.textContent = separator;
          entry.appendChild(punctuation);
        }
        entry = doc.createElement("span");
        entry.className = "zest-info-author-entry";
        separator = "";
        value.appendChild(entry);
        entries.push(entry);
        const creator = part.creator;
        const button = doc.createElement("button");
        button.type = "button";
        button.className = `zest-info-author${part.kind ? ` zest-author-${part.kind}` : ""}`;
        button.textContent = part.text;
        button.title = getString("author-click-tip");
        button.addEventListener("click", (ev: MouseEvent) => {
          ev.stopPropagation();
          const win = doc.defaultView as Window | null;
          if (!win) return;
          const oa = findCachedAuthor(item, creator.family, creator.given);
          const rect = button.getBoundingClientRect();
          const point =
            ev.detail === 0
              ? {
                  screenX: win.mozInnerScreenX + rect.left,
                  screenY: win.mozInnerScreenY + rect.bottom,
                }
              : { screenX: ev.screenX, screenY: ev.screenY };
          openAuthorMenu(
            win,
            {
              family: creator.family,
              given: creator.given,
              oaId: oa?.i,
              label: part.text,
            },
            point,
          );
        });
        entry.appendChild(button);
        const author = core.authors.find((a) => a.index === entries.length - 1);
        const roles = [
          author?.first ? getString("info-author-first") : "",
          author?.corresponding ? getString("info-author-corresponding") : "",
          author?.last ? getString("info-author-last") : "",
        ].filter(Boolean);
        if (roles.length) {
          const role = doc.createElement("span");
          role.className = "zest-info-author-role";
          role.textContent = roles.join(" · ");
          if (author?.last) role.title = getString("info-author-last-tip");
          else if (author?.corresponding) role.title = "OpenAlex";
          entry.appendChild(role);
        }
      } else if (entry) {
        const mark = doc.createElement("span");
        mark.className = `zest-author-${part.kind}`;
        mark.textContent = part.text;
        entry.appendChild(mark);
      }
    }
    value.title = getString("authors-cell-tip", {
      args: { count: authors.total },
    });
    r.appendChild(value);
    addListDisclosure(
      doc,
      r,
      entries,
      state,
      "authors",
      core.visibleAuthorIndices,
    );
    bibliography.appendChild(r);
  }

  /* ---------- affiliations (OpenAlex authorship cache) ----------
     Zotero stores no creator affiliation, so this is the cached OpenAlex
     data the author graph keys on. Nothing is fetched while rendering —
     a missing record only queues the bounded background top-up. */
  {
    const insts = core.institutions;
    const canFetch = !!state && !!item.getField("DOI");
    if (insts.length || canFetch) {
      const r = row(doc, getString("info-affiliations"));
      r.classList.add("zest-info-metadata", "zest-info-affiliations-block");
      const value = doc.createElement("span");
      value.className = "zest-info-value";
      if (insts.length) {
        const names = doc.createElement("ul");
        names.className = "zest-info-institutions";
        const entries = insts.map((institution) => {
          const li = doc.createElement("li");
          const name = doc.createElement("span");
          name.className = "zest-info-institution-name";
          name.textContent = institution.name;
          li.appendChild(name);
          const roles = doc.createElement("span");
          roles.className = "zest-info-institution-roles";
          for (const [show, key, kind] of [
            [institution.first, "info-affiliation-first", "first"],
            [
              institution.corresponding,
              "info-affiliation-corresponding",
              "corresponding",
            ],
            [institution.last, "info-affiliation-last", "last"],
          ] as const) {
            if (!show) continue;
            const role = doc.createElement("span");
            role.className = "zest-info-institution-role";
            role.setAttribute("data-role", kind);
            role.textContent = getString(key);
            if (kind === "last") role.title = getString("info-author-last-tip");
            roles.appendChild(role);
          }
          if (roles.children.length) li.appendChild(roles);
          li.title = institution.authors.join("; ");
          names.appendChild(li);
          return li;
        });
        value.appendChild(names);
        value.title = core.authors
          .filter((a) => (a.first || a.corresponding || a.last) && a.row)
          .map(
            (a) =>
              `${a.row!.n} — ${a.row!.af?.map((i) => i.n).join("; ") || a.row!.a || ""}`,
          )
          .join("\n");
        addListDisclosure(
          doc,
          r,
          entries,
          state,
          "affiliations",
          new Set(
            insts.flatMap((institution, i) => (institution.core ? [i] : [])),
          ),
        );
      }
      if (state && canFetch && (core.needsDetails || !insts.length)) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "zest-affiliations-fetch";
        button.textContent = getString(
          state.affiliationsBusy
            ? "info-affiliations-loading"
            : insts.length
              ? "info-authorships-fetch"
              : "info-affiliations-fetch",
        );
        button.title = getString("info-affiliations-fetch-tip");
        button.disabled = !!state.affiliationsBusy;
        button.setAttribute("aria-busy", String(!!state.affiliationsBusy));
        const message = doc.createElement("span");
        message.className = "zest-info-feedback";
        message.setAttribute("role", "status");
        message.textContent = state.affiliationsBusy
          ? ""
          : state.affiliationsMessage || "";
        button.addEventListener("click", () =>
          fetchAffiliations(item, body, state),
        );
        value.append(button, message);
        if (
          !state.affiliationsBusy &&
          !state.affiliationsAttempted &&
          getPref("info.affiliations.autoFetch") === true
        ) {
          queueAuthorshipTopUp(item, body, state);
        }
      }
      r.appendChild(value);
      bibliography.appendChild(r);
    }
  }

  /* ---------- venue + ranks ---------- */
  const venue = venueOf(item);
  if (venue) {
    const r = row(doc, getString("info-venue"));
    r.classList.add("zest-info-metadata", "zest-info-venue-block");
    const value = doc.createElement("div");
    value.className = "zest-info-value zest-info-venue";
    const name = doc.createElement("span");
    name.className = "zest-info-venue-name";
    name.textContent = venue;
    value.appendChild(name);
    r.appendChild(value);
    // rank badges, if we already know them (never fetched during a render)
    requestJournalRecord(item);
    const rec = getJournalRecord(item);
    const badges = doc.createElement("div");
    badges.className = "zest-info-ranks";
    for (const v of displayValuesForUI(
      rec,
      rankFieldsForDisplay(displayFields()),
    ).slice(0, 3)) {
      const display = rankValueDisplay(v, v.sourceField);
      const badge = doc.createElement("span");
      badge.className = "zest-badge zest-rank-badge";
      badge.textContent = display.text;
      badge.title = getString("rank-badge-tip", {
        args: {
          field: v.field,
          value: display.description,
          source: v.source,
        },
      });
      const rgb = hexToRgb(v.rank ? colorForRank(v.rank) : defaultRankColor());
      if (rgb) {
        badge.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},.15)`;
      }
      badges.appendChild(badge);
    }
    if (badges.children.length) value.appendChild(badges);
    sourceSlot.appendChild(r);
  } else sourceSlot.remove();

  /* ---------- citations ---------- */
  const cites = citationOf(item);
  const citeRow = row(doc, getString("info-citations"));
  citeRow.classList.add("zest-info-divider", "zest-info-citations");
  const citeControls = doc.createElement("div");
  citeControls.className = "zest-info-value zest-info-controls";
  const citeValue = doc.createElement("span");
  citeValue.className = "zest-info-value";
  if (cites) {
    const count = doc.createElement("strong");
    count.className = "zest-info-citation-count";
    count.textContent = String(cites.count);
    const provenance = doc.createElement("span");
    provenance.className = "zest-info-provenance";
    provenance.textContent = `${cites.source ?? "?"} · ${cites.date ?? "—"}`;
    citeValue.append(count, provenance);
  } else citeValue.textContent = getString("info-citations-none");
  citeControls.appendChild(citeValue);
  const refresh = iconButton(
    doc,
    "refresh",
    getString("info-refresh"),
    "zest-info-btn",
  );
  refresh.disabled = !editable;
  refresh.addEventListener(
    "click",
    guard("info citations", () => {
      void updateCitations(item, true).then(() => refreshInfoSections(item.id));
    }),
  );
  citeControls.appendChild(refresh);
  citeRow.appendChild(citeControls);
  bibliography.appendChild(citeRow);

  if (getPref("info.abstract") && state) renderAbstract(doc, body, item, state);

  const workspace = doc.createElement("div");
  workspace.className = "zest-info-card zest-info-workspace";
  const workspaceTitle = doc.createElement("div");
  workspaceTitle.className = "zest-info-group-title";
  workspaceTitle.textContent = getString("info-workspace");
  workspace.appendChild(workspaceTitle);
  body.appendChild(workspace);

  /* ---------- reading ---------- */
  const rec = readingStore.getForItem(item);
  const readRow = row(doc, getString("info-reading"));
  const readValue = doc.createElement("span");
  readValue.className = "zest-info-value";
  readValue.textContent = rec
    ? getString("info-reading-value", {
        args: {
          time: formatDuration(rec.total),
          pages: pagesSeen(rec, 1),
          total: rec.pages || 0,
        },
      })
    : getString("info-reading-none");
  readRow.appendChild(readValue);
  workspace.appendChild(readRow);

  if (rec) {
    const strip = buildHeatStrip(doc, item, rec);
    if (strip) workspace.appendChild(strip);
  }

  /* ---------- status / rating / remark ---------- */
  const stateRow = row(doc, getString("info-status"));
  const stateControls = doc.createElement("div");
  stateControls.className = "zest-info-value zest-info-controls";
  const eff = effectiveStatus(item);
  const statusBtn = doc.createElement("button");
  statusBtn.type = "button";
  statusBtn.className = `zest-info-btn zest-info-status${
    eff.source === "auto" ? " zest-status-auto-text" : ""
  }`;
  statusBtn.textContent =
    eff.source === "none"
      ? getString("info-status-none")
      : eff.source === "auto"
        ? getString("status-auto-label", {
            args: { status: statusLabel(eff.status) },
          })
        : statusLabel(eff.status);
  statusBtn.title = getString("status-set-tip");
  statusBtn.disabled = !editable;
  statusBtn.addEventListener(
    "click",
    guard("info status", () => {
      const win = doc.defaultView as Window | null;
      if (!win) return;
      openStatusMenu({
        win,
        items: [item],
        anchor: statusBtn,
        onDone: () => refreshInfoSections(item.id),
      });
    }),
  );
  stateControls.appendChild(statusBtn);

  const stars = doc.createElement("span");
  stars.className = editable ? "zest-info-stars" : "zest-info-stars disabled";
  const rating = getRating(item) || 0;
  // same symbols and colour as the Rating column — two places showing the same
  // value must not disagree about what it looks like
  const mark = (getPref("rating.mark") as string) || "★";
  const option = (getPref("rating.option") as string) || mark;
  const starColor = (getPref("rating.color") as string) || "";
  if (starColor) stars.style.setProperty("--zest-star-color", starColor);
  for (let i = 1; i <= 5; i++) {
    const star = doc.createElement("button");
    star.type = "button";
    star.className = `zest-info-star${i <= rating ? " on" : ""}`;
    star.textContent = i <= rating ? mark : option;
    star.disabled = !editable;
    star.setAttribute(
      "aria-label",
      getString("info-rating-set", {
        args: { rating: i === rating ? i - 1 : i },
      }),
    );
    star.setAttribute("aria-pressed", String(i === rating));
    star.addEventListener(
      "click",
      guard("info rating", () => {
        if (!editable) return;
        if (state) state.ratingMessage = "";
        void setRating(item, i === rating ? i - 1 : i)
          .then(() => refreshInfoSections(item.id))
          .catch((e) => {
            ztoolkit.log("[info] rating save failed", e);
            if (
              state &&
              sections.get(body) === state &&
              state.itemID === item.id
            ) {
              state.ratingMessage = getString("info-rating-save-failed");
              if (sectionVisible(body, state, item))
                refreshInfoSections(item.id);
            }
          });
      }),
    );
    stars.appendChild(star);
  }
  stateControls.appendChild(stars);
  stateRow.appendChild(stateControls);
  workspace.appendChild(stateRow);
  const ratingFeedback = doc.createElement("span");
  ratingFeedback.className = "zest-info-feedback";
  ratingFeedback.setAttribute("role", "status");
  ratingFeedback.textContent = state?.ratingMessage || "";
  workspace.appendChild(ratingFeedback);

  const remarkRow = row(doc, getString("column-remark"));
  const input = doc.createElement("textarea");
  input.className = "zest-info-input";
  input.rows = 2;
  input.value = state?.remarkDraft ?? remarkOf(item);
  input.placeholder = getString("remark-prompt");
  input.setAttribute("aria-label", getString("column-remark"));
  input.disabled = !editable;
  if (state) state.remarkEditor = input;
  const draftCurrent = () =>
    !!state && sections.get(body) === state && state.itemID === item.id;
  input.addEventListener("input", () => {
    if (draftCurrent()) {
      state!.remarkDraft = input.value;
      state!.remarkMessage = "";
      remarkFeedback.textContent = "";
    }
  });
  const remarkFeedback = doc.createElement("span");
  remarkFeedback.className = "zest-info-feedback zest-info-remark-feedback";
  remarkFeedback.setAttribute("role", "status");
  remarkFeedback.textContent = state?.remarkMessage || "";
  input.addEventListener(
    "change",
    guard("info remark", async () => {
      if (!editable || !itemIsEditable(item) || !draftCurrent()) return;
      // The editor wraps visually, but Remark remains one owned Extra line.
      input.value = input.value.replace(/\r\n?|\n/g, " ");
      const value = input.value;
      state!.remarkDraft = value;
      try {
        await setRemark(item, value);
        if (draftCurrent() && state!.remarkDraft === value) {
          state!.remarkDraft = undefined;
          state!.remarkMessage = "";
          remarkFeedback.textContent = "";
        }
      } catch (e) {
        ztoolkit.log("[info] remark save failed", e);
        if (draftCurrent() && state!.remarkDraft === value) {
          state!.remarkMessage = getString("info-remark-save-failed");
          remarkFeedback.textContent = state!.remarkMessage;
          if (sectionVisible(body, state!, item)) refreshInfoSections(item.id);
        }
      }
    }),
  );
  remarkRow.appendChild(input);
  remarkRow.appendChild(remarkFeedback);
  workspace.appendChild(remarkRow);

  /* ---------- open in ---------- */
  const links = openLinks(item);
  if (links.length) {
    const r = row(doc, getString("info-open"));
    r.classList.add("zest-info-open");
    const group = doc.createElement("div");
    group.className = "zest-info-links";
    for (const link of links) {
      const a = doc.createElement("button");
      a.type = "button";
      a.className = "zest-info-link";
      a.textContent = link.label;
      a.addEventListener(
        "click",
        guard("info link", () => {
          try {
            Zotero.launchURL(link.url);
          } catch (e) {
            ztoolkit.log("[info] launch failed", e);
          }
        }),
      );
      group.appendChild(a);
    }
    r.appendChild(group);
    body.appendChild(r);
  }
  if (restoreEditor && selection) {
    input.focus?.({ preventScroll: true });
    input.setSelectionRange?.(...selection);
  }
}

/** Fold whole entries, never half a person's or institution's name. */
function addListDisclosure(
  doc: Document,
  host: HTMLElement,
  entries: HTMLElement[],
  state: SectionState | undefined,
  key: string,
  visibleIndices: Set<number>,
) {
  if (entries.every((_, i) => visibleIndices.has(i))) return;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "zest-info-text-toggle zest-info-metadata-toggle";
  let expanded = state?.openSections?.get(key) ?? false;
  const update = () => {
    const shown = entries.filter((_, i) => expanded || visibleIndices.has(i));
    const last = shown[shown.length - 1];
    entries.forEach((entry, i) => {
      entry.hidden = !expanded && !visibleIndices.has(i);
      const tail = entry.children[entry.children.length - 1] as
        HTMLElement | undefined;
      if (tail?.classList.contains("zest-info-author-separator"))
        tail.hidden = entry === last;
    });
    button.textContent = expanded
      ? getString("info-collapse")
      : getString(
          key === "authors" ? "info-authors-all" : "info-affiliations-all",
          { args: { count: entries.length } },
        );
    button.setAttribute("aria-expanded", String(expanded));
  };
  update();
  button.addEventListener("click", () => {
    expanded = !expanded;
    state?.openSections?.set(key, expanded);
    update();
  });
  host.appendChild(button);
}

function abstractText(
  doc: Document,
  raw: string,
  plainText = false,
): HTMLElement {
  const content = doc.createElement("div");
  content.className = "zest-info-abstract-text";
  for (const part of abstractParagraphs(raw, { plainText })) {
    const paragraph = doc.createElement("p");
    if (part.heading) {
      const heading = doc.createElement("strong");
      heading.className = "zest-info-abstract-heading";
      heading.textContent = part.heading;
      paragraph.appendChild(heading);
    }
    const text = doc.createElement("span");
    text.textContent = part.text;
    paragraph.appendChild(text);
    content.appendChild(paragraph);
  }
  return content;
}

function rememberDisclosure(
  details: HTMLDetailsElement,
  state: SectionState,
  key: string,
  initial: boolean,
) {
  details.open = state.openSections?.get(key) ?? initial;
  details.addEventListener("toggle", () => {
    // A queued toggle on an outgoing render must not change its successor.
    if (details.isConnected) state.openSections?.set(key, details.open);
  });
}

/** One source of display text; neither retrieval nor translation rewrites fields. */
function currentAbstract(item: Zotero.Item) {
  const online = cachedAbstract(item);
  let stored = "";
  try {
    stored = String(item.getField("abstractNote") || "").trim();
  } catch {
    // This item type may not have an abstract field.
  }
  return { online, text: online?.text || normalizeAbstractText(stored) };
}

function renderAbstract(
  doc: Document,
  body: HTMLElement,
  item: Zotero.Item,
  state: SectionState,
) {
  const identity = abstractIdentity(item);
  const key = identity?.key || "";
  if (state.abstractKey !== key) {
    state.abstractKey = key;
    state.abstractBusy = false;
    state.abstractRequest = undefined;
    state.abstractMessage = "";
  }
  const { online, text: primary } = currentAbstract(item);
  const translationKey = `${key}\u0000${primary}`;
  if (state.translationKey !== translationKey) {
    resetTranslation(state);
    state.translationKey = translationKey;
  }
  // An empty item needs no empty card or explanatory copy.
  if (!primary && !identity) return;
  const details = doc.createElement("details");
  details.className = "zest-info-card zest-info-abstract";
  rememberDisclosure(details, state, "abstract", true);
  const summary = doc.createElement("summary");
  summary.textContent = getString("info-abstract");
  details.appendChild(summary);

  const actions = doc.createElement("div");
  actions.className = "zest-info-abstract-actions";
  const source = doc.createElement("span");
  source.className = "zest-info-abstract-source";
  source.textContent = state.translationVisible
    ? getString("info-abstract-translation-source", {
        args: { source: state.translationSource || "" },
      })
    : online?.source || "";
  if (source.textContent) actions.appendChild(source);
  if (online) {
    const link = doc.createElement("button");
    link.type = "button";
    link.className = "zest-info-text-toggle";
    link.textContent = getString("info-abstract-source-link");
    link.addEventListener(
      "click",
      guard("abstract source", () => Zotero.launchURL(online.url)),
    );
    actions.appendChild(link);
  } else if (identity) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zest-abstract-fetch";
    button.textContent = getString(
      state.abstractBusy
        ? "info-abstract-loading"
        : primary
          ? "info-abstract-complete"
          : "info-abstract-fetch",
    );
    button.title = getString("info-abstract-fetch-tip");
    button.disabled = !!state.abstractBusy;
    button.setAttribute("aria-busy", String(!!state.abstractBusy));
    button.addEventListener("click", async () => {
      if (state.abstractBusy) return;
      if (
        !sectionVisible(body, state, item) ||
        abstractIdentity(item)?.key !== key
      )
        return;
      const request = {};
      state.abstractRequest = request;
      const current = () =>
        addon.data.alive &&
        sections.get(body) === state &&
        state.itemID === item.id &&
        state.abstractRequest === request &&
        state.abstractKey === key &&
        abstractIdentity(item)?.key === key;
      const valid = () =>
        current() &&
        !!getPref("info.abstract") &&
        sectionVisible(body, state, item);
      state.abstractBusy = true;
      state.abstractMessage = "";
      refreshInfoSections(item.id);
      try {
        const result = await fetchAbstract(item, { shouldContinue: valid });
        if (!valid()) return;
        const messages = {
          ok: null,
          missing: "info-abstract-missing",
          "no-id": "info-abstract-error",
          throttled: "info-abstract-throttled",
          unreachable: "info-abstract-offline",
          error: "info-abstract-error",
          cancelled: "info-abstract-error",
        } as const;
        const message = messages[result.kind];
        state.abstractMessage = message ? getString(message) : "";
      } catch (e) {
        ztoolkit.log("[info] abstract lookup failed", e);
        if (valid()) state.abstractMessage = getString("info-abstract-error");
      } finally {
        if (current()) {
          state.abstractBusy = false;
          state.abstractRequest = undefined;
          if (getPref("info.abstract") && sectionVisible(body, state, item))
            refreshInfoSections(item.id);
        }
      }
    });
    actions.appendChild(button);
  }
  if (primary) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "zest-info-text-toggle zest-abstract-translate";
    button.textContent = getString(
      state.translationBusy
        ? "info-abstract-translating"
        : state.translationVisible
          ? "info-abstract-original"
          : "info-abstract-translate",
    );
    button.disabled = !!state.translationBusy;
    button.setAttribute("aria-busy", String(!!state.translationBusy));
    button.setAttribute("aria-pressed", String(!!state.translationVisible));
    button.title = getString("info-abstract-translate-tip", {
      args: { source: translationProvider().label },
    });
    button.addEventListener("click", async () => {
      if (state.translationBusy || !sectionVisible(body, state, item)) return;
      const validContent = () =>
        addon.data.alive &&
        sections.get(body) === state &&
        state.itemID === item.id &&
        !!getPref("info.abstract") &&
        state.translationKey === translationKey &&
        (abstractIdentity(item)?.key || "") === key &&
        currentAbstract(item).text === primary;
      if (!validContent()) return;
      if (state.translationVisible || state.translationText) {
        state.translationVisible = !state.translationVisible;
        state.translationMessage = "";
        refreshInfoSections(item.id);
        return;
      }
      const request = {};
      state.translationRequest = request;
      const current = () =>
        validContent() && state.translationRequest === request;
      const valid = () => current() && sectionVisible(body, state, item);
      state.translationBusy = true;
      state.translationMessage = "";
      refreshInfoSections(item.id);
      try {
        const result = await translateAbstract(primary, {
          shouldContinue: valid,
        });
        if (!valid()) return;
        if (result.kind === "ok" && result.text) {
          state.translationText = result.text;
          state.translationSource = result.provider;
          state.translationVisible = true;
        } else {
          state.translationMessage = getString(
            result.kind === "throttled"
              ? "info-abstract-translation-throttled"
              : "info-abstract-translation-error",
          );
        }
      } catch {
        // Provider errors can carry credentials or raw text; never log them.
        if (valid())
          state.translationMessage = getString(
            "info-abstract-translation-error",
          );
      } finally {
        if (current()) {
          state.translationBusy = false;
          state.translationRequest = undefined;
          if (sectionVisible(body, state, item)) refreshInfoSections(item.id);
        }
      }
    });
    actions.appendChild(button);
  }
  details.appendChild(actions);
  const message = doc.createElement("div");
  message.className = "zest-info-feedback";
  message.setAttribute("role", "status");
  message.textContent = state.translationMessage || state.abstractMessage || "";
  details.appendChild(message);

  const displayed = state.translationVisible
    ? state.translationText || primary
    : primary;
  if (displayed) {
    const content = abstractText(doc, displayed, true);
    content.setAttribute(
      "data-language",
      state.translationVisible ? "translation" : "original",
    );
    details.appendChild(content);
    if (displayed.length > 900) {
      const expand = doc.createElement("button");
      expand.type = "button";
      expand.className = "zest-info-text-toggle zest-info-abstract-expand";
      let full = state.openSections?.get("abstract-full") ?? false;
      const update = () => {
        content.classList.toggle("zest-info-abstract-preview", !full);
        expand.textContent = getString(
          full ? "info-collapse" : "info-abstract-read-all",
        );
        expand.setAttribute("aria-expanded", String(full));
      };
      update();
      expand.addEventListener("click", () => {
        full = !full;
        state.openSections?.set("abstract-full", full);
        update();
      });
      details.appendChild(expand);
    }
  }
  body.appendChild(details);
}

/** Extra keys zotero-pdf-translate writes (read here, never written) */
const TITLE_TRANSLATION_KEYS = ["titleTranslation"];

/** clickable per-page heat: each segment opens the reader at that page */
function buildHeatStrip(
  doc: Document,
  item: Zotero.Item,
  rec: ReturnType<typeof readingStore.getForItem>,
): HTMLElement | null {
  if (!rec) return null;
  const alphas = heatAlphas(rec, 60);
  if (!alphas.length) return null;
  const wrap = doc.createElement("div");
  wrap.className = "zest-info-heat";
  const rgb = hexToRgb(heatColor()) || [102, 173, 255];
  const opacity = heatOpacity();
  const pages = Math.max(rec.pages || 0, alphas.length);
  alphas.forEach((t, i) => {
    const seg = doc.createElement("button");
    seg.type = "button";
    seg.tabIndex = i === 0 ? 0 : -1;
    seg.className = "zest-info-heat-seg";
    const level = heatLevel(t);
    const alpha = level ? HEAT_LEVELS[level - 1] * opacity : 0;
    seg.style.backgroundColor = alpha
      ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`
      : "transparent";
    const pageIndex = Math.round((i / alphas.length) * pages);
    seg.title = getString("info-heat-tip", { args: { page: pageIndex + 1 } });
    seg.setAttribute("aria-label", seg.title);
    seg.addEventListener("keydown", (ev: KeyboardEvent) => {
      const next =
        ev.key === "ArrowRight"
          ? i + 1
          : ev.key === "ArrowLeft"
            ? i - 1
            : ev.key === "Home"
              ? 0
              : ev.key === "End"
                ? alphas.length - 1
                : -1;
      if (next < 0 || next >= alphas.length) return;
      ev.preventDefault();
      const target = wrap.children[next] as HTMLButtonElement;
      for (const child of Array.from(wrap.children))
        (child as HTMLButtonElement).tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    });
    seg.addEventListener(
      "click",
      guard("info heat jump", () =>
        openAtPage(item, pageIndex, rec.primaryAtt),
      ),
    );
    wrap.appendChild(seg);
  });
  return wrap;
}

async function openAtPage(item: Zotero.Item, pageIndex: number, attKey = "") {
  try {
    // the heat belongs to ONE attachment — open that one, not whichever
    // attachment happens to sort first
    const attachment = attachmentFor(item, attKey);
    if (!attachment) return;
    await openAttachmentAt(attachment, { pageIndex });
  } catch (e) {
    ztoolkit.log("[info] open at page failed", e);
  }
}

/** the attachment a reading record was measured on, else the best one */
function attachmentFor(
  item: Zotero.Item,
  attKey: string,
): Zotero.Item | undefined {
  if (attKey) {
    const id = Zotero.Items.getIDFromLibraryAndKey(item.libraryID, attKey);
    const att = id ? Zotero.Items.get(id) : undefined;
    if (att instanceof Zotero.Item) return att;
  }
  return bestAttachment(item);
}

/**
 * One row of places to open the paper. Identifier-based where there is one
 * (DOI, PMID, arXiv), title search otherwise — the same ladder the sibling
 * Refs plugin uses. Zotero's own "View Online" and Locate menu cover DOI and
 * Google Scholar too; the row exists so that every destination is one click
 * from the same place.
 */
function openLinks(item: Zotero.Item): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  let doi = "";
  let title = "";
  let pmid = "";
  let arxiv = "";
  try {
    doi = String(item.getField("DOI") || "")
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    title = String(item.getField("title") || "").trim();
    pmid = String(item.getField("PMID") || "").trim();
    const extra = String(item.getField("extra") || "");
    if (!/^\d+$/.test(pmid)) pmid = extra.match(/^PMID:\s*(\d+)/im)?.[1] || "";
    arxiv =
      String(item.getField("archiveID") || "").match(/^arXiv:\s*(\S+)/i)?.[1] ||
      extra.match(/^arXiv:\s*(\S+)/im)?.[1] ||
      "";
  } catch {
    // unloaded
  }
  const q = encodeURIComponent(title);
  const hasCJK = /[\u3400-\u9fff]/.test(title);
  if (doi) out.push({ label: "DOI", url: `https://doi.org/${doi}` });
  if (pmid) {
    out.push({
      label: "PubMed",
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  } else if (title && !hasCJK) {
    out.push({
      label: "PubMed",
      url: `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`,
    });
  }
  if (arxiv)
    out.push({ label: "arXiv", url: `https://arxiv.org/abs/${arxiv}` });
  if (title) {
    out.push({
      label: "Google Scholar",
      url: `https://scholar.google.com/scholar?q=${q}`,
    });
  }
  if (doi) {
    out.push({
      label: "Semantic Scholar",
      url: `https://www.semanticscholar.org/search?q=${encodeURIComponent(doi)}`,
    });
    out.push({
      label: "OpenAlex",
      url: `https://openalex.org/works/doi:${encodeURIComponent(doi)}`,
    });
  } else if (title) {
    out.push({
      label: "Semantic Scholar",
      url: `https://www.semanticscholar.org/search?q=${q}`,
    });
    out.push({
      label: "OpenAlex",
      url: `https://openalex.org/works?search=${q}`,
    });
  }
  if (title) {
    out.push({
      label: "Connected Papers",
      url: `https://www.connectedpapers.com/search?q=${q}`,
    });
  }
  return out;
}
