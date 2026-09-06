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

/**
 * "Zest" item-pane section — the one place that answers "what is this paper,
 * and where am I with it": the title (with its translation when there is
 * one), every author on one line, venue with its rank badges, citation count,
 * reading time with the clickable per-page heat strip, read status, rating,
 * the remark, one row of places to open the paper, and the abstract —
 * translation first.
 *
 * Everything here is a view over data that already exists: reading time from
 * zest.sqlite, rating/status/remark from Extra, ranks and citations from the
 * caches the columns use, translations from the Extra lines the translation
 * plugin (zotero-pdf-translate) writes. Nothing is fetched while rendering;
 * the journal lookup is only queued (and only if the user opted into remote
 * lookups). Zest never translates and never writes those lines — it shows
 * them, whole (an abstract translation runs over several paragraphs, which
 * the plugin's own row truncates).
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
}
const sections = new Map<HTMLElement, SectionState>();

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
    const shouldContinue = () => sectionVisible(body, state, item);
    if (!shouldContinue()) return;
    void ensureAuthorships([item], { automatic: true, shouldContinue })
      .then((changed) => {
        if (changed && shouldContinue()) refreshInfoSections(item.id);
      })
      .catch((e) => ztoolkit.log("[info] affiliation lookup failed", e));
  }, 400);
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
  if (state) cancelTopUp(state);
  body.textContent = "";
  body.classList.add("zest-info");

  if (!wantsSection(item) || !item) {
    props.setEnabled?.(false);
    return;
  }
  props.setEnabled?.(true);
  // group libraries and read-only feeds render the section, but every write
  // would fail silently — show the values, disable the controls
  const editable = props.editable !== false && itemIsEditable(item);

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
      body.appendChild(r);
    }
  }

  /* ---------- authors: every one, on one line, with the user's rules ---------- */
  const authors = formatAuthors(item, panelAuthorOptions());
  if (authors.parts.length) {
    const r = row(doc, getString("info-authors"));
    const value = doc.createElement("span");
    value.className = "zest-info-value zest-info-authors";
    for (const part of authors.parts) {
      if (!part.kind && !part.creator) {
        value.appendChild(doc.createTextNode(part.text));
        continue;
      }
      const span = doc.createElement("span");
      if (part.kind) span.className = `zest-author-${part.kind}`;
      span.textContent = part.text;
      if (part.creator) {
        // a name is a handle on the person: filter the library, search online
        const creator = part.creator;
        span.style.cursor = "pointer";
        span.title = getString("author-click-tip");
        span.addEventListener("click", (ev: MouseEvent) => {
          ev.stopPropagation();
          const oa = findCachedAuthor(item, creator.family, creator.given);
          openAuthorMenu(
            doc.defaultView as Window,
            {
              family: creator.family,
              given: creator.given,
              oaId: oa?.i,
              label: part.text,
            },
            { screenX: ev.screenX, screenY: ev.screenY },
          );
        });
      }
      value.appendChild(span);
    }
    value.title = getString("authors-cell-tip", {
      args: { count: authors.total },
    });
    r.appendChild(value);
    body.appendChild(r);
  }

  /* ---------- affiliations (OpenAlex authorship cache) ----------
     Zotero stores no creator affiliation, so this is the cached OpenAlex
     data the author graph keys on. Nothing is fetched while rendering —
     a missing record only queues the bounded background top-up. */
  {
    const oaRows = cachedAuthorships(item);
    const insts: string[] = [];
    for (const a of oaRows || []) {
      if (a.a && !insts.includes(a.a)) insts.push(a.a);
    }
    if (insts.length) {
      const r = row(doc, getString("info-affiliations"));
      const value = doc.createElement("span");
      value.className = "zest-info-value";
      const MAX_SHOWN = 3;
      const shown = insts
        .slice(0, MAX_SHOWN)
        .join(getString("info-affiliations-sep"));
      value.textContent =
        insts.length > MAX_SHOWN
          ? getString("info-affiliations-more", {
              args: { list: shown, count: insts.length - MAX_SHOWN },
            })
          : shown;
      // who is where — the verification view
      value.title = (oaRows || [])
        .filter((a) => a.a)
        .map((a) => `${a.n} — ${a.a}`)
        .join("\n");
      r.appendChild(value);
      body.appendChild(r);
    } else if (state && item.getField("DOI")) {
      const r = row(doc, getString("info-affiliations"));
      const value = doc.createElement("span");
      value.className = "zest-info-value";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "zest-affiliations-fetch";
      button.textContent = getString("info-affiliations-fetch");
      button.title = getString("info-affiliations-fetch-tip");
      const message = doc.createElement("span");
      message.className = "zest-info-feedback";
      message.setAttribute("role", "status");
      button.addEventListener("click", async () => {
        cancelTopUp(state);
        const shouldContinue = () =>
          sectionVisible(body, state, item) && button.isConnected;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        message.textContent = getString("info-affiliations-loading");
        try {
          const changed = await ensureAuthorships([item], { shouldContinue });
          if (!shouldContinue()) return;
          if (changed) refreshInfoSections(item.id);
          else message.textContent = getString("info-affiliations-unavailable");
        } catch (e) {
          ztoolkit.log("[info] affiliation lookup failed", e);
          if (shouldContinue()) {
            message.textContent = getString("info-affiliations-unavailable");
          }
        } finally {
          if (button.isConnected) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
          }
        }
      });
      value.append(button, message);
      r.appendChild(value);
      body.appendChild(r);
      if (!oaRows && getPref("info.affiliations.autoFetch") === true) {
        queueAuthorshipTopUp(item, body, state);
      }
    }
  }

  /* ---------- venue + ranks ---------- */
  const venue = venueOf(item);
  if (venue) {
    const r = row(doc, getString("info-venue"));
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
    body.appendChild(r);
  }

  /* ---------- citations ---------- */
  const cites = citationOf(item);
  const citeRow = row(doc, getString("info-citations"));
  citeRow.classList.add("zest-info-divider");
  const citeControls = doc.createElement("div");
  citeControls.className = "zest-info-value zest-info-controls";
  const citeValue = doc.createElement("span");
  citeValue.className = "zest-info-value";
  citeValue.textContent = cites
    ? `${cites.count} · ${cites.source ?? "?"} · ${cites.date ?? "—"}`
    : getString("info-citations-none");
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
  body.appendChild(citeRow);

  /* ---------- reading ---------- */
  const rec = readingStore.getForItem(item);
  const readRow = row(doc, getString("info-reading"));
  readRow.classList.add("zest-info-divider");
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
  body.appendChild(readRow);

  if (rec) {
    const strip = buildHeatStrip(doc, item, rec);
    if (strip) body.appendChild(strip);
  }

  /* ---------- status / rating / remark ---------- */
  const stateRow = row(doc, getString("info-status"));
  const stateControls = doc.createElement("div");
  stateControls.className = "zest-info-value zest-info-controls";
  const eff = effectiveStatus(item);
  const statusBtn = doc.createElement("button");
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
    const star = doc.createElement("span");
    star.className = `zest-info-star${i <= rating ? " on" : ""}`;
    star.textContent = i <= rating ? mark : option;
    star.addEventListener(
      "click",
      guard("info rating", () => {
        if (!editable) return;
        void setRating(item, i === rating ? i - 1 : i).then(() =>
          refreshInfoSections(item.id),
        );
      }),
    );
    stars.appendChild(star);
  }
  stateControls.appendChild(stars);
  stateRow.appendChild(stateControls);
  body.appendChild(stateRow);

  const remarkRow = row(doc, getString("column-remark"));
  const input = doc.createElement("input");
  input.className = "zest-info-input";
  input.type = "text";
  input.value = remarkOf(item);
  input.placeholder = getString("remark-prompt");
  input.disabled = !editable;
  input.addEventListener(
    "change",
    guard("info remark", () => {
      void setRemark(item, input.value);
    }),
  );
  remarkRow.appendChild(input);
  body.appendChild(remarkRow);

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

  /* ---------- abstract: translation first, original underneath ---------- */
  if (getPref("info.abstract")) {
    let abstract: string;
    try {
      abstract = String(item.getField("abstractNote") || "").trim();
    } catch {
      abstract = "";
    }
    const translation =
      getExtraBlock(item, ABSTRACT_TRANSLATION_KEYS)?.value || "";
    if (abstract || translation) {
      const details = doc.createElement("details");
      details.className = "zest-info-abstract";
      // a translation is what the reader came for: open; the original alone
      // is also in Zotero's own Abstract section, so it stays folded
      details.open = !!translation;
      const summary = doc.createElement("summary");
      summary.textContent = getString("info-abstract");
      details.appendChild(summary);
      if (translation) {
        const zh = doc.createElement("div");
        zh.className = "zest-info-abstract-text zest-info-translation";
        zh.textContent = translation;
        details.appendChild(zh);
      }
      if (abstract) {
        const text = doc.createElement("div");
        text.className = "zest-info-abstract-text";
        text.textContent = abstract;
        if (translation) {
          const original = doc.createElement("details");
          original.className = "zest-info-abstract-original";
          const s2 = doc.createElement("summary");
          s2.textContent = getString("info-original");
          original.appendChild(s2);
          original.appendChild(text);
          details.appendChild(original);
        } else {
          details.appendChild(text);
        }
      }
      body.appendChild(details);
    }
  }
}

/** Extra keys zotero-pdf-translate writes (read here, never written) */
const TITLE_TRANSLATION_KEYS = ["titleTranslation"];
const ABSTRACT_TRANSLATION_KEYS = ["abstractTranslation"];

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
    const seg = doc.createElement("span");
    seg.className = "zest-info-heat-seg";
    const level = heatLevel(t);
    const alpha = level ? HEAT_LEVELS[level - 1] * opacity : 0;
    seg.style.backgroundColor = alpha
      ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`
      : "transparent";
    const pageIndex = Math.round((i / alphas.length) * pages);
    seg.title = getString("info-heat-tip", { args: { page: pageIndex + 1 } });
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
