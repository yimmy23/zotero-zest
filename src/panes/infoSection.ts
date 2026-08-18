import { config } from "../../package.json";
import { getString, getLocaleID } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { guard } from "../utils/guard";
import { readingStore, formatDuration, pagesSeen } from "../reading/store";
import { heatAlphas } from "../reading/heat";
import { heatColor, heatOpacity } from "../columns/reading";
import { hexToRgb } from "../reading/heat";
import { HEAT_LEVELS } from "../ui/palette";
import {
  getReadStatus,
  setReadStatus,
  nextStatus,
  READ_STATUSES,
} from "../reading/status";
import { getRating, setRating } from "../columns/rating";
import { remarkOf, setRemark } from "../columns/remark";
import { getJournalRecord, requestJournalRecord, displayValues } from "../rank";
import { displayFields, colorForRank, defaultRankColor } from "../rank/rank";
import { citationOf, updateCitations } from "../cite";
import { venueOf } from "../rank/normalize";
import { formatAuthors } from "../authors/pipeline";
import { etAlText } from "../columns/authors";
import { bestAttachment, itemIsEditable } from "../utils/items";
import { iconButton } from "../ui/icons";

/**
 * "Zest" item-pane section — the one place that answers "what is this paper,
 * and where am I with it".
 *
 * Everything here is a view over data that already exists: reading time from
 * zest.sqlite, rating/status/remark from Extra, ranks and citations from the
 * caches the columns use. Nothing is fetched while rendering; the journal
 * lookup is only queued (and only if the user opted into remote lookups).
 *
 * The per-page heat strip is clickable: clicking a segment opens the reader at
 * that page, which is what the original plugin's "energy bar" promised.
 */

let sectionID: string | false = false;
const refreshers = new Map<Element, () => void>();

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
        if (props?.body && typeof props.refresh === "function") {
          refreshers.set(props.body, props.refresh);
        }
      } catch (e) {
        ztoolkit.log("[info] onInit failed", e);
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
        render(props);
      } catch (e) {
        ztoolkit.log("[info] render failed", e);
      }
    },
  });
  sectionID = typeof result === "string" ? result : false;
}

export function unregisterInfoSection() {
  refreshers.clear();
  if (!sectionID) return;
  try {
    (Zotero as any).ItemPaneManager?.unregisterSection?.(sectionID);
  } catch (e) {
    ztoolkit.log("[info] unregister failed", e);
  }
  sectionID = false;
}

export function refreshInfoSections() {
  for (const refresh of refreshers.values()) {
    try {
      refresh();
    } catch {
      // stale container
    }
  }
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
  body.textContent = "";
  body.classList.add("zest-info");

  if (
    !getPref("info.enable") ||
    !item ||
    !(item instanceof Zotero.Item) ||
    !item.isRegularItem()
  ) {
    props.setEnabled?.(false);
    return;
  }
  props.setEnabled?.(true);
  // group libraries and read-only feeds render the section, but every write
  // would fail silently — show the values, disable the controls
  const editable = props.editable !== false && itemIsEditable(item);

  /* ---------- authors + venue ---------- */
  const authors = formatAuthors(item, {
    policy: { kind: "first", n: 3, etAl: "append" },
    rules: { order: "auto", given: "full", initialsDot: true },
    etAlText: etAlText(),
  });
  if (authors.parts.length) {
    const r = row(doc, getString("info-authors"));
    const value = doc.createElement("span");
    value.className = "zest-info-value";
    value.textContent = authors.parts.map((p) => p.text).join("");
    r.appendChild(value);
    body.appendChild(r);
  }

  const venue = venueOf(item);
  if (venue) {
    const r = row(doc, getString("info-venue"));
    const value = doc.createElement("span");
    value.className = "zest-info-value";
    value.textContent = venue;
    r.appendChild(value);
    // rank badges, if we already know them (never fetched during a render)
    requestJournalRecord(item);
    const rec = getJournalRecord(item);
    for (const v of displayValues(rec, displayFields()).slice(0, 3)) {
      const badge = doc.createElement("span");
      badge.className = "zest-badge zest-rank-badge";
      badge.textContent = v.value;
      badge.title = `${v.field} · ${v.source}`;
      const rgb = hexToRgb(v.rank ? colorForRank(v.rank) : defaultRankColor());
      if (rgb) {
        badge.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},.15)`;
      }
      r.appendChild(badge);
    }
    body.appendChild(r);
  }

  /* ---------- citations ---------- */
  const cites = citationOf(item);
  const citeRow = row(doc, getString("info-citations"));
  const citeValue = doc.createElement("span");
  citeValue.className = "zest-info-value";
  citeValue.textContent = cites
    ? `${cites.count} · ${cites.source ?? "?"} · ${cites.date ?? "—"}`
    : getString("info-citations-none");
  citeRow.appendChild(citeValue);
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
      void updateCitations(item, true).then(() => refreshInfoSections());
    }),
  );
  citeRow.appendChild(refresh);
  body.appendChild(citeRow);

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
  body.appendChild(readRow);

  if (rec) {
    const strip = buildHeatStrip(doc, item, rec);
    if (strip) body.appendChild(strip);
  }

  /* ---------- status / rating / remark ---------- */
  const stateRow = row(doc, getString("info-status"));
  const status = getReadStatus(item);
  const statusBtn = doc.createElement("button");
  statusBtn.className = "zest-info-btn";
  statusBtn.textContent = status
    ? getString(statusStringID(status))
    : getString("info-status-none");
  statusBtn.disabled = !editable;
  statusBtn.addEventListener(
    "click",
    guard("info status", () => {
      void setReadStatus(item, nextStatus(status)).then(() =>
        refreshInfoSections(),
      );
    }),
  );
  stateRow.appendChild(statusBtn);

  const stars = doc.createElement("span");
  stars.className = editable ? "zest-info-stars" : "zest-info-stars disabled";
  const rating = getRating(item) || 0;
  for (let i = 1; i <= 5; i++) {
    const star = doc.createElement("span");
    star.className = `zest-info-star${i <= rating ? " on" : ""}`;
    star.textContent = "★";
    star.addEventListener(
      "click",
      guard("info rating", () => {
        if (!editable) return;
        void setRating(item, i === rating ? i - 1 : i).then(() =>
          refreshInfoSections(),
        );
      }),
    );
    stars.appendChild(star);
  }
  stateRow.appendChild(stars);
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

  /* ---------- abstract ---------- */
  if (getPref("info.abstract")) {
    let abstract: string;
    try {
      abstract = String(item.getField("abstractNote") || "");
    } catch {
      abstract = "";
    }
    if (abstract) {
      const details = doc.createElement("details");
      details.className = "zest-info-abstract";
      const summary = doc.createElement("summary");
      summary.textContent = getString("info-abstract");
      details.appendChild(summary);
      const text = doc.createElement("div");
      text.textContent = abstract;
      details.appendChild(text);
      body.appendChild(details);
    }
  }

  /* ---------- open in ---------- */
  const links = openLinks(item);
  if (links.length) {
    const r = row(doc, getString("info-open"));
    for (const link of links) {
      const a = doc.createElement("button");
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
      r.appendChild(a);
    }
    body.appendChild(r);
  }
}

function statusStringID(status: string): any {
  const map: Record<string, string> = {
    New: "status-new",
    "To Read": "status-to-read",
    "In Progress": "status-in-progress",
    Read: "status-read",
    "Not Reading": "status-not-reading",
  };
  return map[status] || "status-new";
}

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
    const level = t <= 0.005 ? 0 : Math.min(4, Math.max(1, Math.ceil(t * 4)));
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
    const location = { pageIndex };
    const handlers = (Zotero as any).FileHandlers;
    if (handlers?.open) {
      await handlers.open(attachment, { location });
      return;
    }
    await Zotero.Reader.open(attachment.id, location as any);
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

function openLinks(item: Zotero.Item): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  let doi = "";
  let title = "";
  let pmid = "";
  try {
    doi = String(item.getField("DOI") || "").replace(
      /^https?:\/\/(dx\.)?doi\.org\//i,
      "",
    );
    title = String(item.getField("title") || "");
    const extra = String(item.getField("extra") || "");
    pmid = extra.match(/^PMID:\s*(\d+)/im)?.[1] || "";
  } catch {
    // unloaded
  }
  if (doi) {
    out.push({ label: "DOI", url: `https://doi.org/${doi}` });
    out.push({
      label: "Semantic Scholar",
      url: `https://www.semanticscholar.org/search?q=${encodeURIComponent(doi)}`,
    });
  }
  if (pmid)
    out.push({
      label: "PubMed",
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  if (title) {
    out.push({
      label: "Google Scholar",
      url: `https://scholar.google.com/scholar?q=${encodeURIComponent(title)}`,
    });
  }
  return out;
}

export { READ_STATUSES };
