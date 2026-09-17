/** Public-API journal matching checks; never save or modify library items. */
if (
  !String(PathUtils.profileDir).endsWith("/source/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/source/.scaffold/dev-data")
)
  throw new Error("Isolated profile required");
const out = { ok: [], fail: [], notes: [] };
const check = (name, pass) => (pass ? out.ok : out.fail).push(name);
const api = Zotero.Zest?.api;
const canonical = "Journal of Clinical and Experimental Hematopathology";
const original = "Journal of clinical and experimental hematopathology : JCEH";
if (!api?.impactFactor) throw new Error("Initialized Zest API required");
const cases = [
  [original, ""],
  [canonical, ""],
  ["Journal of clinical and experimental hematopathology：JCEH.", ""],
  ["J Clin Exp Hematop", ""],
  ["J. Clin. Exp. Hematop.", ""],
  [original, "1346-4280"],
  [original, "1880-9952"],
  [original, "1346-4280, 1880-9952"],
];
for (const [title, issn] of cases) {
  const item = new Zotero.Item("journalArticle");
  item.setField("publicationTitle", title);
  item.setField("ISSN", issn);
  item.setField("extra", "Custom: preserved");
  const values = api.journalRanks(item);
  check(
    `IF 1.4: ${title} / ${issn || "no ISSN"}`,
    api.impactFactor(item) === 1.4,
  );
  check(
    `ShowJCR Q4: ${title} / ${issn || "no ISSN"}`,
    values.some(
      (value) =>
        value.field === "sci" &&
        value.value === "Q4" &&
        value.source === "dataset",
    ),
  );
  check(
    `metadata unchanged: ${title} / ${issn || "no ISSN"}`,
    !item.id &&
      item.getField("publicationTitle") === title &&
      item.getField("ISSN") === issn &&
      item.getField("extra") === "Custom: preserved",
  );
}
const other = new Zotero.Item("journalArticle");
other.setField("publicationTitle", "Journal of Hematopathology");
check("distinct journal retains its own IF", api.impactFactor(other) === 1);
for (const title of [
  "JCEH",
  `${canonical}: Experimental Studies`,
  `${canonical} (another edition)`,
]) {
  const item = new Zotero.Item("journalArticle");
  item.setField("publicationTitle", title);
  check(
    `ambiguous or different title remains unmatched: ${title}`,
    api.impactFactor(item) === null,
  );
}
out.notes.push(`Zotero ${Zotero.version}, Zest ${api.version}`);
out.passed = out.fail.length === 0;
return out;
