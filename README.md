# Zest — a reading-centric Zotero plugin (Zotero 9 & 10)

> 中文见下 · **Status: work in progress.** Phase B (columns · reading records · storage) is implemented
> and verified on Zotero 9.0.6 and 10.0. No release has been published yet.

Zest is a from-scratch, open-source rewrite of the ideas behind
[zotero-style](https://github.com/MuiseDestiny/zotero-style) (MuiseDestiny, AGPL-3.0) for modern
Zotero. It puts _reading_ into the item list: how long you read something, which pages you actually
looked at, whether you finished it, and how you rated it.

## What works today

|                              |                                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reading** column           | time read + a GitHub-style per-page heat strip (4 intensity steps)                                                                                                                             |
| **Status** column            | read status stored in `Extra` as `Read_Status` — the same key [Reading List](https://github.com/Dominic-DallOsto/zotero-reading-list) uses; click the dot to cycle                             |
| **Rating** column            | 1–5, stored in `Extra` (`rate:` by default, `Rating:` also read); click to rate                                                                                                                |
| **Tags** / **#Tags** columns | coloured & emoji tags in their own column; rule-matched tags as text badges (`#`, `~~X`, `/regex/`)                                                                                            |
| Title decoration             | optional reading-heat wash behind the title, bold unread titles                                                                                                                                |
| Reading tracker              | per-page timing for PDF & EPUB, in tabs and standalone reader windows; stops after 120 s without input; Read-Aloud aware                                                                       |
| Read-status automation       | start reading → _In Progress_; enough pages + minutes → _Read_ (both thresholds configurable, never overrides your own value)                                                                  |
| Data                         | reading records live in **`zest.sqlite`** in your Zotero data directory — never in your library, never synced; JSON/CSV export & import, and a one-time importer for legacy zotero-style notes |

Everything is in **Settings → Zest**; per-item actions are in the item context menu (**Zest ▸**) and
under **Tools ▸ Zest**.

Planned next: nested tags, view groups, journal rank / IF / citation columns, graph view, vertical
tab manager, literature info panel, reading-statistics dashboard. The full plan, including verified
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

> **状态：开发中。** 阶段 B（列 · 阅读记录 · 存储）已完成，并在 Zotero 9.0.6 与 10.0 上实测通过；尚未发布 Release。

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

设置集中在**设置 → Zest**；条目右键 **Zest ▸**、菜单 **工具 ▸ Zest** 提供逐条与批量操作。

接下来：嵌套标签、视图组、期刊分区 / IF / 被引数列、关系图谱、垂直标签页管理器、文献信息面板、
阅读统计面板。完整计划（含已验证的 Zotero 9/10 API 事实、以及与原版有意为之的差异）见 [`plan.md`](./plan.md)。

## 许可与致谢

本项目采用 **AGPL-3.0-or-later**（见 [`LICENSE`](./LICENSE)）。

灵感来自 MuiseDestiny 的 **zotero-style**（AGPL-3.0），**未使用其任何代码**：所有功能均基于 Zotero 公开
API 从零实现。其商业版 _Ethereal Style_ 为闭源软件，我们从未下载、解包或阅读其二进制文件——重叠的功能
（标签页管理器、文献信息面板、被引数等）均依据公开可见的行为描述**净室重写**，界面与实现为自有设计。
与原版的兼容仅限于面向用户的数据格式（`Extra` 键名、`#标签` 匹配语法），以便老用户的数据继续可用。
