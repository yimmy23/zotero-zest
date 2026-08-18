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
