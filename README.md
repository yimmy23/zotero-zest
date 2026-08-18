# Zest — a reading-centric Zotero plugin (Zotero 9 & 10)

> 中文见下 · **Status: work in progress.** Phases B (columns · reading records · storage) and C (tags ·
> journal ranks · views · graph · reader) are implemented and verified on Zotero 10.0 (and 9.0.6 for
> phase B). No release has been published yet.

Zest is a from-scratch, open-source rewrite of the ideas behind
[zotero-style](https://github.com/MuiseDestiny/zotero-style) (MuiseDestiny, AGPL-3.0) for modern
Zotero. It puts _reading_ into the item list: how long you read something, which pages you actually
looked at, whether you finished it, and how you rated it.

## What works today

|                                           |                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reading** column                        | time read + a GitHub-style per-page heat strip (4 intensity steps)                                                                                                                                                                                    |
| **Status** column                         | read status stored in `Extra` as `Read_Status` — the same key [Reading List](https://github.com/Dominic-DallOsto/zotero-reading-list) uses; click the dot to cycle                                                                                    |
| **Rating** column                         | 1–5, stored in `Extra` (`rate:` by default, `Rating:` also read); click to rate                                                                                                                                                                       |
| **Tags** / **#Tags** columns              | coloured & emoji tags in their own column; rule-matched tags as text badges (`#`, `~~X`, `/regex/`)                                                                                                                                                   |
| Title decoration                          | optional reading-heat wash behind the title, bold unread titles                                                                                                                                                                                       |
| Reading tracker                           | per-page timing for PDF & EPUB, in tabs and standalone reader windows; stops after 120 s without input; Read-Aloud aware                                                                                                                              |
| Read-status automation                    | start reading → _In Progress_; enough pages + minutes → _Read_ (both thresholds configurable, never overrides your own value)                                                                                                                         |
| Data                                      | reading records live in **`zest.sqlite`** in your Zotero data directory — never in your library, never synced; JSON/CSV export & import, and a one-time importer for legacy zotero-style notes                                                        |
| **Nested tag tree**                       | your `#Tag/Sub/Sub` tags as a tree beside Zotero's own tag selector: click a branch to filter by everything under it (Zotero's own tag filter can only AND exact names), plus search, sort, colour/emoji rules and branch rename with a merge warning |
| **Annotation Finder**                     | an item-pane section listing every annotation of the item, filtered by the tags selected in the tree; double-click jumps into the reader at that annotation                                                                                           |
| **Annotations** column                    | how much you marked up: a sparkline of where the annotations sit, or one bar split by highlight colour                                                                                                                                                |
| **Publication Tags / IF / Venue** columns | journal ranking badges and impact factor from your own dataset → easyScholar (optional key) → OpenAlex (no key needed), cached per journal                                                                                                            |
| **Column views**                          | save the current column layout under a name, switch to it from the column-header menu, undo the last switch                                                                                                                                           |
| **Item-type filter**                      | show only journal articles / preprints / …, composed with quick search and tag filters instead of replacing them                                                                                                                                      |
| **Graph**                                 | a d3-force panel under the item list: related items, shared authors, shared tags, shared collections                                                                                                                                                  |
| **Reader themes & colour schemes**        | three reading backgrounds written into Zotero's own reader-theme list, plus highlight palettes in the reader's colour menu                                                                                                                            |
| **Collection counts**                     | optional item counts next to collection names (three modes)                                                                                                                                                                                           |
| Configuration                             | export/import the whole configuration (preferences, views, tag rules, dataset list) as one JSON file — API keys are never included                                                                                                                    |

Everything is in **Settings → Zest**; per-item actions are in the item context menu (**Zest ▸**) and
under **Tools ▸ Zest**.

Zest **extends** Zotero 10 rather than competing with it: anything that replaces a native surface is off
by default and reversible, filters compose with Zotero's own search instead of overriding it, and reader
themes and tag colours go through Zotero's own APIs.

Planned next: vertical tab manager, citation counts, an authors column, the literature info panel and a
reading-statistics dashboard. The full plan, including verified
Zotero 9/10 API facts and the deliberate differences from the original plugin, is in
[`plan.md`](./plan.md).

## Requirements

Zotero **9.0 – 10.x** (`strict_min_version 9.0`, `strict_max_version 10.*`). Zotero 7 is not supported.

## Building

```bash
npm install
npm start     # launches an isolated dev profile with the plugin loaded
npm run build # produces the .xpi in build/
```

## Licence & attribution

Zest is licensed under **AGPL-3.0-or-later** (see [`LICENSE`](./LICENSE)).

It is inspired by **zotero-style** by MuiseDestiny (AGPL-3.0) and reuses none of its code: every
feature here was written from scratch against Zotero's public APIs. The commercial _Ethereal Style_
build is closed source; its binaries were never downloaded, unpacked or read — the overlapping
features (tab manager, literature info panel, citation counts …) were re-implemented clean-room from
publicly documented behaviour, with our own design. Compatibility with the original is limited to
user-facing data formats (`Extra` keys, `#Tags` match syntax) so existing libraries keep working.

---

# Zest — 以“阅读”为中心的 Zotero 插件（Zotero 9 / 10）

> **状态：开发中。** 阶段 B（列 · 阅读记录 · 存储）与阶段 C（标签体系 · 期刊分级 · 视图 · 图谱 · 阅读器）已完成，
> 在 Zotero 10.0 上实测通过（阶段 B 亦在 9.0.6 上验证）；尚未发布 Release。

Zest 是对 [zotero-style](https://github.com/MuiseDestiny/zotero-style)（MuiseDestiny，AGPL-3.0）思路的
**从零重写**，面向新版 Zotero，完全开源。它把“阅读”这件事放回条目列表：这篇读了多久、哪几页真的看过、
读完没有、你给几分。

## 目前可用

- **阅读**列：阅读总时长 + GitHub 式每页热力条（4 级台阶）。
- **状态**列：阅读状态写在条目 `Extra` 的 `Read_Status` 行——与 [Reading List](https://github.com/Dominic-DallOsto/zotero-reading-list) 同键；点圆点循环切换。
- **评级**列：1～5 分存 `Extra`（默认 `rate:`，同时兼容读取 `Rating:`），单击即评分。
- **标签** / **#标签**列：彩色与 emoji 标签独立成列；按规则（`#`、`~~X`、`/正则/`）匹配的标签显示为文字徽章。
- 标题装饰：可选的标题底纹热力、未读标题加粗。
- 阅读计时：PDF / EPUB，标签页与独立阅读器窗口都记录；无输入 120 秒停表；朗读中不停表。
- 阅读状态自动化：开始阅读 → 在读；页数与时长同时达标 → 已读（阈值可调，不覆盖你自己设的值）。
- 数据：阅读记录存在 Zotero 数据目录下的 **`zest.sqlite`**，不写入文库、不参与同步；支持 JSON/CSV 导入导出，并可一键导入旧版 zotero-style 的笔记数据。
- **嵌套标签树**：把 `#标签/子级/子级` 展开成树，挂在 Zotero 原生标签选择器旁边；点父节点即按「该分支下的全部标签」筛选（原生标签筛选只能对精确标签做 AND），支持搜索、排序、颜色与 emoji 规则、整枝重命名（会提示有多少标签将被合并）。
- **标注定位**：条目面板中列出该条目的全部标注，并按标签树里选中的标签过滤；双击直接跳到阅读器中的那条标注。
- **标注列**：以稀疏柱状图显示标注在全文中的分布，或按高亮颜色分段显示。
- **期刊标签 / 影响因子 / 期刊列**：分区徽章与影响因子，来源依次为本地数据集 → easyScholar（密钥可选）→ OpenAlex（免密钥），按期刊缓存。
- **列视图**：把当前列布局存成命名视图，从列标题右键菜单一键切换，并可撤销上一次切换。
- **按类型筛选**：只看期刊论文 / 预印本……与快速搜索、标签筛选叠加生效，而不是互相覆盖。
- **图谱**：条目列表下方的 d3-force 面板，支持相关条目、共同作者、共同标签、共同分类四种模式。
- **阅读器主题与配色**：三套阅读背景写入 Zotero 官方的阅读器主题列表；阅读器取色菜单里增加高亮配色方案。
- **分类计数**：可选，在分类名旁显示条目数（三种口径）。
- 配置：整套配置（设置项、视图、标签规则、数据集清单）可导出 / 导入为一个 JSON 文件，**不包含任何 API 密钥**。

设置集中在**设置 → Zest**；条目右键 **Zest ▸**、菜单 **工具 ▸ Zest** 提供逐条与批量操作。

Zest 是 Zotero 10 的**扩展与优化**，不与原生功能冲突：任何替换原生界面的能力默认关闭且可一键切回，
筛选与 Zotero 自身的搜索叠加而非覆盖，阅读器主题与标签颜色都通过 Zotero 官方接口写入。

接下来：垂直标签页管理器、被引数列、作者列、文献信息面板、阅读统计面板。完整计划（含已验证的 Zotero 9/10 API 事实、以及与原版有意为之的差异）见 [`plan.md`](./plan.md)。

## 许可与致谢

本项目采用 **AGPL-3.0-or-later**（见 [`LICENSE`](./LICENSE)）。

灵感来自 MuiseDestiny 的 **zotero-style**（AGPL-3.0），**未使用其任何代码**：所有功能均基于 Zotero 公开
API 从零实现。其商业版 _Ethereal Style_ 为闭源软件，我们从未下载、解包或阅读其二进制文件——重叠的功能
（标签页管理器、文献信息面板、被引数等）均依据公开可见的行为描述**净室重写**，界面与实现为自有设计。
与原版的兼容仅限于面向用户的数据格式（`Extra` 键名、`#标签` 匹配语法），以便老用户的数据继续可用。
