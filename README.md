# Zest — a reading-centric Zotero plugin (Zotero 10)

> 中文见下 · **v1.0.0** · Free and open source (AGPL-3.0-or-later)

Zest is a from-scratch, open-source rewrite of the ideas behind
[zotero-style](https://github.com/MuiseDestiny/zotero-style) (MuiseDestiny, AGPL-3.0) for modern
Zotero. It puts _reading_ into the item list: how long you read something, which pages you actually
looked at, whether you finished it, and how you rated it.

## Install

1. Download `zest.xpi` from the [latest release](https://github.com/yimmy23/zotero-zest/releases/latest).
2. Zotero → **Tools ▸ Plugins** → gear icon → **Install Plugin From File…** → pick the `.xpi`.
3. Restart Zotero when prompted. Settings live in **Settings ▸ Zest**.

The release notes carry the file's MD5 — verify it if you like:

```bash
md5 ~/Downloads/zest.xpi        # macOS
md5sum zest.xpi                 # Linux
certutil -hashfile zest.xpi MD5 # Windows
```

## What it does

|                                           |                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reading** column                        | time read + a GitHub-style per-page heat strip (4 intensity steps)                                                                                                                                                                                   |
| **Status** column                         | read status stored in `Extra` as `Read_Status` — the same key [Reading List](https://github.com/Dominic-DallOsto/zotero-reading-list) uses; click the dot to cycle                                                                                    |
| **Rating** column                         | 1–5, stored in `Extra` (`rate:` by default, `Rating:` also read); click to rate                                                                                                                                                                      |
| **Tags** / **#Tags** columns              | coloured & emoji tags in their own column; rule-matched tags as text badges (`#`, `~~X`, `/regex/`)                                                                                                                                                  |
| **Authors** columns                       | Authors / First author / Last author, with name order and separators decided per writing system; "et al." comes from Zotero's own locale; optional last-author mark never enters the sort key                                                         |
| **Citations** column                      | counts written to `Extra` as `Citations: N (Source) [date]` — Crossref → OpenAlex → optional Semantic Scholar, fetched only when you ask; other plugins' records (GSCC, ZSCC, openalex) are read but never deleted                                    |
| **Annotations** column                    | how much you marked up: a sparkline of where the annotations sit, or one bar split by highlight colour                                                                                                                                               |
| **Publication Tags / IF / Venue** columns | journal ranking badges and impact factor from your own dataset → easyScholar (optional key) → OpenAlex (no key needed), cached per journal                                                                                                            |
| **Remark** column                         | a one-line note, stored in `Extra`, editable from the list and the panel                                                                                                                                                                             |
| Title decoration                          | optional reading-heat wash behind the title, bold unread titles                                                                                                                                                                                      |
| Reading tracker                           | per-page timing for PDF & EPUB, in tabs and standalone reader windows; stops after 120 s without input; Read-Aloud aware                                                                                                                              |
| Read-status automation                    | start reading → _In Progress_; enough pages + minutes → _Read_ (both thresholds configurable, never overrides your own value)                                                                                                                         |
| **Zest panel**                            | an item-pane section: authors, venue + rank badges, citations with a refresh button, reading time and a clickable per-page heat strip (click a segment, land on that page), status / rating / remark inline, abstract, and links out                  |
| **Annotation Finder**                     | an item-pane section listing every annotation of the item, filtered by the tags selected in the tag tree; double-click jumps into the reader at that annotation                                                                                       |
| **Nested tag tree**                       | your `#Tag/Sub/Sub` tags as a tree beside Zotero's own tag selector: click a branch to filter by everything under it (Zotero's own tag filter can only AND exact names), plus search, sort, colour/emoji rules, branch rename with a merge warning, and full keyboard navigation |
| **Reading statistics**                    | a window with a GitHub-style year calendar, total time, streaks and the items you read most                                                                                                                                                          |
| **Annotation matrix**                     | every annotation in the current view as one searchable table (AND / OR / exclude), filtered by colour or tag, exported to CSV or Markdown, double-click to jump                                                                                       |
| **Column views**                          | save the current column layout under a name, switch to it from the column-header menu, undo the last switch                                                                                                                                          |
| **Item-type filter**                      | show only journal articles / preprints / …, composed with quick search and tag filters instead of replacing them                                                                                                                                     |
| **Graph**                                 | a d3-force panel under the item list: related items, shared authors, shared tags, shared collections                                                                                                                                                 |
| **Vertical tabs**                         | optional tab sidebar: groups that survive restarts, saved sessions, search, drag to reorder — off by default, and it disables itself if Zotero changes its tab internals                                                                              |
| Reader themes & colours                   | three reading backgrounds written to Zotero's own reader theme list; extra highlight palettes in the reader's colour menu                                                                                                                             |
| Collection counts                         | optional item counts beside collection names (three ways of counting)                                                                                                                                                                                |
| Appearance                                | one accent colour drives every Zest surface — picker plus five presets in **Settings ▸ Zest ▸ Appearance**; blue is avoided by default because Zotero paints the selected row with the system selection blue                                          |

Everything is in **Settings ▸ Zest**; per-item actions are in the item context menu (**Zest ▸**) and
under **Tools ▸ Zest**.

Zest **extends** Zotero 10 rather than competing with it: anything that replaces a native surface is off
by default and reversible, filters compose with Zotero's own search instead of overriding it, reader
themes and tag colours go through Zotero's own APIs, and "Show Item in Library" still works while a Zest
filter is on (Zest drops its own filter rather than swallowing the reveal).

## Your data, and what leaves your machine

| What                                              | Where                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Reading records (time per page, days, page count) | `zest.sqlite` in your Zotero data directory — never in your library, never synced         |
| Rating, read status, remark, citation counts      | the item's `Extra` field — syncs with Zotero, survives uninstalling Zest                  |
| Views, tag rules, tab groups & sessions, datasets | `zest-config.json` in your Zotero data directory                                          |
| Journal rank / citation lookups                   | `zest-cache.json` (derived data, safe to delete)                                          |
| API keys                                          | the OS login manager (Keychain / Credential Manager) — never in prefs, exports, or logs   |

**No key is required.** Journal ranks work from a local dataset or OpenAlex; citation counts work from
Crossref and OpenAlex. An easyScholar key only adds the Chinese ranking systems (中科院分区, CSCD, 北大核心…).
Network requests are made only when you trigger them (or enable auto-fetch); nothing is sent anywhere
else, and the config export deliberately excludes every secret.

Reading data can be exported and re-imported as JSON or CSV (**Settings ▸ Zest ▸ Reading Data**), and a
one-time importer picks up legacy zotero-style notes.

## Requirements

Zotero **10.x** (`strict_min_version 10.0`, `strict_max_version 10.*`). Zotero 7 and 8 are not supported.
Earlier development phases were also verified on Zotero 9.0.6, but 9 is no longer regression-tested.

## Building from source

```bash
npm install
npm start      # launches an isolated dev profile with the plugin loaded
npm run build  # produces .scaffold/build/zest.xpi
```

## Licence & attribution

Zest is licensed under **AGPL-3.0-or-later** (see [`LICENSE`](./LICENSE)).

It is inspired by **zotero-style** by MuiseDestiny (AGPL-3.0) and reuses none of its code: every
feature here was written from scratch against Zotero's public APIs. The commercial _Ethereal Style_
build is closed source; its binaries were never downloaded, unpacked or read — the overlapping
features (tab manager, literature info panel, citation counts …) were re-implemented clean-room from
publicly documented behaviour, with our own design. Compatibility with the original is limited to
user-facing data formats (`Extra` keys, `#Tags` match syntax) so existing libraries keep working.

The design notes, the verified Zotero 10 API facts and every deliberate difference from the original
plugin are in [`plan.md`](./plan.md); the architecture and the invariants a contributor must not break
are in [`AGENTS.md`](./AGENTS.md).

---

# Zest — 以“阅读”为中心的 Zotero 插件（Zotero 10）

> **v1.0.0** · 完全开源（AGPL-3.0-or-later）

Zest 是对 [zotero-style](https://github.com/MuiseDestiny/zotero-style)（MuiseDestiny，AGPL-3.0）思路的
**从零重写**，面向新版 Zotero。它把“阅读”这件事放回条目列表：这篇读了多久、哪几页真的看过、
读完没有、你给几分。

## 安装

1. 从 [最新 Release](https://github.com/yimmy23/zotero-zest/releases/latest) 下载 `zest.xpi`。
2. Zotero →**工具 ▸ 插件**→ 齿轮图标 →**Install Plugin From File…**→ 选择该 `.xpi`。
3. 按提示重启 Zotero。设置在**设置 ▸ Zest**。

Release 说明里附有该文件的 MD5，可自行校验：

```bash
md5 ~/Downloads/zest.xpi        # macOS
md5sum zest.xpi                 # Linux
certutil -hashfile zest.xpi MD5 # Windows
```

## 功能

- **阅读**列：阅读总时长 + GitHub 式每页热力条（4 级台阶）。
- **状态**列：阅读状态写在条目 `Extra` 的 `Read_Status` 行——与 [Reading List](https://github.com/Dominic-DallOsto/zotero-reading-list) 同键；点圆点循环切换。
- **评级**列：1～5 分存 `Extra`（默认 `rate:`，同时兼容读取 `Rating:`），单击即评分。
- **标签** / **#标签**列：彩色与 emoji 标签独立成列；按规则（`#`、`~~X`、`/正则/`）匹配的标签显示为文字徽章。
- **作者列**（作者 / 第一作者 / 末位作者）：按文字系统决定姓名顺序与分隔符，「等 / et al.」取自 Zotero 自身语言，可选的末位作者标记不进排序键；支持导入 better-authors 的设置。
- **被引数列**：数值写在 `Extra` 的 `Citations: N (来源) [日期]` 行——Crossref → OpenAlex → 可选 Semantic Scholar，只在你主动触发时联网；能读取其它插件写下的 GSCC / ZSCC / openalex 行，但**从不删除**它们。
- **标注列**：以稀疏柱状图显示标注在全文中的分布，或按高亮颜色分段显示。
- **期刊标签 / 影响因子 / 期刊列**：分区徽章与影响因子，来源依次为本地数据集 → easyScholar（密钥可选）→ OpenAlex（免密钥），按期刊缓存。
- **简记列**：一行备注，存在 `Extra`，列表与面板中都能改。
- 标题装饰：可选的标题底纹热力、未读标题加粗。
- 阅读计时：PDF / EPUB，标签页与独立阅读器窗口都记录；无输入 120 秒停表；朗读中不停表。
- 阅读状态自动化：开始阅读 → 在读；页数与时长同时达标 → 已读（阈值可调，不覆盖你自己设的值）。
- **Zest 面板**：条目面板中的一栏——作者、期刊与分区徽章、被引数（带刷新）、阅读时长与可点击的每页热力条（点哪段跳哪页）、状态 / 评级 / 简记直接编辑、摘要、跳转外部平台。
- **标注定位**：条目面板中列出该条目的全部标注，并按标签树里选中的标签过滤；双击直接跳到阅读器中的那条标注。
- **嵌套标签树**：把 `#标签/子级/子级` 展开成树，挂在 Zotero 原生标签选择器旁边；点父节点即按「该分支下的全部标签」筛选（原生标签筛选只能对精确标签做 AND），支持搜索、排序、颜色与 emoji 规则、整枝重命名（会提示有多少标签将被合并），并可完全用键盘操作。
- **阅读统计**：独立窗口，GitHub 式年度日历、累计时长、连续天数、读得最多的条目。
- **标注矩阵**：把当前视图的全部标注汇成一张可搜索的表（且 / 或 / 排除），按颜色或标签过滤，导出 CSV 或 Markdown，双击跳转。
- **列视图**：把当前列布局存成命名视图，从列标题右键菜单一键切换，并可撤销上一次切换。
- **按类型筛选**：只看期刊论文 / 预印本……与快速搜索、标签筛选叠加生效，而不是互相覆盖。
- **图谱**：条目列表下方的 d3-force 面板，支持相关条目、共同作者、共同标签、共同分类四种模式。
- **垂直标签页**：可选的标签页侧栏——分组可跨重启保留、会话保存、搜索、拖拽排序；**默认关闭**，若 Zotero 改动标签内部实现会自动停用。
- **阅读器主题与配色**：三套阅读背景写入 Zotero 官方的阅读器主题列表；阅读器取色菜单里增加高亮配色方案。
- **分类计数**：可选，在分类名旁显示条目数（三种口径）。
- **外观**：一个主色贯穿 Zest 的全部界面——**设置 ▸ Zest ▸ 外观**里有取色器与 5 个预设；默认避开蓝色，因为 Zotero 选中行用的就是系统选区蓝。

设置集中在**设置 ▸ Zest**；条目右键 **Zest ▸**、菜单 **工具 ▸ Zest** 提供逐条与批量操作。

Zest 是 Zotero 10 的**扩展与优化**，不与原生功能冲突：任何替换原生界面的能力默认关闭且可一键切回，
筛选与 Zotero 自身的搜索叠加而非覆盖，阅读器主题与标签颜色都通过 Zotero 官方接口写入；即使开着 Zest 的
筛选，「Show Item in Library」也照常工作（Zest 会先撤掉自己的筛选，而不是让这个动作静默失败）。

## 数据存在哪里，什么会离开你的电脑

| 内容                                     | 位置                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| 阅读记录（每页时长、按天统计、总页数）   | Zotero 数据目录下的 `zest.sqlite`——不写入文库、不参与同步         |
| 评级、阅读状态、简记、被引数             | 条目的 `Extra` 字段——随 Zotero 同步，卸载 Zest 后依然保留         |
| 视图、标签规则、标签页分组与会话、数据集 | Zotero 数据目录下的 `zest-config.json`                            |
| 期刊分区 / 被引数的查询缓存              | `zest-cache.json`（派生数据，删掉也没关系）                       |
| API 密钥                                 | 系统登录管理器（钥匙串 / 凭据管理器）——不进 prefs、不进导出、不进日志 |

**所有密钥都是可选的。** 期刊分区可以只用本地数据集或 OpenAlex；被引数可以只用 Crossref 与 OpenAlex。
easyScholar 密钥只是额外解锁中文分区体系（中科院分区、CSCD、北大核心……）。只有你主动触发（或开启自动获取）
时才会联网，配置导出**刻意排除**任何密钥。

阅读数据可以导出 / 导入为 JSON 或 CSV（**设置 ▸ Zest ▸ 阅读数据**），并可一键导入旧版 zotero-style 的笔记数据。

## 环境要求

Zotero **10.x**（`strict_min_version 10.0`、`strict_max_version 10.*`）。不支持 Zotero 7 / 8。
早期开发阶段也曾在 Zotero 9.0.6 上实测通过，但 9 已不再做回归测试。

## 从源码构建

```bash
npm install
npm start      # 启动隔离的开发 profile 并加载插件
npm run build  # 生成 .scaffold/build/zest.xpi
```

## 许可与致谢

本项目采用 **AGPL-3.0-or-later**（见 [`LICENSE`](./LICENSE)）。

灵感来自 MuiseDestiny 的 **zotero-style**（AGPL-3.0），**未使用其任何代码**：所有功能均基于 Zotero 公开
API 从零实现。其商业版 _Ethereal Style_ 为闭源软件，我们从未下载、解包或阅读其二进制文件——重叠的功能
（标签页管理器、文献信息面板、被引数等）均依据公开可见的行为描述**净室重写**，界面与实现为自有设计。
与原版的兼容仅限于面向用户的数据格式（`Extra` 键名、`#标签` 匹配语法），以便老用户的数据继续可用。

设计取舍、已验证的 Zotero 10 API 事实、以及与原版有意为之的差异都写在 [`plan.md`](./plan.md)；架构与
「不能破坏的不变量」写在 [`AGENTS.md`](./AGENTS.md)。
