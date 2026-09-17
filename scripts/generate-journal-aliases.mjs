#!/usr/bin/env node
/**
 * Offline, deterministic identity-only catalog generator.
 * Download the reviewed source files separately; this script never fetches.
 * See docs/journal-aliases-sources.md for provenance and reproduction.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { format } from "prettier";

const sources = {
  retrieved: "2026-09-17",
  nlm: {
    url: "https://ftp.ncbi.nlm.nih.gov/pubmed/J_Entrez.txt",
    lastModified: "2026-09-17T10:00:40Z",
    sha256: "55adbfe6d7b99c6e65d0e13cf67df9544c5152fc362b8703a0f58e644ad5234e",
    records: 42079,
  },
  showjcr: {
    revision: "c8da202c1d39373abdb5b5f936de712bb182ce0b",
    url:
      "https://raw.githubusercontent.com/hitfyd/ShowJCR/" +
      "c8da202c1d39373abdb5b5f936de712bb182ce0b/" +
      encodeURIComponent("中科院分区表及JCR原始数据文件") +
      "/JCR2025-UTF8.csv",
    sha256: "e9a0402f505264a796615bcec697f843af08dbce023ce67164c0f6f4709207c4",
    records: 22643,
  },
};

// Identity facts missing from the current two-ISSN NLM export. Each is
// explicitly published alongside the already matched journal's identifier.
// These are reviewed facts, not inferred predecessor/successor relationships.
const supplements = [
  {
    nlmId: "8900488",
    issns: ["1468-5833"],
    url: "https://www.bmj.com/content/suppl/2006/02/17/329.7478.DC1",
    reviewed: "2026-09-17",
  },
  {
    nlmId: "0217410",
    issns: ["2159-662X"],
    url: "https://jnm.snmjournals.org/content/66/5/793/tab-article-info",
    reviewed: "2026-09-17",
  },
];

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!["--nlm", "--showjcr", "--out", "--report"].includes(key) || !value)
    throw new Error(
      "Expected --nlm FILE --showjcr FILE [--out FILE] [--report FILE]",
    );
  if (args.has(key)) throw new Error(`Duplicate argument: ${key}`);
  args.set(key, value);
}
if (!args.has("--nlm") || !args.has("--showjcr"))
  throw new Error(
    "Expected --nlm FILE --showjcr FILE [--out FILE] [--report FILE]",
  );

async function readVerified(path, expectedHash) {
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
    throw new Error(`Source snapshot hash mismatch: ${path}`);
  return bytes.toString("utf8");
}

// Only identifiers passing the standard ISSN checksum enter the catalog.
function issn(value) {
  const text = value.trim().toUpperCase();
  if (!/^\d{4}-\d{3}[\dX]$/.test(text)) return "";
  const digits = text.replace("-", "");
  const sum = [...digits].reduce(
    (total, digit, index) =>
      total + (digit === "X" ? 10 : Number(digit)) * (8 - index),
    0,
  );
  return sum % 11 === 0 ? text : "";
}

// Must match the consumer's strict presentation-only catalog key. Never strip
// a subtitle, place, edition, article, or word to manufacture an identity link.
function titleKey(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function csv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (character === "," || character === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (character === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += character;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length) rows.push([...row, field.replace(/\r$/, "")]);
  return rows;
}

function addToSetMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

const [nlmText, showjcrText] = await Promise.all([
  readVerified(args.get("--nlm"), sources.nlm.sha256),
  readVerified(args.get("--showjcr"), sources.showjcr.sha256),
]);
const input = csv(showjcrText);
const header = input.shift().map((field) => field.replace(/^\uFEFF/, ""));
const indexes = ["Journal", "ISSN", "EISSN"].map((key) => header.indexOf(key));
if (indexes.some((index) => index < 0))
  throw new Error("Unknown ShowJCR schema");
const journals = input.map((row) => ({
  name: row[indexes[0]].trim(),
  issns: [
    ...new Set(
      indexes
        .slice(1)
        .map((i) => issn(row[i]))
        .filter(Boolean),
    ),
  ],
}));
const nlm = nlmText
  .split(/^-+\r?$/m)
  .map((block) =>
    Object.fromEntries(
      block
        .split(/\r?\n/)
        .map((line) => /^([^:]+):\s*(.*)$/.exec(line))
        .filter(Boolean)
        .map((match) => [match[1], match[2].trim()]),
    ),
  )
  .filter((record) => record.NlmId)
  .map((record) => ({
    id: record.NlmId,
    titles: [
      ...new Set(
        [record.JournalTitle, record.MedAbbr, record.IsoAbbr].filter(Boolean),
      ),
    ],
    issns: [
      ...new Set(
        [record["ISSN (Print)"], record["ISSN (Online)"]]
          .map(issn)
          .filter(Boolean),
      ),
    ],
  }));
if (
  journals.length !== sources.showjcr.records ||
  nlm.length !== sources.nlm.records
)
  throw new Error("Source record count mismatch");

const showjcrByISSN = new Map();
journals.forEach((journal, index) => {
  journal.issns.forEach((id) => addToSetMap(showjcrByISSN, id, index));
});
const sourceConflicts = [...showjcrByISSN].filter(
  ([, owners]) => owners.size > 1,
);
const candidates = new Map();
const bridgingRecords = [];
const unsafeJournals = new Set(
  sourceConflicts.flatMap(([, owners]) => [...owners]),
);
for (const record of nlm) {
  const matches = new Set(
    record.issns.flatMap((id) => [...(showjcrByISSN.get(id) || [])]),
  );
  if (matches.size > 1) {
    bridgingRecords.push({
      ...record,
      journals: [...matches].map((i) => journals[i].name),
    });
    matches.forEach((index) => unsafeJournals.add(index));
  } else if (matches.size === 1) {
    const index = [...matches][0];
    if (!candidates.has(index)) candidates.set(index, []);
    candidates.get(index).push(record);
  }
}
const multipleRecords = [...candidates]
  .filter(([, records]) => new Set(records.map((record) => record.id)).size > 1)
  .map(([index, records]) => ({ journal: journals[index].name, records }));
for (const [index, records] of candidates) {
  // Multiple NLM identities can be predecessor/successor titles or editions.
  // The source's ISSN overlap alone does not authorize combining their titles.
  if (new Set(records.map((record) => record.id)).size > 1)
    unsafeJournals.add(index);
}
const safe = [...candidates].filter(([index]) => !unsafeJournals.has(index));
const extraISSNs = new Map();
for (const supplement of supplements) {
  const target = safe.find(([, records]) => records[0].id === supplement.nlmId);
  if (!target) throw new Error(`Unmatched supplement: ${supplement.nlmId}`);
  const [targetIndex] = target;
  for (const id of supplement.issns) {
    if (!issn(id)) throw new Error(`Invalid supplement ISSN: ${id}`);
    const owners = showjcrByISSN.get(id) || new Set();
    if ([...owners].some((index) => index !== targetIndex))
      throw new Error(`Supplement conflicts with ShowJCR: ${id}`);
    if (
      nlm.some(
        (record) => record.id !== supplement.nlmId && record.issns.includes(id),
      )
    )
      throw new Error(`Supplement conflicts with NLM: ${id}`);
    addToSetMap(extraISSNs, targetIndex, id);
  }
}
const safeIdentity = new Map(
  safe.map(([index, records]) => [index, `nlm:${records[0].id}`]),
);

// Collision checks include ALL NLM records and ALL ShowJCR titles, so an alias
// cannot borrow an unrelated or historical journal's name outside the subset.
const titles = new Map();
const spellings = new Map();
function addTitle(title, identity) {
  const key = titleKey(title);
  addToSetMap(titles, key, identity);
  addToSetMap(spellings, key, title);
}
nlm.forEach((record) =>
  record.titles.forEach((title) => addTitle(title, `nlm:${record.id}`)),
);
journals.forEach((journal, index) =>
  addTitle(journal.name, safeIdentity.get(index) || `showjcr:${index}`),
);
const ambiguousKeys = new Set(
  [...titles].filter(([, owners]) => owners.size > 1).map(([key]) => key),
);
const ambiguities = [...ambiguousKeys]
  .map((key) => [...spellings.get(key)].sort()[0])
  .sort();
const entries = safe
  .map(([index, records]) => [
    journals[index].name,
    [...new Set(records.flatMap((record) => record.titles))].sort(),
    [
      ...new Set([
        ...journals[index].issns,
        ...records.flatMap((record) => record.issns),
        ...(extraISSNs.get(index) || []),
      ]),
    ].sort(),
  ])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const metadata = {
  ...sources,
  supplements,
  matchedJournals: entries.length,
  excludedBridgingRecords: bridgingRecords.length,
  excludedMultipleIdentityJournals: multipleRecords.length,
  ambiguousTitleKeys: ambiguities.length,
};
const source = `/**
 * Generated identity-only catalog. Do not edit by hand.
 * Sources and reproduction: docs/journal-aliases-sources.md.
 * No impact factors, rankings, or subject metrics are bundled here.
 */
export type JournalAliasTuple = readonly [
  name: string,
  aliases: readonly string[],
  issns: readonly string[],
];

export const JOURNAL_ALIAS_SOURCES = ${JSON.stringify(metadata, null, 2)} as const;

// Original observed spelling; consumers apply their strict catalog title key.
// An ambiguous name must not silently fall through to name-only dataset lookup.
export const JOURNAL_ALIAS_AMBIGUITIES: readonly string[] = ${JSON.stringify(ambiguities, null, 2)};

// prettier-ignore
export const JOURNAL_ALIAS_CATALOG: readonly JournalAliasTuple[] = [
${entries.map((entry) => `  ${JSON.stringify(entry)},`).join("\n")}
];
`;
const output = await format(source, {
  parser: "typescript",
  printWidth: 80,
  tabWidth: 2,
  endOfLine: "lf",
});
await writeFile(
  args.get("--out") ||
    fileURLToPath(
      new URL("../src/rank/journalAliases.generated.ts", import.meta.url),
    ),
  output,
);
const report = {
  ...metadata,
  bytes: Buffer.byteLength(output),
  aliases: entries.reduce((total, entry) => total + entry[1].length, 0),
  sourceConflicts: sourceConflicts.map(([id, owners]) => ({
    issn: id,
    journals: [...owners].map((i) => journals[i].name),
  })),
  bridgingRecords,
  multipleRecords,
  ambiguousTitles: [...ambiguousKeys].sort().map((key) => ({
    key,
    titles: [...spellings.get(key)].sort(),
    identities: [...titles.get(key)].sort(),
  })),
};
if (args.has("--report"))
  await writeFile(args.get("--report"), JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    { ...metadata, bytes: report.bytes, aliases: report.aliases },
    null,
    2,
  ),
);
