# Zest — 把「阅读」放进 Zotero 的条目列表

> Zotero 10 插件 · v1.0.0 · [English below](#zest--reading-in-your-zotero-item-list)

Zest 记录你**读了多久、真的看过哪些页**，把阅读状态、评级、期刊分区、被引数、标注分布直接摆在条目列表里，
并配上图谱、阅读统计和标注矩阵三个视图。



<img width="4098" height="2464" alt="2026-08-21 精读 Must-Read - Zotero 001173" src="https://github.com/user-attachments/assets/e0f74c95-d707-4da9-9e75-b18559bbd1ce" />

---

## 安装

1. 从 [最新 Release](https://github.com/yimmy23/zotero-zest/releases/latest) 下载 `zest.xpi`。
2. Zotero →**工具 ▸ 插件**→ 右上角齿轮 →Install Plugin From File…→ 选中该 `.xpi`。
3. 按提示重启 Zotero。

Release 页面附有该文件的 MD5，可自行校验：`md5 ~/Downloads/zest.xpi`（macOS）/ `md5sum zest.xpi`（Linux）/
`certutil -hashfile zest.xpi MD5`（Windows）。

## 第一步：套用推荐布局

装好后，条目工具栏上会出现一个 **Z** 按钮（线条风格，和 Zotero 自带图标同一套），点它 →**套用 Zest
推荐列布局**。

这一步会把标题、作者、年份、阅读、状态、评级、标注、期刊标签、影响因子、被引数排成一行，并按阅读时长排序。
不喜欢可以立刻还原：**工具 ▸ Zest ▸ 撤销上一次布局切换**。你也可以自己右键列标题勾选想要的列——Zest 的列
和 Zotero 原生列一样，可以随意拖动、调宽、排序。

> Zest 的列默认大多是关的（每一列都要按行算东西）。**第一次**套用推荐布局时，它会把自己需要的那几列
> 一并打开；此后再套用就只排布局，不再动你的开关——你在**设置 ▸ Zest** 里关掉的列不会被翻回来。

## Z 按钮里有什么

| 菜单项                   | 作用                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| **图谱面板**             | 条目列表下方的关系图：相关条目 / 共同作者 / 共同标签 / 共同分类，可切换模式 |
| **阅读统计…**            | 独立窗口：GitHub 式年度日历、累计时长、连续天数、读得最多的条目             |
| **标注矩阵…**            | 当前视图的全部标注汇成一张可搜索的表，可导出 CSV / Markdown                 |
| **套用 Zest 推荐列布局** | 一键排好上面那套列                                                          |
| **联网获取期刊数据**     | 分区 / 影响因子的联网开关（默认关）——不开这一项，期刊标签列会是空的         |
| **Zest 设置…**           | 打开设置页                                                                  |

## 各个列怎么用

**阅读**——阅读总时长，底下是每页热力条（4 级台阶，颜色越深看得越久）。计时只在阅读器窗口处于活动状态时
走，无输入 120 秒自动停表，朗读时不停。

**状态**——点圆点循环切换：未读 → 待读 → 在读 → 已读 → 不再读。写在条目 `Extra` 的 `Read_Status` 行，
与 Reading List 插件同键。也可以让它自动：开始阅读 → 在读；页数与时长同时达标 → 已读（阈值在设置里，
永远不覆盖你手动设过的值）。

**评级**——点第几颗星就是几分；再点当前最高那颗降一分，点第一颗清零。存 `Extra`。符号和颜色可改
（设置里能换成 ♥ 或任意字符）。

**标签 / #标签**——彩色与 emoji 标签单独成列；`#标签` 列把符合规则的标签显示成文字徽章。规则语法：
`#` 表示以 # 开头的标签、`~~X` 表示**不**以 X 开头、`/正则/` 用正则（有捕获组就只显示捕获的部分）。

**作者 / 第一作者 / 末位作者**——姓名顺序和分隔符按文字系统自动决定（王小明、李雷 / Ada Lovelace,
Alan Turing），「等 / et al.」取自 Zotero 自身语言。可在设置里选显示几位、是否缩写名、给末位作者加标记
（标记不进排序键）。把自己的名字填进「我的名字」，你自己的署名会被高亮。

**期刊标签 / 影响因子 / 期刊**——分区徽章与影响因子。数据来源依次是：你导入的本地数据集 → easyScholar
（填了密钥才用）→ OpenAlex（免密钥）。**默认不联网**，所以刚装好时这两列是空的：从 **Z 按钮 ▸ 联网获取
期刊数据**（等同于设置里的「自动获取」）打开，或右键条目 ▸ Zest ▸ 更新期刊分区。空单元格的悬停提示会告
诉你是哪种情况。查询按期刊（不是按条目）进行，只发送期刊名、ISSN 或 DOI，结果按期刊缓存 30 天。
中科院分区、北大核心等中文体系只有 easyScholar 有，需要在设置里填密钥。

**被引数**——右键条目 ▸ Zest ▸ 更新被引数（可批量、可随时取消）。数值写进 `Extra` 的
`Citations: 12 (Crossref) [2026-08-18]`，来源依次 Crossref → OpenAlex →（可选）Semantic Scholar。
别的插件写的 `GSCC:`、`ZSCC:`、`openalex.cit_count:` 会被读取但**绝不删除**。

**标注**——这条文献你划了多少：稀疏柱状图显示标注在全文中的分布，或按高亮颜色分段。

**简记**——一行备注，双击单元格就能改，存在 `Extra`。

## 条目面板里的两栏

**Zest**——作者、期刊与分区徽章、被引数（带刷新按钮）、阅读时长 + **可点击的每页热力条**（点哪一段就跳到
那一页）、状态 / 评级 / 简记直接编辑、摘要、以及跳转 DOI / Google Scholar / PubMed / Semantic Scholar。

**Annotation Finder**——这条文献的全部标注，按标签树里选中的标签过滤，双击直接跳进阅读器里那条标注。

## 嵌套标签树

如果你用 `#文献密码/研究方法/统计` 这种层级标签，在**设置 ▸ Zest ▸ 标签**里打开嵌套标签树：它会挂在
Zotero 原生标签选择器的位置，把标签展开成树。点父节点 = 按**该分支下的所有标签**筛选（Zotero 原生标签筛选
只能对精确标签做「且」）。支持搜索、排序、折叠、整枝重命名（会提示有多少标签会被合并）、给标签配颜色和
emoji（不占 Zotero 那 9 个颜色位）。全程可用键盘：方向键移动、←/→ 折叠展开、Enter/空格选中。

默认是关的，随时可以切回 Zotero 原生标签选择器。

## 列视图（保存列布局）

把当前的列组合存成一个命名视图（比如「筛文献」「写作」「投标书」），之后从**列标题右键菜单**一键切换，
`Alt+,` / `Alt+.` 在视图间前后切换，切错了还能撤销上一次。视图写的是 Zotero 自己的列配置文件，
所以关掉插件后你的列也还在。

## 阅读数据存在哪、怎么带走

| 内容                                     | 位置                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- |
| 阅读记录（每页时长、按天统计、总页数）   | Zotero 数据目录下的 `zest.sqlite`——**不写入文库、不参与同步**         |
| 评级、阅读状态、简记、被引数             | 条目的 `Extra` 字段——随 Zotero 同步，**卸载 Zest 后依然保留**         |
| 视图、标签规则、标签页分组与会话、数据集 | Zotero 数据目录下的 `zest-config.json`                                |
| 分区 / 被引查询缓存                      | `zest-cache.json`（派生数据，删了会重新查）                           |
| API 密钥                                 | 系统登录管理器（钥匙串 / 凭据管理器）——不进 prefs、不进导出、不进日志 |

- **阅读数据导入导出**：设置 ▸ Zest ▸ 阅读数据 → JSON / CSV，换机器直接搬。
- **整套配置导入导出**：设置 ▸ Zest ▸ 配置 → 一个 JSON 文件（**刻意不含任何密钥**）。
- **所有密钥都是可选的**：不填 easyScholar 也有 OpenAlex 的期刊指标，被引数用 Crossref 就够。只有你主动
  触发（或打开自动获取）时才会联网。

## 其他

- **垂直标签页**（默认关）：把 Zotero 的标签页竖着排在侧边，支持分组（跨重启保留）、保存会话、搜索、拖拽
  排序。若 Zotero 改动了标签页内部实现，这块会自动停用而不是崩掉。
- **阅读器**：三套护眼背景写进 Zotero 官方的阅读器主题列表；取色菜单里多几套高亮配色。
- **分类计数**（默认关）：分类名旁显示条目数，可选「本分类 / 含子分类 / 两者都显示」。
- **外观**：一个主色贯穿全部界面，设置 ▸ Zest ▸ 外观里有取色器和 5 个预设，可一并套用到热力图与徽章。
  默认避开蓝色——Zotero 选中行用的就是系统选区蓝。

## 给模板和脚本用的 API

Zest 把它算出来的东西挂在 `Zotero.Zest.api` 上，供 Better Notes 模板、Actions & Tags 脚本、
以及 `工具 ▸ 开发者 ▸ 运行 JavaScript` 调用。全部只读，**任何一个都不会抛异常**——取不到就返回
空值，模板不会因为某一格没数据而整个中断。传条目对象或条目 ID 都行，传附件会自动上溯到父条目。

```js
const zest = Zotero.Zest.api;

zest.readingTime(item); // "1.5 h"      阅读列显示的那个值
zest.readingSeconds(item); // 5400         总秒数
zest.pagesRead(item); // 23           停留超过 5 秒的页数
zest.pagesTotal(item); // 31
zest.readingProgress(item); // 74           百分比
zest.firstRead(item); // "2026-03-04"
zest.lastRead(item); // "2026-08-19"
zest.readingByDay(item); // { "2026-08-19": 930, … }   每天的秒数
zest.readingByPage(item); // { 0: 120, 1: 45, … }       每页的秒数

zest.readStatus(item); // "In Progress"
zest.rating(item); // 4
zest.ratingStars(item); // "★★★★☆"

zest.citations(item); // 42
zest.citationInfo(item); // { count: 42, source: "Crossref", date: "2026-08-20" }

zest.journalRank(item); // "综合性期刊1区 · Q1"
zest.journalRanks(item); // [{ field, value, source }, …]  按你配置的字段顺序
zest.impactFactor(item); // 56.1
zest.journalName(item); // "Nature"

zest.annotationCount(item); // 18
zest.annotationChars(item); // 4210
zest.annotationColors(item); // [{ color: "#ffd400", count: 12 }, …]
zest.textTags(item); // [{ tag: "#Method/Cohort", text: "Method/Cohort", color }]
```

在 Better Notes 模板里直接插值即可：

```
读了 ${Zotero.Zest.api.readingTime(topItem)}，看到第 ${Zotero.Zest.api.pagesRead(topItem)} 页
评分 ${Zotero.Zest.api.ratingStars(topItem)}
${Zotero.Zest.api.journalRank(topItem)}
```

## 环境要求

Zotero **10.x**。不支持 Zotero 7 / 8。

## 从源码构建

```bash
npm install
npm start      # 启动隔离的开发 profile 并加载插件
npm run build  # 生成 .scaffold/build/zest.xpi
```

---

# Zest — reading, in your Zotero item list

Zest records **how long you read something and which pages you actually looked at**, and puts read
status, rating, journal rank, citation counts and annotation spread straight into the item list —
with a graph, a reading-statistics window and an annotation matrix on top.

## Install

Download `zest.xpi` from the [latest release](https://github.com/yimmy23/zotero-zest/releases/latest),
then Zotero → **Tools ▸ Plugins** → gear icon → **Install Plugin From File…** → restart when prompted.
The release notes carry the file's MD5.

## Start here

A **Z** button appears in the item toolbar, drawn in Zotero's own line-icon style. Click it →
**Apply the Zest column layout**: title, creator, year, reading, status, rating, annotations, journal
tags, IF and citations, sorted by reading time. Don't like it? **Tools ▸ Zest ▸ Undo layout change**.
Most Zest columns ship off, so the **first** apply also turns on the ones the layout needs. Every
apply after that only arranges columns — a column you switch off in **Settings ▸ Zest** stays off.

The same button opens the **graph**, the **reading statistics** window, the **annotation matrix** and
the settings.

## The columns

- **Reading** — total time plus a per-page heat strip (4 steps). The clock only runs while the reader
  window is active, stops after 120 s without input, and keeps running during Read Aloud.
- **Status** — click the dot to cycle New → To Read → In Progress → Read → Not Reading. Stored in
  `Extra` as `Read_Status`, the key Reading List uses. Optional automation: reading starts → In
  Progress; enough pages and minutes → Read (thresholds configurable, never overrides your own value).
- **Rating** — click star _k_ to rate; click the current top star to lower it. Stored in `Extra`;
  symbol and colour are configurable.
- **Tags / #Tags** — coloured and emoji tags in their own column; rule-matched tags as text badges
  (`#` prefix, `~~X` = everything NOT starting with X, `/regex/` with optional capture group).
- **Authors / First author / Last author** — name order and separators decided per writing system,
  "et al." from Zotero's own locale, optional last-author mark that never enters the sort key, and
  your own name highlighted once you put it in Settings.
- **Publication Tags / IF / Venue** — rank badges and impact factor from your own dataset →
  easyScholar (only with a key) → OpenAlex (no key). Offline by default, so both columns start empty:
  switch lookups on from **Z button ▸ Look journal data up online** (the same pref as auto-fetch in
  Settings), or use the item context menu. Hovering an empty cell tells you which case you are in.
  Lookups are per journal, send only the name, ISSN or DOI, and are cached for 30 days. The Chinese
  ranking systems exist only in easyScholar and need a key.
- **Citations** — right-click ▸ Zest ▸ update (batchable, cancellable). Written to `Extra` as
  `Citations: 12 (Crossref) [2026-08-18]`, sourced Crossref → OpenAlex → optional Semantic Scholar.
  Other plugins' records (`GSCC:`, `ZSCC:`, `openalex.cit_count:`) are read but never deleted.
- **Annotations** — where your highlights sit in the document, or one bar split by highlight colour.
- **Remark** — a one-line note, double-click to edit, stored in `Extra`.

## Item pane

**Zest** — authors, venue and rank badges, citations with a refresh button, reading time and a
**clickable** per-page heat strip (click a segment, land on that page), status / rating / remark
inline, abstract, and links out to DOI, Google Scholar, PubMed and Semantic Scholar.

**Annotation Finder** — every annotation of the item, filtered by whatever you selected in the tag
tree; double-click jumps into the reader at that annotation.

## Nested tag tree

For hierarchical tags (`#Method/Statistics/Survival`), turn on the nested tag tree in
**Settings ▸ Zest ▸ Tags**. Clicking a branch filters by **everything under it** — Zotero's own tag
filter can only AND exact names. Search, sort, collapse, rename a whole branch (with a merge warning),
and colour/emoji rules beyond Zotero's nine colour slots. Fully keyboard operable. Off by default, and
one click back to Zotero's own selector.

## Column views

Save the current column arrangement under a name ("Screening", "Writing", "Grant"), switch from the
column-header context menu, `Alt+,` / `Alt+.` to cycle, one level of undo. Views are written to
Zotero's own column settings, so your columns stay put if you disable the plugin.

## Where your data lives

| What                                              | Where                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Reading records (time per page, days, page count) | `zest.sqlite` in your Zotero data directory — never in your library, never synced      |
| Rating, read status, remark, citation counts      | the item's `Extra` field — syncs, and survives uninstalling Zest                       |
| Views, tag rules, tab groups & sessions, datasets | `zest-config.json` in your Zotero data directory                                       |
| Rank / citation lookup cache                      | `zest-cache.json` (derived, safe to delete)                                            |
| API keys                                          | the OS login manager (Keychain / Credential Manager) — never in prefs, exports or logs |

Reading data exports and re-imports as JSON or CSV; the whole configuration exports as one JSON file
that deliberately contains no secrets. **No key is required** — journal ranks work from OpenAlex or
your own dataset, citations from Crossref. Nothing is fetched unless you ask for it.

## Also included

Vertical tab sidebar with persistent groups and saved sessions (off by default), three reader
backgrounds and extra highlight palettes, optional collection counts, and one accent colour driving
every Zest surface (picker plus five presets in **Settings ▸ Zest ▸ Appearance**).

## API for templates and scripts

Everything Zest computes is published on `Zotero.Zest.api`, for Better Notes templates, Actions &
Tags scripts and **Tools ▸ Developer ▸ Run JavaScript**. It is read-only and **nothing throws** — a
missing record answers with an empty value rather than aborting the caller's template. Pass an item
or an item id; an attachment resolves to its parent.

```js
const zest = Zotero.Zest.api;

zest.readingTime(item); // "1.5 h"      what the Reading column shows
zest.readingSeconds(item); // 5400
zest.pagesRead(item); // 23           pages that got more than 5 seconds
zest.pagesTotal(item); // 31
zest.readingProgress(item); // 74           percent
zest.firstRead(item); // "2026-03-04"
zest.lastRead(item); // "2026-08-19"
zest.readingByDay(item); // { "2026-08-19": 930, … }   seconds per day
zest.readingByPage(item); // { 0: 120, 1: 45, … }       seconds per page

zest.readStatus(item); // "In Progress"
zest.rating(item); // 4
zest.ratingStars(item); // "★★★★☆"

zest.citations(item); // 42
zest.citationInfo(item); // { count: 42, source: "Crossref", date: "2026-08-20" }

zest.journalRank(item); // "综合性期刊1区 · Q1"
zest.journalRanks(item); // [{ field, value, source }, …]  in your configured order
zest.impactFactor(item); // 56.1
zest.journalName(item); // "Nature"

zest.annotationCount(item); // 18
zest.annotationChars(item); // 4210
zest.annotationColors(item); // [{ color: "#ffd400", count: 12 }, …]
zest.textTags(item); // [{ tag: "#Method/Cohort", text: "Method/Cohort", color }]
```

## Requirements

Zotero **10.x**. Zotero 7 and 8 are not supported.

## Build from source

```bash
npm install
npm start      # isolated dev profile with the plugin loaded
npm run build  # .scaffold/build/zest.xpi
```

---

## 许可 · Licence

Copyright © 2026 the Zest authors.

Zest is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero
General Public License** as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero
General Public License for more details: [`LICENSE`](./LICENSE) ·
<https://www.gnu.org/licenses/agpl-3.0.html>

本项目为自由软件，依据 **GNU Affero 通用公共许可证（AGPL）第 3 版或任何更新版本**发布，不附带任何担保。
