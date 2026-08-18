pref-title = Zest Settings

pref-group-columns = Item List Columns
pref-column-reading =
    .label = Reading — time read with a per-page heat strip
pref-column-status =
    .label = Status — read status (compatible with Zotero Reading List)
pref-column-rating =
    .label = Rating — 1–5 (stored in Extra; click once to rate, click the current value to lower it)
pref-column-tags =
    .label = Tags — coloured and emoji tags in their own column
pref-tags-hide-in-title =
    .label = Hide tag swatches in the Title column
pref-column-texttags =
    .label = #Tags — matching tags rendered as text badges
pref-texttags-match = Match rule
pref-texttags-match-hint = “#” = tags starting with #, shown without it · “~~/” = everything NOT starting with / (several characters = none of them) · “/^#(.+)/” = regex; capture groups are shown, without groups the whole tag
pref-texttags-color = Default badge colour (Zotero tag colours win when set)
pref-texttags-textcolor = Text colour (auto = readable shade of the badge colour, or a CSS colour)
pref-rating-mark = Rating symbol
pref-rating-option = Empty symbol
pref-rating-color = Colour (empty = theme accent)
pref-rating-key = Extra key
pref-extra-strip =
    .label = Keep Read_Status / Rating lines out of exported bibliographies (BibTeX, RIS…)

pref-group-heat = Reading Heat
pref-titledecor-heat =
    .label = Also paint the reading heat behind the Title
pref-titledecor-unread =
    .label = Bold titles of unread items (status New or To Read)
pref-titledecor-unread-empty =
    .label = …also items without any status
pref-heat-color = Colour
pref-heat-opacity = Opacity (0.1–1)

pref-group-tracker = Reading Tracker
pref-tracker-enable =
    .label = Record reading time per page while a PDF/EPUB is open and focused
pref-tracker-idle = Stop counting after this many seconds without input
pref-statusauto-enable =
    .label = Update read status automatically (start reading → In Progress; enough pages seen → Read)
pref-statusauto-markempty =
    .label = …also for items that have no status yet (writes Read_Status into their Extra field)
pref-statusauto-threshold = Mark Read at % of pages seen
pref-statusauto-minminutes = …and at least minutes read
pref-tracker-storage-hint = Reading records are stored in zest.sqlite in your Zotero data directory (never in your library, never synced). Export/import them below.

pref-group-data = Reading Data
pref-btn-migrate =
    .label = Import legacy zotero-style data…
pref-btn-export-json =
    .label = Export JSON…
pref-btn-export-csv =
    .label = Export CSV…
pref-btn-import =
    .label = Import…

pref-group-about = About
pref-about-text = Zest is a from-scratch, open-source (AGPL-3.0) rewrite of zotero-style for Zotero 9–10. Ratings and read status live in the item's Extra field; reading records live in a plugin database.

pref-group-tags = Nested Tag Tree
pref-nested-show =
    .label = Show the nested tag tree instead of Zotero's tag selector (can also be toggled from Tools ▸ Zest)
pref-nested-link = Nesting separator
pref-nested-sort = Sort
pref-nested-sort-az =
    .label = A → Z
pref-nested-sort-za =
    .label = Z → A
pref-nested-sort-freq-desc =
    .label = Frequency (high to low)
pref-nested-sort-freq-asc =
    .label = Frequency (low to high)
pref-nested-showall =
    .label = Show all tags, including ones Zotero would otherwise hide
pref-nested-childtags =
    .label = Also match tags on attachments, notes, and annotations
pref-nested-hint = The tree uses the same match rule as the #Tags column above.

pref-group-rank = Journal Ranking
pref-column-pubtags =
    .label = Pub Tags — journal ranking badges (quartile, tier…) in their own column
pref-column-if =
    .label = IF — impact factor bar in its own column
pref-column-venue =
    .label = Venue — publication venue name in its own column
pref-rank-fields = Fields
pref-rank-fields-hint = Comma separated, e.g. sciUp, sciif, sci · falls back to OpenAlex's 2-year mean citedness when no easyScholar key is set
pref-rank-sortby = Sort by
pref-rank-sortby-hint = e.g. sci, -sciif · a leading “-” sorts descending · items missing a value always sort last
pref-rank-map = Field mapping
pref-rank-map-hint = One rule per line or comma separated, e.g. sciif=IF, /^Q([1-4])$/=Q$1 · an empty right-hand side hides the value
pref-rank-colors = Tier colours
pref-rank-colors-hint = 5 comma-separated hex colours, highest tier first, default #EE0000, #2F998C, #D2A500, #DA6D00, #007BF6
pref-rank-defaultcolor = Default colour (used when no tier matches)
pref-rank-textcolor = Text colour (auto or a CSS colour)
pref-rank-opacity = Opacity
pref-rank-ttl = Cache for how many days
pref-rank-easyscholar =
    .label = Fetch rankings from easyScholar
pref-rank-openalex =
    .label = Fetch rankings from OpenAlex
pref-rank-autofetch =
    .label = Fetch automatically when items are shown (otherwise fetch on demand only)
pref-key-label = easyScholar key
pref-key-save =
    .label = Save
pref-key-hint = The key is stored in the login manager, not in your synced preferences. Get a free key from easyscholar.cc.
pref-rank-clear =
    .label = Clear ranking cache
pref-if-field = IF field
pref-if-max = Bar maximum
pref-if-progress =
    .label = Show the IF as a progress bar
pref-if-info =
    .label = Show the IF value as text
pref-if-color = Bar colour

pref-group-datasets = Local Journal Datasets
pref-dataset-import =
    .label = Import dataset…
pref-datasets-hint = CSV or JSON with a name and/or issn column — every other column becomes a field. Local datasets win over online sources.

pref-group-annots = Annotations
pref-column-annots =
    .label = Annots — annotation count in its own column
pref-annots-style = Style
pref-annots-style-bar =
    .label = Bar
pref-annots-style-stack =
    .label = Stack
pref-annots-style-circle =
    .label = Circle
pref-annots-color = Colour
pref-annots-hint = Off by default — the first sort after enabling scans every attachment.

pref-group-views = Column Views
pref-views-hint = Views are saved and applied from the column header's right-click menu (Zest views).

pref-group-graph = Graph
pref-graph-visible =
    .label = Show the graph panel below the item list
pref-graph-mode = Mode
pref-graph-mode-related =
    .label = Related items
pref-graph-mode-author =
    .label = Authors
pref-graph-mode-tag =
    .label = Tags
pref-graph-mode-collection =
    .label = Collections
pref-graph-height = Panel height (px)
pref-graph-maxnodes = Max nodes

pref-group-collections = Collection Counts
pref-collections-enable =
    .label = Show item counts next to collections
pref-collections-mode = Count
pref-collections-mode-0 =
    .label = Items in this collection
pref-collections-mode-1 =
    .label = Including subcollections
pref-collections-mode-2 =
    .label = Both

pref-group-reader = Reader
pref-reader-schemes =
    .label = Enable Zest's reader colour schemes
pref-themes-install =
    .label = Install themes
pref-themes-remove =
    .label = Remove themes
pref-reader-hint = The three presets are written into Zotero's own reader theme list and can be picked from the reader's Appearance menu.

pref-group-config = Configuration
pref-config-export =
    .label = Export configuration…
pref-config-import =
    .label = Import configuration…
pref-config-hint = The bundle carries preferences, views, tag rules, and dataset metadata — never API keys.

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
