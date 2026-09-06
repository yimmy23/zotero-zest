# ---- columns ----
column-reading = Reading
column-status = Status
column-rating = Rating
column-tags = Tags
column-texttags = #Tags
column-annots = Annotations
annots-cell-tip = { $count } annotations · { $chars } characters highlighted or commented

reading-cell-tip = { $time } read · { $read } pages seen{ $pages }

status-new = New
status-to-read = To Read
status-in-progress = In Progress
status-read = Read
status-not-reading = Not Reading
status-set-tip = Click to set the read status
status-auto-tip = Read from your reading: { $status } — click to set it yourself
status-auto-label = { $status } (auto)
status-menu-header-none = No status
status-menu-header-auto = Now: { $status } (read from your reading)
status-menu-header-manual = Now: { $status }
status-menu-header-many = { $count } items

rating-tip = Click a star to rate; click the current star again to lower

# ---- menus ----
menu-root =
    .label = Zest
menu-status =
    .label = Read Status
menu-rating =
    .label = Rating
menu-clear-reading =
    .label = Clear reading data of selected items…
menu-settings =
    .label = Zest Settings…
menu-migrate =
    .label = Import reading data from the old plugin…
menu-export-json =
    .label = Export reading data (JSON)…
menu-export-csv =
    .label = Export reading data (CSV)…
menu-import =
    .label = Import reading data (JSON / CSV)…
status-menu-new =
    .label = New
status-menu-to-read =
    .label = To Read
status-menu-in-progress =
    .label = In Progress
status-menu-read =
    .label = Read
status-menu-not-reading =
    .label = Not Reading
status-menu-clear =
    .label = Clear status
rating-menu-5 =
    .label = ★★★★★
rating-menu-4 =
    .label = ★★★★
rating-menu-3 =
    .label = ★★★
rating-menu-2 =
    .label = ★★
rating-menu-1 =
    .label = ★
rating-menu-clear =
    .label = Clear rating

# ---- batch / dialogs ----
batch-confirm-count = Apply to { $count } items?
batch-cancel-hint = Click this window to stop
batch-cancelled = Stopped: { $ok } done, { $left } left untouched
clear-reading-confirm = Delete the reading records (time per page, per day) of { $count } items from Zest's database? This cannot be undone. Rating and read status in Extra are kept.

export-title = Export reading data
export-nothing = No reading data to export yet
export-done = Exported reading data of { $count } items
import-title = Import reading data
import-mode-question = { $count } records found. How should they be merged with existing data?
import-mode-max = Merge (keep larger)
import-mode-sum = Add up
import-parse-failed = Could not read the file: { $error }
import-nothing = No reading records found in that file
import-result = Imported { $count } items · { $hours } h of reading · skipped { $skipped } (ambiguous matches: { $ambiguous })
import-write-failed = Could not save the reading data. Any completed items are retained; retry using “Keep the larger value” after checking the data folder. { $error }

migrate-title = Import reading data from the old plugin
migrate-scanning = Scanning libraries for “Addon Item” / “ZoteroStyle” notes and JSON files…
migrate-nothing = No legacy reading records found ({ $parents } legacy parents, { $notes } notes scanned).
migrate-done = Merged { $merged } items · { $hours } h of reading
migrate-report-line = Legacy parents: { $parents } · notes: { $notes } · parsed: { $parsed } · skipped: { $skipped } · files: { $files } · off-by-one fixed: { $offset } · unresolved keys: { $unresolved } · merged: { $merged } ({ $hours } h)
migrate-legacy-kept = Legacy notes and files were left untouched. You can move the “Addon Item” to the trash yourself once you are happy with the result.

db-unavailable = Zest could not open its reading database (zest.sqlite). Reading time is kept in memory and will be saved once the database is available; see the Error Console for details.

# ---- graph ----
graph-title = Graph
graph-mode-related = Related
graph-mode-related-tip = Items linked through Zotero's "Related" field
graph-mode-author = Authors
graph-mode-author-tip = Items sharing an author
graph-mode-tag = Tags
graph-mode-tag-tip = Items sharing a tag
graph-mode-collection = Collections
graph-mode-collection-tip = Items sharing a collection
graph-reanalyse = Re-analyse
graph-reanalyse-tip = Rebuild the graph from the rows currently listed
graph-fit = Fit view
graph-fit-tip = Show the whole graph without changing its layout
graph-close = Close the graph
graph-building = Building…
graph-failed = Could not build the graph — see the Error Console
graph-status = { $items } items · { $nodes } nodes · { $edges } links
graph-status-truncated = { $items } items · { $nodes } nodes · { $edges } links (trimmed to the most connected)
graph-status-isolated = { $count } unconnected items not shown
graph-menu-show = Show in library
graph-menu-open = Open
graph-menu-center = Centre on this item
menu-graph =
    .label = Graph panel

# ---- nested tag tree ----
tags-sort-tip = Sort order — click to cycle
tags-sort-az = Sorting: tag A→Z
tags-sort-za = Sorting: tag Z→A
tags-sort-freq-desc = Sorting: most used first
tags-sort-freq-asc = Sorting: least used first
tags-collapse-tip = Expand or collapse everything
tags-clear-tip = Clear the tag filter
tags-tab-tree = Nested
tags-tab-all = All
tags-tree-toggle =
    .label = Nested tag tree
tags-search-placeholder = Filter tags
tags-empty = No tags match the current rule
tags-selected = { $count } selected
tags-row-tip = { $path } · { $items } items · { $tags } tags in this branch
tags-menu-rename = Rename branch…
tags-menu-copy = Copy tag
tags-menu-copy-full = Copy full tag
tags-menu-color = Colour
tags-menu-color-clear = No colour
tags-menu-emoji = Emoji…
tags-menu-rule-clear = Remove Zest rule
tags-menu-delete = Delete tags…
tags-rename-title = Rename tag branch
tags-rename-label = New prefix for { $count } tags
tags-rename-confirm = Rename { $count } tags?
tags-rename-confirm-merge = Rename { $count } tags? { $merges } of them already exist under the new name and will be MERGED — this cannot be undone.
tags-delete-confirm = Delete { $count } tags under “{ $path }” from this library? This cannot be undone.
tags-emoji-title = Tag emoji
tags-emoji-label = Emoji shown in front of this branch (leave empty to remove)
menu-tagtree =
    .label = Nested tag tree

# ---- annotation cards ----
anno-section-header =
    .label = Annotation Finder
anno-section-sidenav =
    .tooltiptext = Zest annotation finder
anno-page = Page { $page }
anno-copy = Copy text
anno-card-tip = Double-click to open this annotation in the reader
anno-no-text = { $type } annotation — double-click to see it in context
anno-empty-no-attachment = This item has no PDF or EPUB attachment
anno-empty-no-annotation = No annotations yet
anno-empty-filtered = No annotation matches the tags selected in the tag tree

# ---- journal rank columns ----
column-pubtags = Publication Tags
column-if = IF
column-venue = Venue
if-cell-tip = { $field } = { $value } (source: { $source })
rank-badge-tip = { $value } (field: { $field }; source: { $source })
rank-category-medicine = Medicine
rank-category-medicine-short = Med.
rank-category-internal-medicine = Medicine: Internal Medicine
rank-category-internal-medicine-short = Med.: Internal Med.
rank-category-clinical-medicine = Clinical Medicine
rank-category-clinical-medicine-short = Clinical Med.
rank-category-multidisciplinary = Multidisciplinary
rank-category-multidisciplinary-short = Multidisc.
rank-category-general-medicine-health = General Medicine & Health
rank-category-general-medicine-health-short = Gen. Med. & Health
rank-category-mathematics = Mathematics
rank-category-mathematics-short = Math
rank-category-physics-astronomy = Physics & Astronomy
rank-category-physics-astronomy-short = Physics & Astron.
rank-category-chemistry = Chemistry
rank-category-chemistry-short = Chem.
rank-category-materials-science = Materials Science
rank-category-materials-science-short = Materials
rank-category-geosciences = Geosciences
rank-category-geosciences-short = Geosci.
rank-category-environment-ecology = Environmental Sciences & Ecology
rank-category-environment-ecology-short = Env. & Ecology
rank-category-agriculture-forestry = Agricultural & Forest Sciences
rank-category-agriculture-forestry-short = Agri. & Forestry
rank-category-engineering-technology = Engineering & Technology
rank-category-engineering-technology-short = Eng. & Tech.
rank-category-biology = Biology
rank-category-biology-short = Biology
rank-category-social-sciences = Social Sciences
rank-category-social-sciences-short = Social Sci.
rank-category-management = Management
rank-category-management-short = Mgmt.
rank-value-cas-zone-short = CAS Z{ $zone } · { $category }
rank-value-cas-upgraded-zone-long = CAS Journal Ranking (Upgraded) — { $category }, Zone { $zone }
rank-value-cas-basic-zone-long = CAS Journal Ranking (Basic) — { $category }, Zone { $zone }
rank-value-category-zone-short = Z{ $zone } · { $category }
rank-value-category-zone-long = { $category }, Zone { $zone }
rank-value-zone-short = Zone { $zone }
rank-value-zone-long = Zone { $zone }
rank-value-cas-grade-short = CAS { $grade } · { $category }
rank-value-cas-grade-long = CAS Journal Ranking — { $category }, { $grade }
rank-value-category-grade-short = { $grade } · { $category }
rank-value-category-grade-long = { $category }, { $grade }
rank-value-class = Class { $grade }
rank-value-core-collection = Core Collection
rank-value-china-st-core = Chinese Science & Technology Core Journal
rank-value-national-tier-one = National Tier-1 Academic Journal
rank-value-first-class-discipline = First-Class Discipline Journal
rank-value-premier-journal = Premier Journal
rank-value-top-journal = Top Journal
rank-menu-refresh =
    .label = Refresh journal data for the selected items

# ---- view groups ----
views-menu = Zest views
views-empty = No saved views
views-add = Save current layout as a view…
views-add-label = Name for this column layout
views-update = Update a view with the current layout
views-delete = Delete a view
views-delete-confirm = Delete the view “{ $name }”? The columns themselves are not changed.
views-restore = Restore the layout from before the last switch
views-untitled = New view
views-previous = Previous layout

# ---- settings pane (rendered from JS) ----
pref-key-save = Save
pref-rank-clear = Clear ranking cache
pref-dataset-import = Import dataset…
pref-config-export = Export configuration…
pref-config-import = Import configuration…
pref-key-plaintext = Stored in plain text: the login manager was unavailable
pref-key-saved = Key stored in the login manager
pref-key-stored = A key is stored (in the system login manager; never shown back here). Click into the box and type to replace it, or clear it and save to remove it.
pref-key-none = No key stored yet
pref-key-testing = Checking…
pref-key-valid = Key works ({ $detail })
pref-key-invalid = The service rejected this key — wrong or expired
pref-key-rate = The service is rate-limiting right now; the key may still be fine — try again in a minute
pref-key-network = Could not reach the service (offline, proxy, or blocked)
pref-datasets-empty = No local dataset imported yet
pref-dataset-remove = Remove
pref-dataset-empty = No usable rows in that file
pref-dataset-import-done = Imported “{ $name }”: { $rows } journals, { $fields } fields
pref-views-empty = No saved column views yet
pref-view-rename = Rename
pref-view-remove = Delete
pref-config-export-done = Exported { $prefs } preferences, { $views } views and { $rules } tag rules
pref-config-import-done = Imported { $prefs } preferences · { $views } views · { $rules } tag rules · { $skipped } entries skipped
pref-rank-cleared = Journal cache cleared

# ---- author columns ----
column-authors = Authors
column-first-author = First Author
column-last-author = Last Author
authors-cell-tip = { $count } creators
authors-import-done = Imported from better-authors: { $applied }; not mapped: { $skipped }
menu-authors-import =
    .label = Import better-authors settings

# ---- citation counts ----
column-citations = Citations
citations-cell-tip = { $count } citations · { $source } · { $date }
menu-citations-update =
    .label = Update citation counts
menu-citations-update-stale =
    .label = Update citation counts that are out of date
citations-done = { $updated } updated · { $unchanged } unchanged · { $missing } without an identifier · { $failed } failed
citations-none = None of the selected items has a DOI or PMID

# ---- remark ----
column-remark = Remark
remark-tip = Double-click to edit this one-line remark (stored in Extra)
remark-prompt = Your one-sentence takeaway

# ---- literature info panel ----
info-section-header =
    .label = Zest
info-section-sidenav =
    .tooltiptext = Zest — reading, ranking, citations
info-authors = Authors
info-authors-all = All { $count } authors
info-author-first = First
info-author-corresponding = Corresponding
info-author-last = Last
info-author-last-tip = No explicit correspondence marker; showing the last author in this item's creator list
info-affiliation-first = First author
info-affiliation-corresponding = Corresponding author
info-affiliation-last = Last author
info-authorships-fetch = Complete author details
info-affiliations-all = All { $count } affiliations
info-rating-set = Set rating to { $rating }
info-rating-save-failed = Could not save the rating. Please try again.
info-remark-save-failed = Could not save the remark. Your input is retained; edit it to try saving again.
info-title = Title
info-abstract = Abstract
info-workspace = Reading & notes
info-collapse = Show less
info-abstract-fetch = Fetch abstract
info-abstract-read-all = Read full abstract
info-abstract-complete = Find full abstract
info-abstract-fetch-tip = Look up this DOI / PMID in Europe PMC, PubMed or Crossref
info-abstract-loading = Fetching…
info-abstract-source-link = View source
info-abstract-missing = No abstract found.
info-abstract-throttled = The source is rate-limiting requests. Please try again later.
info-abstract-offline = The abstract source could not be reached. Check your connection and retry.
info-abstract-error = The source abstract could not be verified or read. Please try again later.
info-abstract-translate = Translate
info-abstract-translating = Translating…
info-abstract-original = Original
info-abstract-translation-source = Translation · { $source }
info-abstract-translate-tip = Translate into Chinese · { $source }
info-abstract-translation-throttled = Too many translation requests. Please try again later.
info-abstract-translation-error = Translation unavailable. Please try again.
info-affiliations = Affiliations
info-affiliations-fetch = Fetch affiliations
info-affiliations-fetch-tip = Send this item's DOI to OpenAlex to look up author affiliations
info-affiliations-loading = Fetching…
info-affiliations-unavailable = No affiliations available yet. Try again later.
info-venue = Venue
info-citations = Citations
info-citations-none = not fetched yet
info-refresh = Refresh
info-reading = Reading
info-reading-value = { $time } · { $pages } of { $total } pages seen
info-reading-none = not read yet
info-status = Status
info-status-none = No status
info-open = Open in
info-heat-tip = Open at page { $page }

# ---- reading statistics ----
menu-stats =
    .label = Reading statistics…
stats-title = Reading statistics
stats-total = Total time
stats-days = Days with reading
stats-streak = Current streak
stats-longest = Longest streak
stats-items = Items read
stats-best = Best day
stats-top = Most read
stats-pages = { $pages } pages
stats-nothing = nothing read
stats-source-note = Counted from zest.sqlite in your Zotero data directory — the same records you can export from Settings → Zest → Reading Data.

# ---- annotation matrix ----
menu-matrix =
    .label = Annotation matrix…
matrix-title = Annotation matrix
matrix-search-placeholder = Search text, comments, tags — space = AND, | = OR, -word = exclude
matrix-all-colors = All colours
matrix-all-tags = All tags
matrix-count = { $shown } of { $total }
matrix-export-csv = Export CSV
matrix-export-md = Export Markdown
matrix-col-item = Item
matrix-col-page = Page
matrix-col-text = Annotation
matrix-col-tags = Tags
matrix-truncated = Showing the first { $shown } of { $total } — narrow the search to see the rest

# ---- vertical tabs ----
menu-tabs =
    .label = Vertical tabs
tabs-search = Filter tabs
tabs-menu = Sessions and options
tabs-empty = No open tabs
tabs-untitled = Untitled
tabs-close = Close
tabs-close-others = Close other tabs
tabs-close-right = Close tabs to the right
tabs-show-in-library = Show in library
tabs-move-to-group = Move to group
tabs-new-group = New group…
tabs-group-default = Group
tabs-group-name = Group name
tabs-ungroup = Remove from group
tabs-group-rename = Rename group…
tabs-group-delete = Delete group
tabs-save-session = Save this set of tabs…
tabs-session-name = Name for this set
tabs-restore-session = Reopen a saved set
tabs-session-delete = Delete
tabs-hide-native = Hide Zotero's own tab bar
tabs-close-sidebar = Close the sidebar
tabs-restore-confirm = Reopen { $count } documents? Each one opens a reader tab.

# Accent presets (settings pane swatches)
pref-accent-preset-green = GitHub green
pref-accent-preset-teal = Teal
pref-accent-preset-violet = Violet
pref-accent-preset-wood = Terracotta
pref-accent-preset-grey = Graphite
config-damaged = zest-config.json could not be read — view groups, tag rules and datasets are unavailable and Zest will not overwrite the file. Fix or remove it, then restart Zotero.
tags-tree-label = Nested tag tree
views-recommended = Zest layout
menu-layout =
    .label = Apply the Zest column layout
menu-rank-fetch =
    .label = Look journal data up online (ranks / impact factor)
rank-offline-tip = Publication tags and Impact factor need Zest to look journals up online. Turn it on from the Zest toolbar button ▸ "Look journal data up online". Lookups are per journal, send only the journal name, ISSN or DOI, and are cached locally. The Chinese ranking systems additionally need an easyScholar key, set in Settings.
rank-empty-tip = No ranking data found for this journal yet. Right-click the cell to look it up again; the Chinese ranking systems need an easyScholar key.

# ---- author menu ----
author-click-tip = Click to filter the library or search online
author-menu-filter = Filter library to this author
author-menu-clear = Clear author filter
author-menu-scholar = Search on Google Scholar
author-menu-pubmed = Search on PubMed
author-menu-openalex = Open on OpenAlex
author-menu-s2 = Search on Semantic Scholar
author-filter-toast = Showing { $count } items by { $name } — switch collections to clear
author-filter-none = Could not locate { $name } in this library

# ---- graph author roles ----
graph-empty = No connections to display in this view
graph-empty-hint = Try another relationship, lower the shared-item threshold, or show more items.
graph-canvas-help = Drag nodes or the background · Ctrl/⌘ + scroll to zoom
graph-filter-modes = Relationship
graph-filter-roles = Author scope
graph-filter-shared = Shared-item threshold
graph-roles-firstlast = First + corresponding
graph-roles-firstlast-tip = Only first and last authors (the corresponding slot) — middle authors stay out
graph-roles-all = All authors
graph-roles-all-tip = Every listed author joins the graph
graph-min-tip = Show only authors / tags / collections shared by at least { $count } items
config-damaged-backup = The config file was unreadable — it was set aside as { $name }; this session starts from an empty config and new changes save normally
migrate-idmatch-confirm = { $count } legacy records match items by this machine's database ID — reliable only on the same machine and profile; after a move or database rebuild they can credit reading time to unrelated items. Import them anyway? (Cancel skips them; everything else imports as usual)
tags-rename-skipped = { $count } tags could not be mapped back from their display name and were skipped
