# Verified journal aliases

Zest keeps three small, reviewed identity records in `src/rank/normalize.ts`.
It does not bundle a general journal catalogue. Other journals use the item's
title and ISSN with the user's enabled data sources; unsupported variants may
remain unmatched. No item metadata is rewritten.

| Journal                                              | Supported alternate forms                         | Verified ISSNs       |
| ---------------------------------------------------- | ------------------------------------------------- | -------------------- |
| Cancer Immunology, Immunotherapy                     | Cancer Immunology, Immunotherapy : CII            | 0340-7004; 1432-0851 |
| Journal of Clinical and Experimental Hematopathology | Full title followed by : JCEH; J Clin Exp Hematop | 1346-4280; 1880-9952 |
| New England Journal of Medicine                      | The New England journal of medicine; N Engl J Med | 0028-4793; 1533-4406 |

Case, whitespace and presentation punctuation are normalized. Bare acronyms
such as `CII` and `JCEH` are not expanded. Real subtitles, locations, editions
and historical title differences are retained. A conflicting explicit ISSN
cannot borrow the metrics of one of these verified identities. The NEJM record
preserves the wrong-ISSN safeguard found during a real-library audit.

## Sources

- CII: [NLM catalogue](https://www.ncbi.nlm.nih.gov/nlmcatalog/8605732) and
  [Springer](https://link.springer.com/journal/262).
- JCEH: [NLM catalogue](https://www.ncbi.nlm.nih.gov/nlmcatalog/101141257) and
  [J-STAGE](https://www.jstage.jst.go.jp/browse/jslrt/_pubinfo/-char/en).
- NEJM: the official [NLM journal export](https://ftp.ncbi.nlm.nih.gov/pubmed/J_Entrez.txt)
  reviewed on 2026-09-17, corroborated by the ShowJCR 2025 snapshot pinned in
  `src/rank/sources/showjcrDownload.ts`.

New exceptions should solve a reproduced problem, include source evidence and
regression coverage, and stay small. `npm run build` enforces a 350 KiB XPI
budget; raising it requires an explicit review of the size tradeoff.
