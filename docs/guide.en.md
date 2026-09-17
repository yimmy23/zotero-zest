# Zest user guide

[简体中文](guide.zh-CN.md) · **English** · [Back to README](../README.en.md)

This guide uses the English interface labels in Zest for Zotero 10.
Install the plugin using the [README instructions](../README.en.md#install).

## Contents

1. [Set up your layout and the Z menu](#layout)
2. [Track reading, status, ratings and goals](#reading)
3. [Configure journal data and citation counts](#journals)
4. [Read and copy citation keys](#citation-keys)
5. [Use the information panel and abstracts](#abstracts)
6. [Find, compare and export annotations](#annotations)
7. [Organise tags and save column views](#tags-views)
8. [Explore library relations](#graph)
9. [Use vertical tabs](#tabs)
10. [Export, import and back up data](#data)
11. [Frequently asked questions](#faq)

<a id="layout"></a>

## 1. Set up your layout and the Z menu

1. Open a library or collection in Zotero.
2. Click **Z** in the item-list toolbar and choose
   **Apply the Zest column layout**.
3. Select a paper to see its **Zest** section in the right-hand item pane.
4. Open **Z → Zest Settings…** to adjust the columns and tools you use.

The first application enables the columns needed by the recommended layout.
Later applications respect columns you have disabled in settings. You can also
choose columns from Zotero's column-header context menu.

To undo the latest layout switch, right-click a column header and choose
**Zest views → Restore the layout from before the last switch**. This restores
the previous column layout; it is not a general settings reset.

The **Z** menu provides these shortcuts:

| Menu entry                                          | Action                                               |
| --------------------------------------------------- | ---------------------------------------------------- |
| Library relations                                   | Show or hide the graph below the item list           |
| Reading statistics…                                 | Open reading goals, charts and milestones            |
| Annotation matrix…                                  | Compare annotations across papers                    |
| Apply the Zest column layout                        | Apply the recommended item-list layout               |
| Look journal data up online (ranks / impact factor) | Toggle automatic journal lookups for displayed items |
| Nested tag tree                                     | Toggle the nested tag selector                       |
| Zest Settings…                                      | Open Zest preferences                                |

**Tools → Zest** also provides the main tools, vertical tabs and reading-data
import/export. Settings are grouped under **Reading**, **Bibliographic details**,
**Workspace**, **Appearance**, and **Data and advanced**.

<a id="reading"></a>

## 2. Track reading, status, ratings and goals

### Reading time and the heat strip

1. Open a PDF or EPUB in Zotero's reader.
2. Read with the document focused. Tracking is enabled by default and pauses
   after **120 seconds without input**.
3. Return to the library to see the **Reading** column and the reading strip in
   the Zest panel. Click a panel strip segment to open that page.

Change tracking and idle time in **Zest Settings → Reading Tracker**. The
**Reading Heat** section controls the heat colour, opacity and title decoration.
Recorded time and pages seen describe reading activity, not comprehension or
proof of completing a paper.

### Status and automatic updates

Click a status dot in the list or choose **right-click item → Zest → Read Status**.
The choices are **New**, **To Read**, **In Progress**, **Read**, **Not Reading**,
and **Clear status**.

- A filled dot represents a status stored in `Extra`.
- A ring represents a status derived from reading records or Zotero's own
  last-read information when no status has been set. This display alone writes
  nothing to the item.
- **Also write it into Extra** is a separate setting, enabled by default.
  Starting to read an item marked New or To Read changes it to In Progress.
  Crossing the configured completion threshold can mark it Read.
- The default completion threshold is **90% of pages seen and at least
  5 minutes read**. Applying these writes to items with no status is separately
  controlled by **Also apply to items that have no status yet**, which is off
  by default.

Use the settings in **Reading Tracker** to choose whether you want derived
display, writes to `Extra`, or both. Clearing a stored status can reveal the
derived status again while automatic display is enabled.

### Ratings and a one-line remark

Click a star in the **Rating** column or Zest panel to set a rating. Clicking
the current star lowers it; clicking the first star again clears the rating.
The item context menu also supports ratings for selected papers.

Under **Item List Columns**, choose whether stars appear in the Rating column,
the title, or both. These displays share one value and do not modify the title.
To bring existing pure-star tags into ratings, select papers and choose
**Import star tags from selected papers…** in settings, or the star-rating import
command at **right-click → Zest → Rating → Import ratings from star tags…**.
Review the preview before confirming; existing ratings are preserved and tags
are not deleted.

Enable the **Remark** column if needed. Double-click its cell to edit a one-line
takeaway, or edit the remark in the Zest panel. Ratings and remarks are stored
in the item's `Extra` field.

### Goals and statistics

Open **Z → Reading statistics…**. Set **Daily goal** and **Days per week**,
then explore the trend, yearly heat map and milestones. The defaults are
30 minutes per day and 5 days per week.

The sidebar rings provide a compact view; clicking them opens the full
statistics window. Statistics use local reading records. Use **Refresh** for
a new snapshot, and **View daily data** for exact chart values. Importing or
clearing reading records also changes the calculated statistics.

<a id="journals"></a>

## 3. Configure journal data and citation counts

### Choose sources and make a first lookup

1. Open **Zest Settings → Journal Ranking** and enable the **Pub Tags**, **IF**
   or **Venue** columns you want.
2. Choose your sources. Local journal datasets take priority, followed by
   easyScholar and then OpenAlex for available fields.
3. For easyScholar, enter your key, click **Save**, then **Test**.
4. Select papers in the library, right-click and choose
   **Zest → Refresh journal data for the selected items**.
5. Hover over a badge to check its field and source. Select the item to inspect
   JCR metrics in the Zest side pane.

Automatic lookups are **off by default**. Enable
**Z → Look journal data up online (ranks / impact factor)**, or the equivalent
setting, if you want displayed items to trigger lookups. Cached results and
imported local datasets remain usable with automatic lookups off. The default
ranking cache duration is 30 days. For local-only refreshes, disable both online
sources before refreshing selected items.

The services provide different data:

| Source        | Role                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| Local dataset | Your own journal ranking or institutional fields; works offline        |
| easyScholar   | Ranking and impact-factor fields available to your key and the service |
| OpenAlex      | Its own journal metrics, including two-year mean citedness and h-index |

**OpenAlex's two-year mean citedness is not a Journal Impact Factor.** Enabling
OpenAlex does not supply XinRui, CAS or JCR data. Those fields need a suitable
local dataset or easyScholar response. The **IF column can fall back to this
OpenAlex metric**, so inspect JCR details in the Zest side pane before interpreting a number as IF.
Check the data source and its reporting year when using metrics; a cache refresh
does not guarantee a newer annual ranking exists.

Keys are normally saved in Zotero's login manager and are excluded from
configuration exports. If the settings report **Stored in plain text: the login
manager was unavailable**, resolve the login-manager problem and save the key
again. You will need to configure keys separately after moving to another setup.

### XinRui first, historical CAS as a fallback

The default **Fields** value is `xr, sci, sciif`:

- The primary ranking slot uses **XinRui (`xr`)** when a usable value is present.
- Otherwise it uses **historical CAS (`sciUp`)**, if available.
- It does not duplicate XinRui and CAS in that default slot.
- `sci` is the JCR quartile field and `sciif` is the impact-factor field.

In the English interface, the default display puts JCR first, then the
XinRui/CAS slot, then IF. In the Chinese interface, the XinRui/CAS slot comes
first, and XinRui badges omit the “新锐” prefix to save space. The underlying
source remains unchanged; historical CAS badges retain their CAS label.

To request a different order or both systems explicitly, enter a custom list,
for example `sciUp, xr, sciif`. **Field mapping** can rename fields or rewrite
values; an empty right-hand side hides a match. Expand **Field mapping syntax
and examples** in settings before writing rules. Hiding a chosen XinRui value
with a rule does not bring CAS back into the default slot.

Keep **Text colour** set to **Auto** for native theme text on a tinted badge
background. Automatic text mode limits background opacity to 0.25 for
legibility; an explicit custom text colour allows the configured opacity up to 1.

### Read IF and category percentiles

Choose **Show as → IF above JCR percentile** in settings. The IF number is
centred above a marker whose position shows the JIF percentile for the same
metric year and subject category; farther right means a higher percentile.
P90 means the 90th percentile. A single-category marker at P90 or above gains
an outline. The thin grey line is the 0–100 scale; a thicker grey segment spans
multiple categories from lowest to highest percentile. **Number only** is also
available.

Select a paper to see the **Source section in the Zest side pane**:

- The journal name, IF and quartile badges remain visible. IF and quartile are
  shown once, without repeating them in the details.
- JCR details start collapsed. The summary shows the year and category count,
  for example **JCR 2025 · 2 categories**.
- Click the summary to expand all categories. Each category has a compact
  two-column layout: **Rank**, such as **17/321**, and **Percentile**, such as
  **94.9**. Percentile is the journal's position within that category, not a
  percentage of its IF.
- Click again to collapse. Zest keeps your open or closed choice as you select
  other papers in the same window.

The data source and calculation method are explained in
**Zest Settings → Local Journal Datasets**. The IF column does not add a hover
popup.

Without valid percentile data, only the number appears. Q1–Q4, XinRui and CAS
zones cannot determine an exact JIF percentile. Five-year IF and OpenAlex metrics
do not inherit standard JIF percentiles. easyScholar remains available for IF
and JCR quartiles; the public API documentation and responses checked so far do
not provide the required percentiles, metric years or per-category ranks. Use
ShowJCR rank data or import explicit percentiles as described below.

### Download or update ShowJCR data

1. Open **Zest Settings → Local Journal Datasets → Download / update ShowJCR**.
   Clicking this button downloads the supported JCR CSV from the third-party
   [ShowJCR repository](https://github.com/hitfyd/ShowJCR).
2. After a successful download, the data applies immediately, is stored locally
   and works offline. You do not need to refresh journal data again.
3. Click the same button when you want to update. A successful update replaces
   the existing ShowJCR dataset without adding a duplicate; a failed download,
   invalid file or save failure keeps the previous usable dataset.

Zest downloads this data only when you click the button; it does not check for
updates in the background. The button uses a verified, fixed snapshot of
JCR2025 (ShowJCR commit `c8da202c`); clicking again downloads that same snapshot.
A newer annual table requires a plugin update or manual CSV import. You can
download the original ShowJCR JCR CSV yourself and select **Import dataset…**:
Zest recognises that format without requiring you to rename its columns.

ShowJCR supplies category ranks. The source and percentile calculation method
appear in the ShowJCR settings hint. Zest uses `100 × (N − r + 0.5) / N`, where `r` and `N` are the
CSV's supplied category rank and total. It preserves tied ranks as supplied,
without reordering journals, substituting average ranks or deriving a
percentile from Q1–Q4. The metric year comes from the `IF(YYYY)` header
(`IF(2025)` in the supported file), not its download date.

The graphic covers all of a journal's categories. If any category lacks a
valid rank, including `N/A`, or IF is not an exact number, such as `<0.1`, Zest
does not draw a percentile graphic from that record.

### Import a local journal dataset

1. Prepare a CSV with the headers described below, or JSON containing a row
   array. JSON can also use an object with `name` and `rows`. For Excel, arrange
   the columns first and save as UTF-8 CSV. Zest does not directly import XLSX.
   Apart from the supported ShowJCR CSV above, raw JCR exports must be arranged
   into this format before importing.
2. Give each row a journal `name` and/or ISSN identifiers. Separate `pISSN`
   and `eISSN` columns are supported; both are treated as identifiers.
3. Put ranking values in other columns, such as `xr`, `sciUp`, `sci` or `sciif`.
   Custom field names are also supported.
4. Choose **Zest Settings → Local Journal Datasets → Import dataset…**.
5. Add any custom field names to **Journal Ranking → Fields**, refresh journal
   data for a matching paper, then inspect its badges.

All journal names, identifiers and values in these examples are fictional.
For a single-category percentile, supply `sciif`, `jcrYear`, `jcrCategory` and
`jifPercentile`; `jcrRank` is optional:

```csv
name,issn,sciif,jcrYear,jcrCategory,jifPercentile,jcrRank
Example Journal,1234-5678,8.1,2025,Oncology,91.2,20/222
```

`jcrYear` is the **JIF metric year**, not the release, download or import year.
Use the supplied percentile on a 0–100 scale, such as `91.2`, not `0.912`.
These metadata fields do not need to be added to **Journal Ranking → Fields**.

Use one row per journal. For multiple categories, use JSON `jcr.categories`
instead of repeating CSV rows:

```json
[
  {
    "name": "Example Journal",
    "issn": "1234-5678",
    "sciif": 8.1,
    "jcr": {
      "year": 2025,
      "impactFactor": 8.1,
      "categories": [
        { "name": "Oncology", "percentile": 91.2, "rank": "20/222" },
        { "name": "Immunology", "percentile": 78.4, "rank": "40/183" }
      ]
    }
  }
]
```

`jcr.impactFactor` must match the row's `sciif`. The IF and category percentiles
must describe the same metric year and source. Missing years, categories or
percentiles, or a mismatched IF, leave the percentile graphic hidden.

Keep the original dataset file for backup. Configuration export carries its
metadata, not the dataset rows. Removing a dataset from Zest does not edit your
original import file.

### Citation counts

Citation counts are separate from journal rankings. Choose sources in
**Zest Settings → Citation counts**, then select papers and use
**right-click → Zest → Update citation counts** or
**Update citation counts that are out of date**. Counts are not fetched
automatically. DOI or PMID information is needed for these item lookups.

The available sources are Crossref, OpenAlex and optionally Semantic Scholar.
Zest preserves supported count lines from other plugins and writes its own
`Citations` line in `Extra`. Source coverage and update dates can produce
different counts.

<a id="citation-keys"></a>

## 4. Read and copy citation keys

1. Select a paper and open its **Zest** item-pane section.
2. Find **Citation key** below the title.
3. Click **Copy citation key**, or select the key text and copy it yourself.

Zest reads the first available existing key in this order:

1. Zotero's native `citationKey` field.
2. A legacy `Citation Key:` line in `Extra`.
3. Better BibTeX's existing supported synchronous key cache, when available.

This is a **read-only display**: Zest does not generate keys, refresh Better
BibTeX's key database, or write to the native field or `Extra`. Zotero's internal
item key is not used as a citation key.

If no key exists, the row shows **No citation key**, with copying disabled.
Create or manage the key in Zotero's item information or Better BibTeX, then
select the item again. Better BibTeX is optional; a native or legacy key can be
displayed without it.

<a id="abstracts"></a>

## 5. Use the information panel and abstracts

The **Zest** panel gathers the title, citation key, venue and journal badges,
authors, affiliations, abstract, reading information, status, rating, remark
and external links. Select text directly, or use its context menu to copy the
selection or field.

Expand the author list to see more names. Where available, **Fetch affiliations**
or **Complete author details** requests information from OpenAlex using the
paper's DOI. Automatic affiliation lookup is off by default and can be enabled
under **Item panel** settings. A last author is labelled as such unless an
explicit correspondence marker is available; position alone does not establish
the corresponding author.

### Fetch a fuller abstract

1. Check that the paper has the correct DOI or PMID.
2. In the abstract area, click **Fetch abstract** or **Find full abstract**.
3. Use **Read full abstract** to expand long text, and **View source** to inspect
   the retrieved source when available.

The lookup checks Europe PMC, PubMed or Crossref by identifier. The panel can
display a retrieved full abstract without overwriting the item's original
abstract, language or `Extra` fields. If the source cannot be verified or is
temporarily unavailable, the panel reports the problem.

### Translate an abstract

Click **Translate** to translate the displayed source text into **Chinese**.
Click **Original** to return to the source text. The provider is shown in the
translation control or result.

Zest uses the available **Translate for Zotero** API first. If that plugin's API
is absent, it uses **Microsoft Translator**. A failure in a selected provider
does not silently switch to another one. Translation sends the abstract text
to the selected provider only when requested and does not replace the item's
stored abstract.

<a id="annotations"></a>

## 6. Find, compare and export annotations

### Annotation Finder for one paper

Select a regular paper in the library and open **Annotation Finder** in its
item pane. It shows the paper's PDF/EPUB annotations with text, comments, page
labels and annotation tags.

- Select prose to copy a passage.
- Click **Copy** to copy the annotation text and comment.
- Click **Open source**, or double-click the page label, to locate it in the
  attachment.
- A selected branch in the nested tag tree can filter the cards by their
  annotation tags.

Annotation Finder is a library-pane tool. In a reader tab, use Zotero's own
annotation sidebar.

### Annotation matrix across papers

1. Open **Z → Annotation matrix…**.
2. Choose **Current view** or **Selected items** in **Scope**. The embedded
   item-pane matrix starts with **This paper**.
3. Search annotation text, comments, paper titles or tags. Open **Filters** for
   paper, type, colour, tag, **With comments**, and sorting controls.
4. Use **Open source** on a result to return to the attachment.
5. Open **Export** and choose **Copy as Markdown**, **Export Markdown** or
   **Export CSV**.

Search supports space-separated terms, `|` for alternatives, `-word` to exclude
a term and quotes for a phrase. Use **Reset** to clear filters, and **Refresh**
after changing the source selection or annotations.

Copying or exporting the matrix includes **all matching annotations**, not just
the visible result page, with source links. Individual **Copy** buttons include
the full annotation text and comment even when the preview is collapsed.
Image and ink annotations may have no text; use **Open source** to inspect them.

<a id="tags-views"></a>

## 7. Organise tags and save column views

### Tag badges and the nested tree

The **#Tags** column displays tags matching its rule. The default rule is `#`,
so `#method/cohort` appears without the leading `#`. Zotero's existing tag
colours take priority over the default badge colour.

1. Set **Item List Columns → Match rule** in Zest settings.
2. Enable **Z → Nested tag tree** if you want a hierarchy instead of the native
   tag selector.
3. Set the **Nesting separator** under **Nested Tag Tree**; the default is `/`.
4. Expand branches, search tags and click a branch to filter the library.
   Remove an active filter using its removal control, or clear the tag filter.

The tree uses the same matching rule as **#Tags**. The **Nested** and **All**
tabs let you switch views. Turn off **Nested tag tree** to restore Zotero's
selector. For advanced rules, expand **Match rule syntax and examples** in
settings.

The branch context menu offers copying, colour/emoji rules, renaming and
deleting tags. Renaming and deleting affect actual Zotero tags and show a
confirmation; renaming into an existing branch can merge tags.

### Save a column view

1. Arrange column visibility, order, widths and sorting.
2. Right-click a column header and choose
   **Zest views → Save current layout as a view…**.
3. Name the view, for example “Screening” or “Writing”.
4. Choose it from **Zest views** to restore the layout later.

The same menu can update or delete a view and restore the layout from before
the latest switch. Views are column layouts; switching one does not move items
between collections.

<a id="graph"></a>

## 8. Explore library relations

1. Open a collection or library view, then choose **Z → Library relations**.
2. Select **Item links**, **Authors**, **Tags** or **Collections**.
3. Expand **Filters and actions** to adjust **Author scope** or the
   **Shared-item threshold**, and to access **Re-analyse** and **Fit view**.
4. Click a paper node to select it in the library, or right-click a node for
   its actions. Drag nodes or the background to explore; use
   **Ctrl/⌘ + scroll** to zoom.

The graph connects items already in the current library view. **Item links**
uses Zotero's **Related** field. The compact sidebar graph can also focus on
the selected paper and its local related items. These are local relationship
views, not a search for outside papers or a citation network fetched from the web.

### Author identities and manual completion

Author graphs use item metadata and previously cached OpenAlex identities.
Opening, restoring or re-analysing a graph does not itself fetch missing author
identities.

In **Authors** mode, expand **Filters and actions** and click
**Complete author identities** to request missing identities from OpenAlex for
the current scope. Each click considers up to 30 papers. The progress message
reports requests and updates; rate limits may require trying again later.

**First + last** means positions in the creator list, not confirmed
corresponding authors. Unresolved names are grouped heuristically. For a sparse
graph, try **All authors**, lower the shared-item threshold or include more
papers in the library view.

<a id="tabs"></a>

## 9. Use vertical tabs

1. Choose **Tools → Zest → Vertical tabs**, or enable the sidebar in
   **Zest Settings → Vertical tabs**. It is off by default.
2. Use the fixed **Library** entry to return to the library and the document
   entries to switch readers.
3. Use **Filter tabs** to narrow the list. Right-click a document for closing,
   library location and grouping actions.
4. Open **Sessions and options → Save this set of tabs…** to save a set, and
   **Reopen a saved set** to restore it later.

Groups are remembered per item. You can drag tabs to reorder them and use the
context menu to move them to a group. Arrow keys and **Home/End** move keyboard
focus between tabs; **Enter** or **Space** activates the focused tab.

**Hide Zotero's own tab bar** is a separate option. Closing the Zest sidebar
restores the native tab bar. Saving a set of tabs records references to
documents; it does not back up their attachments.

<a id="data"></a>

## 10. Export, import and back up data

Zest separates reading records, item fields and configuration:

| Data                                                              | Storage and transfer                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Reading time, page and date records                               | `zest.sqlite` in the Zotero data directory; use reading JSON/CSV export and import       |
| Stored status, rating, remark and Zest citation count             | Item `Extra`; can sync through Zotero                                                    |
| Citation key                                                      | Read from its existing provider; Zest does not create another copy                       |
| Column views, tag rules, tab groups/sessions and dataset metadata | `zest-config.json`; use configuration export and import                                  |
| Imported journal rows                                             | `zest-datasets/<id>.json`; retain original files for re-import or back up this directory |
| Derived lookup cache                                              | `zest-cache.json`; not a replacement for source datasets or a library backup             |
| API keys                                                          | Normally the login manager; excluded from configuration export                           |

### Move reading records

1. Open **Zest Settings → Reading Data → Export JSON…** or **Export CSV…**.
   The equivalent commands are under **Tools → Zest**.
2. Transfer the file and make sure the corresponding Zotero items are present
   on the destination device.
3. Choose **Import…** under **Reading Data** and select the file.
4. Choose **Merge (keep larger)** for overlapping histories, or **Add up** for
   separate histories you intend to sum. Importing the same history with
   **Add up** can double-count time.
5. Check the imported and skipped counts, then refresh reading statistics.

Both JSON and CSV exports preserve importable reading detail. Current exports
include a stable user or group identity where available. Records from a local,
unsigned-in profile are limited to that identity; older files without portable
identity are accepted only when an item key has one unambiguous match. Missing
or ambiguous targets are skipped rather than guessed.

**Import reading data from the old plugin…** scans supported legacy notes and
files. It keeps those originals; inspect the result before removing them.
**Clear reading data of selected items…** deletes Zest's reading records after
confirmation and retains rating and status in `Extra`.

### Move settings and datasets

Use **Zest Settings → Configuration → Export configuration…**, then
**Import configuration…** on the destination setup. The bundle includes
preferences, views, tag rules, tab groups/sessions and dataset metadata. It
does **not** include reading records, actual journal-dataset rows or API keys.

Transfer reading data separately, re-import your original journal datasets,
and configure API keys again. Session references also need the corresponding
items and attachments to exist; a configuration bundle is not a Zotero library
backup.

<a id="faq"></a>

## 11. Frequently asked questions

### Why are some columns missing?

Apply **Z → Apply the Zest column layout**, then check the corresponding
column switch in Zest settings and visibility in the column-header menu.
After the first layout application, Zest respects columns you have turned off.

### Why are journal badges or IF empty?

Check the item's publication title, ISSN and DOI, your enabled sources, and
the easyScholar key if that source is needed. Select the paper and run
**Refresh journal data for the selected items**. An enabled source cannot
return a field it does not carry. The IF column can fall back to OpenAlex's
two-year mean citedness; that value is not JCR IF. Select the item to check that
fallback's field and source in the Zest side pane.

Journal matching tolerates common case, spacing and punctuation differences,
plus a small set of verified title aliases. It does not remove arbitrary
subtitles or treat every similar title as the same journal. For an unresolved
case, report the public title, ISSNs, DOI and source rather than changing the
item to an unrelated title.

### Why does Citation key show a placeholder?

None of the supported providers currently has an existing key. Manage it in
Zotero or Better BibTeX and select the paper again. Zest does not invent a key
from Zotero's internal item identifier.

### Why does opening a paper not add reading time?

Check **Reading Tracker**, focus the PDF/EPUB reader and resume interaction if
the idle threshold has elapsed. Leaving a reader open in the background does
not count as active reading. A Zotero last-read stamp can still produce a
derived status even when Zest has no recorded time.

### Why do annotations or graph nodes seem missing?

Check the current scope and filters. The matrix may be limited to selected
items or one paper; Annotation Finder also follows selected annotation-tag
branches. Graphs omit relationships below the shared-item threshold and may
trim large views. Clear filters or broaden the current view before refreshing.

### Does Zest sync all its data?

No. Stored item fields can sync with Zotero, while reading records, configuration,
datasets and caches are local. Follow the [data transfer steps](#data) for
reading and setup changes between devices.

### Can templates or scripts read Zest data?

Yes. The read-only `Zotero.Zest.api` provides formatted authors, reading data,
status, rating, journal ranks and other values. See the
[API reference](../src/api.ts) for the current contract.

### Where should I report a problem?

Open an [issue](https://github.com/yimmy23/zotero-zest/issues) with the Zotero
and Zest versions, operating system and reproduction steps. For display issues,
include the theme, font size and a screenshot. Do not include API keys or
private document contents. Version changes and upgrade notes are published in
[Releases](https://github.com/yimmy23/zotero-zest/releases).
