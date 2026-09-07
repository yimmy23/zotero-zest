import type { CardAnnotation } from "../panes/annotSection";
import { csvCell } from "../utils/csv";

/** A read-only snapshot: filtering never looks up Zotero items again. */
export interface MatrixRow extends CardAnnotation {
  itemTitle: string;
  itemID: number;
  itemIdentity: string;
  attachmentTitle: string;
  sourceURL: string;
  searchText: string;
}

export interface Filters {
  query: string;
  color: string;
  tag: string;
  item: string;
  type: string;
  commentsOnly: boolean;
  sort: "source" | "title";
}

export function emptyFilters(): Filters {
  return {
    query: "",
    color: "",
    tag: "",
    item: "",
    type: "",
    commentsOnly: false,
    sort: "source",
  };
}

type SearchRow = Pick<CardAnnotation, "text" | "comment" | "tags"> & {
  itemTitle: string;
  attachmentTitle?: string;
  searchText?: string;
};

interface Term {
  text: string;
  exclude: boolean;
}

/** Whitespace ANDs terms; pipes OR neighbours; quotes keep a phrase together. */
function compileQuery(query: string): Term[][] {
  const tokens: Array<Term | "|"> = [];
  let text = "";
  let quoted = false;
  const push = () => {
    if (!text) return;
    const exclude = text.startsWith("-");
    const value = exclude ? text.slice(1) : text;
    if (value) tokens.push({ text: value.toLowerCase(), exclude });
    text = "";
  };
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === "\\" && /["\\]/.test(query[i + 1] || "")) {
      text += query[++i];
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === "|") {
      push();
      tokens.push("|");
    } else if (!quoted && /\s/.test(char)) {
      push();
    } else {
      text += char;
    }
  }
  push();
  const groups: Term[][] = [];
  let alternative = false;
  for (const token of tokens) {
    if (token === "|") {
      alternative = true;
    } else {
      if (alternative && groups.length) groups[groups.length - 1].push(token);
      else groups.push([token]);
      alternative = false;
    }
  }
  return groups;
}

function searchText(row: SearchRow): string {
  return (
    row.searchText ??
    [
      row.text,
      row.comment,
      row.itemTitle,
      row.attachmentTitle,
      row.tags.join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  );
}

function matchesCompiled(text: string, groups: Term[][]): boolean {
  return groups.every((group) =>
    group.some((term) =>
      term.exclude ? !text.includes(term.text) : text.includes(term.text),
    ),
  );
}

/** Kept for scripts using the original matrix search API. */
export function matchesQuery(row: SearchRow, query: string): boolean {
  return matchesCompiled(searchText(row), compileQuery(query));
}

export function filterRows(rows: MatrixRow[], filters: Filters): MatrixRow[] {
  const query = compileQuery(filters.query);
  const color = filters.color.toLowerCase();
  const result = rows.filter(
    (row) =>
      (!color || row.color === color) &&
      (!filters.tag || row.tags.includes(filters.tag)) &&
      (!filters.item || row.itemIdentity === filters.item) &&
      (!filters.type || row.type === filters.type) &&
      (!filters.commentsOnly || !!row.comment.trim()) &&
      matchesCompiled(searchText(row), query),
  );
  // Stable sort retains native attachment / annotation reading order on ties.
  if (filters.sort === "title") {
    const collator = new Intl.Collator(undefined, { numeric: true });
    result.sort((a, b) => collator.compare(a.itemTitle, b.itemTitle));
  }
  return result;
}

export function toCSV(rows: MatrixRow[]): string {
  // Keep the original six columns first for existing spreadsheet workflows.
  const head =
    "item,page,text,comment,color,tags,type,attachment,sourceURL,itemIdentity,key";
  const lines = rows.map((row) =>
    [
      row.itemTitle,
      row.page,
      row.text,
      row.comment,
      row.color,
      row.tags.join("; "),
      row.type,
      row.attachmentTitle,
      row.sourceURL,
      row.itemIdentity,
      row.key,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head, ...lines].join("\n");
}

export interface MarkdownLabels {
  comment?: string;
  page?: string;
  tags?: string;
  source?: string;
}

/** Exported text is content, never Markdown/HTML supplied by an annotation. */
function markdownText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&");
}

function inlineText(value: string): string {
  return markdownText(value).replace(/\r\n?|\n/g, " ");
}

function quote(value: string): string {
  return markdownText(value)
    .split(/\r\n?|\n/)
    .map((line) => `> ${line}  `)
    .join("\n");
}

function safeSourceURL(url: string): string {
  return /^zotero:\/\/(?:open|open-pdf)\/(?:library|groups\/\d+)\/items\/[A-Z0-9]+(?:\?[^\s<>()[\]"']*)?$/.test(
    url,
  )
    ? url
    : "";
}

export function toMarkdown(
  rows: MatrixRow[],
  labels: MarkdownLabels = {},
): string {
  const groups = new Map<string, MatrixRow[]>();
  for (const row of rows) {
    const key = row.itemIdentity;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const out: string[] = [];
  for (const group of groups.values()) {
    out.push(`## ${inlineText(group[0].itemTitle)}`, "");
    for (const row of group) {
      const source = [
        row.attachmentTitle,
        row.page ? `${labels.page || "§"} ${row.page}` : "",
        row.type,
      ]
        .filter(Boolean)
        .map(inlineText)
        .join(" · ");
      const url = safeSourceURL(row.sourceURL);
      const linkLabel = inlineText(labels.source || "↗");
      out.push(`- ${source}${url ? ` · [${linkLabel}](${url})` : ""}`, "");
      if (row.text) out.push(quote(row.text), "");
      if (row.comment) {
        out.push(
          `${inlineText(labels.comment || "↳")}:`,
          "",
          quote(row.comment),
          "",
        );
      }
      if (row.tags.length) {
        out.push(
          `${inlineText(labels.tags || "#")}: ${row.tags.map(inlineText).join(" · ")}`,
          "",
        );
      }
    }
  }
  return out.join("\n");
}
