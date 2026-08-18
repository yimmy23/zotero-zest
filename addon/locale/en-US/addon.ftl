startup-begin = Zest is loading
startup-finish = Zest is ready

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
status-click-tip = Click to set: { $next }

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
    .label = Import legacy zotero-style reading data…
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
import-done = Imported { $count } items · { $hours } h of reading

migrate-title = Import legacy zotero-style data
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
graph-close = Close the graph
graph-building = Building…
graph-failed = Could not build the graph — see the Error Console
graph-status = { $items } items · { $nodes } nodes · { $edges } links
graph-status-truncated = { $items } items · { $nodes } nodes · { $edges } links (trimmed to the most connected)
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
tags-switch-tip = Back to Zotero's tag selector
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
rank-menu-refresh =
    .label = Refresh journal data for the selected items
rank-refresh-done = Updated { $count } journals
rank-no-key = No easyScholar key set — using local datasets and OpenAlex only

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

# ---- type filter / collection counts ----
menu-typefilter =
    .label = Filter by item type
typefilter-clear =
    .label = Show all types
typefilter-active = Showing only: { $types }
typefilter-unavailable =
    .label = Not available on this Zotero version

# ---- reader themes / colour schemes ----
reader-theme-original = Zotero Original
reader-theme-sepia = Zest Sepia
reader-theme-eyecare = Zest Eye Care
reader-theme-graphite = Zest Graphite
reader-scheme-menu = Zest colour scheme
reader-scheme-classic = Classic (yellow · red · green)
reader-scheme-warm = Warm (orange · red · magenta)
reader-scheme-cool = Cool (blue · green · purple)
reader-themes-installed = { $count } reader themes are now available in the reader's Appearance menu
reader-themes-removed = Removed { $count } Zest reader themes

# ---- settings pane (rendered from JS) ----
pref-key-save = Save
pref-rank-clear = Clear ranking cache
pref-dataset-import = Import dataset…
pref-themes-install = Install themes
pref-config-export = Export configuration…
pref-config-import = Import configuration…
pref-key-plaintext = Stored in plain text: the login manager was unavailable
pref-key-saved = Key stored in the login manager
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
remark-prompt = One line, kept in the item's Extra field

# ---- literature info panel ----
info-section-header =
    .label = Zest
info-section-sidenav =
    .tooltiptext = Zest — reading, ranking, citations
info-authors = Authors
info-venue = Venue
info-citations = Citations
info-citations-none = not fetched yet
info-refresh = Refresh
info-reading = Reading
info-reading-value = { $time } · { $pages } of { $total } pages seen
info-reading-none = not read yet
info-status = Status
info-status-none = No status
info-abstract = Abstract
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
