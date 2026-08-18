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
