# Zest

[简体中文](README.md) · **English**

Reading records, literature details and organisation tools for Zotero.

Zest is an open-source plugin for **Zotero 10**. It brings reading time,
status, ratings and journal data into the item list, gathers literature details,
citation keys and abstracts in the sidebar, and adds annotation matrices,
library relationship graphs and reading statistics.

[Download](https://github.com/yimmy23/zotero-zest/releases/latest) ·
[User guide](docs/guide.en.md) ·
[Report an issue](https://github.com/yimmy23/zotero-zest/issues)

## Preview

This existing project screenshot illustrates the reading columns and library
layout. Menus and appearance may differ in the current version.

![Example Zest item list and reading layout](https://github.com/user-attachments/assets/e0f74c95-d707-4da9-9e75-b18559bbd1ce)

## Features

| Feature                     | What it does                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Reading records             | Tracks foreground reading time and time per page, with a reading heat strip                                                 |
| Status, ratings and remarks | Manage reading status, stars and a one-line note from the list or Zest panel                                                |
| Literature details          | View authors, affiliations, journal data, citation keys, abstracts and outbound links                                       |
| Journal data                | Uses local datasets, easyScholar and OpenAlex; prefers XinRui with historical CAS as a fallback in the default ranking slot |
| Citations and annotations   | Update citation counts manually; filter, locate, copy and export annotations                                                |
| Reading statistics          | Follow goals, trends, a yearly heat map and reading milestones                                                              |
| Library relations           | Explore local items through related-item links, authors, tags or collections                                                |
| Tags and layouts            | Nested tags, saved column views and configurable author columns                                                             |
| Vertical tabs               | A fixed Library entry, document groups and saved sets of tabs                                                               |

Features can be enabled as needed. Nested tags, vertical tabs and automatic
journal lookups are off by default. Reading tracking and the Zest information
panel are on by default.

## Requirements

- **Zotero 10.x**; Zotero 7 and 8 are not supported.
- Core reading and organisation features work locally.
- Online data and translation need access to their services. Some sources also
  require an API key.

## Install

1. Download `zest.xpi` from the
   [latest release](https://github.com/yimmy23/zotero-zest/releases/latest).
2. In Zotero, open **Tools → Plugins**, then choose
   **Install Plugin From File…** from the gear menu and select the file.
3. Restart Zotero if prompted.
4. Click **Z** in the item-list toolbar and choose
   **Apply the Zest column layout**.

See the [English user guide](docs/guide.en.md) for setup, data sources and
everyday workflows.

## Documentation

- [English user guide](docs/guide.en.md): layout, reading, annotations, journal
  data and backups.
- [中文使用教程](docs/guide.zh-CN.md): the guide in Simplified Chinese.
- [Read-only API](src/api.ts): `Zotero.Zest.api` for templates and scripts.
- [Development guidelines](AGENTS.md): code structure, data boundaries and checks.
- [Releases](https://github.com/yimmy23/zotero-zest/releases): version notes and
  downloads.

## Data and online access

Reading time is stored in `zest.sqlite` in the Zotero data directory. It
**does not sync automatically through Zotero**; use reading-data export and
import to move it between devices.

Manually set statuses, ratings and remarks are kept in each item's `Extra`
field and can sync with Zotero items. Citation keys are read from existing
values; Zest does not generate or edit them.

Automatic journal and affiliation lookups are off by default. Restoring an
author graph uses local data and cached identities; fetching missing identities
requires a separate action. Abstract lookup, translation and citation updates
also have manual controls.

The guide's [data section](docs/guide.en.md#data) explains the separate backups
for reading records, configuration and journal datasets.

## Build from source

You need Node.js, npm and Git. Dependency versions are recorded in
[package-lock.json](package-lock.json).

```bash
git clone https://github.com/yimmy23/zotero-zest.git
cd zotero-zest
npm ci
npm run build
```

The plugin is built at `.scaffold/build/zest.xpi`.

### Development checks

```bash
npm run test:unit
npm run lint:check
npm start
```

`test:unit` runs isolated source regression tests without starting Zotero.
`npm start` serves a configured development instance. Development and native
checks must use `.scaffold/dev-profile`, separate from your everyday library.
See [AGENTS.md](AGENTS.md) for the development workflow.

## Issues and contributions

Report problems or suggestions in
[Issues](https://github.com/yimmy23/zotero-zest/issues). Include your Zotero and
Zest versions, operating system, steps to reproduce, and expected and actual
results. For visual issues, include a screenshot and note the theme and font size.

For journal-data problems, a public journal title, ISSN or DOI and the enabled
sources help reproduce the lookup. Keep API keys, private libraries and sensitive
document contents out of reports.

Before contributing code, read [AGENTS.md](AGENTS.md), keep changes focused and
describe the relevant checks.

## Licence

Copyright © 2026 the Zest authors.

Licensed under the **GNU Affero General Public License v3.0 or later**
(AGPL-3.0-or-later). See [LICENSE](LICENSE). The software is provided without
warranty.
