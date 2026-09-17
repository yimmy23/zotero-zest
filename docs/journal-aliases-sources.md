# Verified journal title catalog

`src/rank/journalAliases.generated.ts` contains journal identities only: a
ShowJCR title, NLM title/abbreviation spellings, and verified ISSNs. It contains
no impact factors, quartiles, rankings, or subject metrics. It is bundled so
normal use never needs an additional network request.

## Sources

- [NLM: List of All Journals Cited in PubMed](https://www.nlm.nih.gov/bsd/serfile_addedinfo.html)
  documents the official
  [J_Entrez.txt export](https://ftp.ncbi.nlm.nih.gov/pubmed/J_Entrez.txt).
  `JournalTitle`, `MedAbbr`, and `IsoAbbr` are explicitly supplied title forms;
  `ISSN (Print)`, `ISSN (Online)`, and `NlmId` identify the catalog record.
  The list includes historical and non-MEDLINE titles, so a shared word or
  abbreviation does not prove that two records are the same journal.
- ShowJCR uses the same pinned 2025 CSV revision as
  `src/rank/sources/showjcrDownload.ts`:
  `c8da202c1d39373abdb5b5f936de712bb182ce0b`. Only `Journal`, `ISSN`, and
  `EISSN` are retained for this catalog.
- Two additional electronic ISSNs are directly documented by their publishers:
  [BMJ's subscription information](https://www.bmj.com/content/suppl/2006/02/17/329.7478.DC1)
  identifies `1468-5833` as bmj.com and lists `0959-8138` for its clinical
  research edition; [Journal of Nuclear Medicine article information](https://jnm.snmjournals.org/content/66/5/793/tab-article-info)
  identifies print `0161-5505` and online `2159-662X`. These two reviewed
  identifier additions are recorded with their NLM record IDs and source URLs
  in the generator. The generator rejects additions that conflict with either
  source's other journal identities.

## Reviewed snapshot

Retrieved on 2026-09-17. The NLM response reported
`Last-Modified: Thu, 17 Sep 2026 10:00:40 GMT`.

| Input                      | Records | SHA-256                                                            |
| -------------------------- | ------: | ------------------------------------------------------------------ |
| NLM `J_Entrez.txt`         |  42,079 | `55adbfe6d7b99c6e65d0e13cf67df9544c5152fc362b8703a0f58e644ad5234e` |
| ShowJCR `JCR2025-UTF8.csv` |  22,643 | `e9a0402f505264a796615bcec697f843af08dbce023ce67164c0f6f4709207c4` |

The generated catalog has 14,065 journals and 27,525 NLM title/abbreviation
spellings. This is the verified intersection of these snapshots; it is not a
claim to cover every journal or every abbreviation. Unmatched titles retain
the existing normal lookup behavior. The generated TypeScript is approximately
1.65 MiB before packaging/compression.

## Identity and ambiguity rules

1. An ISSN must pass its checksum before it can link records. Neither titles nor
   impact factors select a catalog identity.
2. An NLM record must match exactly one ShowJCR row by ISSN. A record that
   bridges distinct ShowJCR rows is excluded, and neither affected row receives
   generated aliases. This snapshot has one such record: NLM `100966531`
   combines the print ISSN of _American Political Science Review_ with the
   online ISSN of _Perspectives on Politics_. The generator does not guess
   which identifier is wrong.
3. A ShowJCR row must link to exactly one distinct NLM record ID. All 23 rows
   linked to multiple NLM IDs are excluded from generated aliases. Examples
   include the Nephron subjournals and historical Auk/Ornithology titles.
   Predecessor journals do not inherit current journal identities automatically.
4. Title collision checks include all 42,079 NLM records and all 22,643 ShowJCR
   titles, including records outside the final intersection. They produce 390
   ambiguous presentation-normalized title keys. Their original spellings are
   exported separately so a name-only lookup cannot silently fall back to a
   different journal. There are 155 catalog entries whose short canonical name
   is ambiguous, including _Medicine_ and _Science_; their specific NLM titles
   remain useful when unambiguous and must retain their identifier evidence.
5. Title keys normalize Unicode presentation, case, whitespace, and punctuation
   only. The generator does not remove subtitles, locations, editions, leading
   articles, or words, and performs no fuzzy matching.

A platform identifier is not automatically a journal identifier. For example,
[Cochrane describes `1465-1858` as the Cochrane Library](https://www.cochrane.org/zh-hant/about-us/our-products-and-services),
a collection containing several databases. It is not added as an alias for the
Cochrane Database of Systematic Reviews journal's `1469-493X` identifier.

## Reproduce offline

Keep the two reviewed input snapshots outside the repository. The NLM export
changes daily; downloading a newer version does not reproduce this snapshot.
The generator verifies both hashes and record counts before writing output.

```sh
node scripts/generate-journal-aliases.mjs \
  --nlm /path/to/reviewed/J_Entrez.txt \
  --showjcr /path/to/reviewed/JCR2025-UTF8.csv \
  --report /path/to/journal-aliases-generation-report.json
```

The generator uses Node and the repository's existing Prettier development
dependency. `--out /path/to/journalAliases.generated.ts` writes an independent
copy for byte-for-byte comparison. It performs no network requests and is not
part of the normal build. The optional report records excluded identity bridges,
multiple-record journals, and every ambiguous key with its source identities.

To update the catalog, review a new NLM snapshot and the pinned ShowJCR revision,
update the generator's hashes/counts/provenance, inspect its ambiguity report,
and rerun the normalizer and dataset regression checks. Never replace the
generated file with an unreviewed live download during application startup or
build.
