# plan.md — Zest（zotero-style 的 Zotero 7–10 从零重构）

> 阶段 A 产出。研究底稿在会话 scratchpad `research/`（19 份报告 + 5 份对抗核验 + 批评稿），本计划只保留结论与依据。所有"文件:行"引用指 Zotero 9.0.6 解包源码（`omni-app/`）或 zotero-style AGPL 源码（`zotero-style/`）。
> 图例：✅ 已定（可回退）· ⏸ 需拍板 · 🔍 需 dev 实例真机探针后再定。

---

## 0. 决策摘要（先看这一页）

| #   | 事项                                  | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **名字** ✅（易改）                   | **Zest**——短、易记、无同名 Zotero 插件（GitHub / zotero-chinese 商店均无）。ID `zest@zotero-zest.app`，chrome `zest`，prefs `extensions.zotero.zest`，仓库 `yimmy23/zotero-zest`。备选：Flair / Prism。                                                                                                                                                                                                                                                                                                                                                                                                              |
| D2  | **开源基线**                          | GitHub 源码冻结在 **2.6.7（2023-05 主体 + 2023-12 一个 5 行 PR）**，Zotero 6 时代代码；2.8.0→6.0.8 的全部发布只有 xpi（含 Zotero 7 支持、"Ethereal Style"命名、Pro）。因此"开源版功能"= 2.6.7 源码 + README；一切都是在 Z7–9 官方 API 上的重新实现，不存在可移植的 Z7 代码。                                                                                                                                                                                                                                                                                                                                         |
| D3  | **Zotero 版本** ✅                    | 实测目标 7.0.x（≥7.0.10）/ 8.0.x / 9.0.6；`strict_min_version 7.0.10`（`ItemTreeManager.registerColumn` 单数形式与 `renderCell(…, doc)` 自 7.0.10 起才有）、`strict_max_version 10.*`（你的要求；官方 Zotero 10 开发者页建议 `10.0.*`，且 major 约每 8 周一个——两者都要靠 `update.json` 常态化抬 max）。**Zotero 10 = 公开 beta**（GitHub 无 10.x tag，但有 `10.0` 分支 2026-08-14；官方 [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers) 2026-08-06 已列出破坏性变化，见 §1.3 末）。本机没有 10 beta 可测：按官方清单写兼容代码 + 特性检测，交付时说明"10 beta 未真机验证"。 |
| D4  | **SyncedSettings 不能用于插件配置** ⏸ | dataserver 对 setting 名**白名单**（`tagColors/feeds/lastPageIndex_*/readerCustomThemes/…`，dataserver `model/Settings.inc.php` L30-40 已亲自核对），自定义键会让整个 `POST /settings` 400 → **该库同步持续失败**。故 §3 里"视图组 / 标签规则 / 分区显示偏好 → SyncedSettings"不可行。**建议**：这类配置存 prefs（JSON 字符串）+ 数据目录 `zest-config.json`，"插件配置导入/导出"做成一等功能；跨设备靠导出文件（不写隐藏条目、不碰 SyncedSettings）。                                                                                                                                                               |
| D5  | **标题列底纹 / 未读加粗** ✅          | Zotero 不允许替换内置 Title 列渲染。采用"每窗口包一层 `ItemTree.prototype._renderCell`（primary 列后处理）"——7.0.0→10-main 签名未变（评级 B+），全程 `guard()`，探针失败即静默降级为独立 "Reading" 列。                                                                                                                                                                                                                                                                                                                                                                                                              |
| D6  | **垂直标签页** ✅                     | 无公开 Tabs API；依赖 `Zotero_Tabs.{_tabs,selectedID,select,close,move}` + Notifier `tab` 事件 + `#tab-bar-container` MutationObserver（三者 7.0.0→main 契约未变）。侧栏为 `<vbox>+<splitter>` 插在 `#tabs-deck` 前；原生横条**仅 CSS 隐藏** `#tab-bar-container > div{display:none}`。全部私有调用走 `probeTabsAPI()` 特性检测，缺失即整块功能禁用并提示。                                                                                                                                                                                                                                                          |
| D7  | **Pro 清洁室范围** ⏸                  | 实现：Tab Manager/垂直标签页、Cited Counts（你追加的需求）、Explore→"文献信息面板"（ItemPane section）、TLDR（S2 一句话摘要，顺手）。**不做**：Attachment Preview（Zotero 7 已原生）、Note Manager、Backlinks（行为不明）、AI 简记/标签（需外部 LLM）。**Annotation Manager + 文献矩阵**：价值高但体量大，建议列为 D 阶段末的可选项，视余量决定。                                                                                                                                                                                                                                                                    |
| D8  | **新增功能（实现 5 个）** ✅          | ① 阅读统计面板 + 日历热力图 + 周/年总结；② 分区数据离线缓存 + 多来源并存（easyScholar + 本地 JSON 数据集 + OpenAlex 期刊指标兜底）；③ 阅读记录导出/导入 + 旧版一键迁移；④ Zotero 彩色标签互通；⑤ 阅读状态自动化（开始阅读→In Progress、进度≥阈值→Read，可关）。加上你追加的 **作者列（better-authors 逻辑重做）** 与 **被引数列**。                                                                                                                                                                                                                                                                                  |
| D9  | **删除** ✅                           | Shift+P 命令面板、隐藏"Addon Item"笔记存储、斑马纹/选中行硬编码颜色、按扩展名替换附件图标、Obsidian 图谱引擎、4 个死 pref、`Array.prototype.map` 劫持式标注配色、全局 `getField/Search.search` 补丁。理由见 §4.4。                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 1. 事实基线（研究结论，含依据）

### 1.1 原插件（AGPL 2.6.7 源码）

- 列：内置 title / firstCreator / publicationTitle 通过 toolkit-2 `addRenderCellHook`（= 全局 `_renderCell` 补丁）改造；新增 Tags / #Tags / PublicationTags / IF / Progress / Rating 六列通过全局 `Zotero.Item.prototype.getField` 补丁挂上（返回串即排序键）。（views-columns.md §0、§14）
- 阅读记录：唯一记录 `readingTime = { page: <numPages>, data: { "<0-based pageIndex>": <累计秒> } }`；采集 = 窗口 `activate` 起 10 s 定时器读 `Zotero.Reader.getByTabID(...).state.pageIndex`（**Z7 起 `reader.state` 不存在，此代码在 Z7 根本不记录**），位置 60 s 不变判空闲；写入"Addon Item"（`computerProgram` 条目，libraryID 硬编码 1）的子笔记 `${itemKey}\n{json}`，或 pref `storage.in=file` 时写 JSON 文件；期刊标签缓存另写 `<dataDir>/zoterostyle.json`。（progress-storage.md §1–3）
- easyScholar：`GET https://www.easyscholar.cc/open/getPublicationRank?secretKey=…&publicationName=…`，无 key 不请求；HTTP 恒 200，业务码 40002/40005/40006；返回 `officialRank.{all,select}` + `customRank`；字段 37–45 个（`sci/sciif/sciif5/jci/ssci/ahci/eii/sciUp/sciBase/sciwarn/ccf/cscd/pku/cssci/…`，全表见 easyscholar-prefs-locale.md §2）；无退避无限流。
- 视图组：`{name, position, content, dataKeys[], prefs?}` JSON 存 pref `columnsViews`（本地）；应用时改私有 `itemsView.tree._columns` + `_storePrefs`；真正持久化在 `<profile>/treePrefs.json`。（views-viewgroups-graph.md）
- 嵌套标签：DOM 覆盖原生标签选择器；语法 = 前缀匹配（`textTagsColumn.match`：`#` / `~~X` / `/re/flags`）+ `/` 分层；点击 = `itemsView.setFilter("tags", Set)`，为了前缀匹配把 `CollectionTreeRow.getSearchObject` 整体替换成 "tag contains"（Z8+ 直接抛错）；右键仅 Rename/Copy/Delete；颜色/位置只在 Shift+P "标签"命令里（`Zotero.Tags.setColor`，位置 = `tagColors` 数组下标，UI 显示 +1 但写回原值 → 差一）。（tags-nested.md）
- 图谱：Obsidian 私有渲染器 + pixi（不可复用）；数据 4 种模式（默认/related/author/tag），全部只用公开 API，可直接迁到 d3-force。（views-viewgroups-graph.md）
- 其它：Rating = Extra 行 `rate: N`；类型快速筛选 = 补丁 `CollectionTreeRow.prototype.getItems`；分类计数 = 补丁 `collectionsView.renderItem`；标注配色 = 往 reader iframe 注入脚本覆盖 `Array.prototype.map`；"PDF Styles/已读未读/文献信息面板/简记/阅读时间列/配置导入导出" **不在源码里**（都是 2.7+ 二进制）。（views-commands.md）
- prefs 71 个：4 个死键（`enable`、`graphView.show`、`textTagsColumn.prefix`、`nestedTags.sortord`），3 个用而未声明。（easyscholar-prefs-locale.md §3）

### 1.2 Pro / 二进制版（仅公开文字，未碰任何 xpi）

- 作者飞书文档列出的 Pro-only：Tab Manager（竖向列表、已关闭/最近导入、标签页组保存恢复；2026-02 "垂直标签页"≥5.9.3 限时免费）、Cited Counts（S2 拆 HI/Background/Methods/Results + Google Scholar + CNKI 被引/下载，Map 重写显示）、Explore（右侧信息面板）、Attachment Preview/对照阅读、Backlinks（正文空）、Annotation Manager + 文献矩阵（核心字段 `{name, condition:{attribute:"tag"|"color", operator:"is"|"contains"|"beginsWith", value}}[]`）、Note Manager。（pro-web-cn.md §3、pro-github-forum.md）
- 免费但仅二进制：已读/未读与状态列（标签 `/unread` `/reading` `/done`）、阅读时间列、简记、配置导入导出、TLDR、Style Editor CSS、Favorites、年终总结、Menu Visibility Manager 等。
- 授权：Gitee LICENSE 为商业许可；作者论坛承认发布过混淆代码；同一 addon ID `zoterostyle@polygon.org`（我们必须换 ID）。README 措辞建议见 pro-web-cn.md §7。

### 1.3 Zotero 7–9 API（源码核对 + 对抗核验通过）

- **列**：`Zotero.ItemTreeManager.registerColumn(opt) → string|false`（同步，7.0.10+）；`dataProvider(item, dataKey)` 同步、返回**字符串**、对所有列（含隐藏）调用并缓存于 `_rowCache`；`renderCell(index, data, column, isFirstColumn, doc)` 同步、必须返回 `doc` 的 Element 且含 `.cell-text`；**无自定义比较器**，`Intl.Collator(numeric = naturalSorting 默认 true)` 比较 dataProvider 串（空串升序在后、降序在前）；表头图标 `iconPath/iconLabel/htmlLabel`，单元格图标只能 renderCell 自画；`width` 必须是**无单位数字字符串**；刷新：`Zotero.Notifier.trigger('refresh','item',ids)` 清 `_rowCache` 重绘（轻量），`refreshColumns()` 全量重建（重）；dataKey 会被改写为 `CSS.escape("pluginID-dataKey")`（Z8+）；`defaultIn:["default"]` 才首次可见；`zoteroPersist` 控制 width 持久化。（api-itemtree-columns.md + verify）
- **Reader**：`ReaderInstance` 是 Proxy；页码真值 `reader._internalReader._state.{primary, primaryViewStats.{pageIndex(0-based), pagesCount}, primaryViewState}`（每次采样重取，`_updateState` 每次换新对象）；边界事件：Notifier `tab` add/select/close/load（close 无 payload、先于插件被处理，需 priority<100 抢先或自维护映射）、`file` open（7+）/ close·pageChange（**9+**）、`setting` `lastPageIndex_*`（7+）；`Zotero.Reader.registerEventListener` 9 种（`renderToolbar` 每 reader 只触发一次；**永远别调 `unregisterEventListener`**，7.0.0–9.0.6 逻辑反向）；PDF 底色 = **8.0+ 官方自定义主题** SyncedSetting `readerCustomThemes[{id,label,background,foreground,invertImages}]` + prefs `reader.lightTheme/darkTheme`（这个 SyncedSetting 在白名单内，可写）；7.0.x 无此机制。9.0 有官方 `attachmentLastRead`/`recentlyRead`。（api-reader-events.md + verify）
- **Tabs**：见 D6；`getState()` 不写 tab id（重启即变），元数据要按 `(libraryID,itemKey)` 存；不要用自定义 tab type（8+ `restoreState` 会 TypeError）；`Zotero_Tabs.add({type:'reader-unloaded', data:{itemID}})` 是官方自己的恢复方式；MenuManager（8+）有 `main/tab` 目标；dstillman 2025-07 说"Tab groups are planned"（中期风险）。（api-tabs.md）
- **标签/颜色**：`Zotero.Tags.getColors(libraryID)` 同步 → `Map<name,{color,position}>`（存 SyncedSetting `tagColors`，位置=数组下标）；`setColor/rename/removeFromLibrary` 异步；标签选择器是 React 组件、**无插件钩子**；条目树 `item.getItemsListTags()` + `span.tag-swatch`。（api-tags-db-misc.md §1）
- **自有 SQLite**：`new Zotero.DBConnection('zest')` → `<dataDir>/zest.sqlite`（EXCLUSIVE 锁、自动 .bak、无 WAL）；`queryAsync/valueQueryAsync/executeTransaction`；**shutdown 必须 `closeDatabase()`**（热重载会开第二个独占连接）。（§3）
- **Extra**：`Zotero.Utilities.Internal.extractExtraFields` 只认 Zotero 字段/CSL 变量，自定义键留在 extra；Reading List 用 `Read_Status: <New|To Read|In Progress|Read|Not Reading>` + `Read_Status_Date: <ISO>`；toolkit `ExtraFieldTool.replaceExtraFields` 会**丢弃非 `": "` 行**，不用。（§4）
- **凭据**：`Services.logins`（`addLoginAsync/searchLoginsAsync`，Zotero 自己存 API key 用 origin `chrome://zotero`）可用。（§7）
- **其它**：`ItemPaneManager.registerSection`（7.0+）、`registerInfoRow`（7.0.10+）、`MenuManager.registerMenu`（8.0+，Z7 走 DOM 回退）、`PreferencePanes.register`（8+ 脚本在独立 sandbox）。

### 1.3b Zotero 10（官方开发者页 2026-08-06 + `10.0` 分支源码，均已核对）

- 单数选择 API **抛错**：`ZoteroPane.getSelectedCollection()/getSelectedLibraryID()/getCollectionTreeRow()/getSelectedSavedSearch()/getSelectedGroup()` → 一律用复数 `getSelectedCollections()/getSelectedLibraryIDs()/getCollectionTreeRows()`（特性检测：有复数用复数，否则退单数）；MenuManager context 的 `collectionTreeRow` 读取抛错 → `collectionTreeRows`。
- 多选时条目列表含 **library header / spacer 行**：`dataProvider` 会收到 `Zotero.Library` → 所有 dataProvider/renderCell 先 `item instanceof Zotero.Item`；遍历行用 `row.isObjectRow`。`ItemTree` 拆成 `ItemTree/ItemTreeRow/CollectionViewItemTree`，但 `registerColumn` 契约（`itemTreeManager.js/pluginAPIBase.mjs` md5 与 9.0.6 相同）与 `_renderCell/_renderItem` 原型方法未变；`_getColumns` 缓存键加了 `viewType`（视图组需真机验证）。
- 名字形式 `Zotero.DBConnection` 自动 **WAL**（多 `-wal` 文件）；`Search.addCondition()` 传旧 `required` 真值抛错；`Zotero.Reader.unregisterEventListener` 反逻辑已修；`Zotero.MenuManager` 关闭时清 DOM；插件 `prefs.js` 改动免重启；`item.saveTx({undoAction})` 可接入撤销。
- 官方建议 `strict_max_version 10.0.*`（beta/源码构建不再强制）；major 约 8 周一个 → `update.json` 抬 max 要成为常规动作。

### 1.3c 对抗核验补充要点（写代码时直接照做）

- 列：`defaultIn:["default"]` 缺省首次必隐藏；`width` 必须无单位数字字符串；`this` 在 dataProvider/renderCell 内不是 ItemTree（箭头函数包裹）；dataProvider 返回非字符串会在 type-to-find/排序时抛错；注解子行（8.0+）也会调 dataProvider。
- Tabs：`Zotero_Tabs.select()` 对未知 id 从 **8.0.0** 起抛错（先 `_getTab(id).tab` 判空）；7.0.x `add()/rename()` 必须传字符串 title；正常打开的 reader tab 在 `add` 事件时**标题为空**（随后 `rename()` 异步补上且不发事件）→ 侧栏在 `load` 事件/MutationObserver 后再取 `item.getTabTitle()`；`unloadUnusedTabs` 24 h 也会卸载 note tab（同 id close+add）；9.0.x `tab.audioStatus` 可能恒为 undefined；`Zotero.Reader.open` 绑定"最近焦点主窗口"且已有 unloaded tab 时返回 undefined。
- 标签/杂项：emoji 判定在 7.0.x 只能用 `/\p{Extended_Pictographic}/gu`（Fx115 无 `v` 标志，照抄 Z9 的 `\p{RGI_Emoji}/v` 会 SyntaxError）；监听 `setting` 事件读 `Zotero.Tags.getColors()` 要注册 priority **101**（Zotero.Tags 自己是 100）；批量写条目用 `saveTx({notifierQueue})` + `Notifier.commit(queue)` 合并通知；`APP_SHUTDOWN` 时也要 `closeDatabase()`（Zotero 先等插件 shutdown 再关主库）；`registerSection` 返回的命名空间 ID 三代算法不同——选择器/注销只用返回值；9.0.2+ 改 FTL 需重载插件；`queryAsync` 只对首 token `select/pragma` 返回行（`WITH…`/`RETURNING` 返回 undefined）。
- Reader：`file/open` 也由"Show File"触发且早于 reader 实例存在；9.0 `AttachmentReadObserver` 在阅读中会产生附件 `item/modify` 通知（我们的 item 观察者要忽略）；`renderToolbar` 每 reader 只一次；`viewStats.pageIndex` = pdf.js 当前页规则（可见面积最大页），非"第一个可见页"。

### 1.4 同类插件启示（peers-plugins.md、peer-*.md）

- 列：所有人都用 `registerColumn`；**不要在 pref 变化时重新注册列**（reading-list #27/#55 列宽失效），刷新走 Notifier；dataKey 只用 `[a-z0-9_]`；表头图标用 iconPath（会隐藏排序箭头）。
- 阅读历史：Chartero 仍用"主条目 + 子笔记"（>500 KB 笔记不可同步、多设备重复主条目）——正是我们要避免的。
- 被引数：GSCC（MPL）靠 Google Scholar 抓 HTML（CAPTCHA/封 IP、v4+ 有验证码窗口 Promise 永不 resolve 的 bug），Extra `GSCC: 0001719 <ISO> <score>`；生态最完整的是 daeh/zotero-citation-tally（AGPL）`Citations: 42 (Crossref) [2026-07-28]`；OpenAlex 2026-02 起要免费 key（匿名 100 次/天）。
- 作者列：better-authors（AGPL）三列共用 11 个纠缠的 pref、creatorTypeID 曾硬编码 8、末位标记进排序键、改设置需重启；改进设计（角色解析→归一化→选择策略→格式→装饰，显示与排序键分离）见 §4.3。

---

## 2. 功能矩阵

### 2.1 开源版功能（源码盘点）→ 处理方式

| 功能                             | 原实现                             | Zest 方案                                                                                                                                                                                                                                                                                    | 阶段 |
| -------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Title 阅读进度底纹               | `_renderCell` 补丁 + 笔记存储      | 独立 **Reading 列**（官方 `registerColumn`，renderCell 画 CSS 线性渐变，O(1) 读内存 Map）为主；**Title 底纹**为可选增强（D5 方案），同一渲染函数                                                                                                                                             | B    |
| 未读加粗                         | 3.x 二进制（标签 `/unread`）       | **Status 列**（Extra `Read_Status`，与 Reading List 兼容，点击循环切换）+ Title 加粗（D5 补丁内加类）                                                                                                                                                                                        | B    |
| Progress（标注密度）             | 异步算、内存缓存、不可排序         | 保留；由 Notifier（annotation add/modify/delete）驱动异步预计算 → 缓存 `{总字符, 直方图}`；dataProvider 返回零填充总量（可排序）                                                                                                                                                             | C    |
| Tags 列（彩色圆点/emoji）        | JSON + 绝对定位圆点                | 保留：`getItemsListTags()` + `Zotero.Tags.getColors`，emoji 用 `Utilities.Internal.containsEmoji`；颜色变化监听 `setting` 通知 → refresh                                                                                                                                                     | B    |
| #Tags 列（前缀/正则/emoji/徽章） | `getTagMatch`                      | 保留语法（`#` / `~~X` / `/re/flags`），dataProvider 返回匹配后文本（可读排序）；徽章色 = Zotero 标签色 > 标签规则色 > 默认色；规则/颜色缓存到模块级                                                                                                                                          | B    |
| Publication Tags（分区徽章）     | easyScholar + JSON 缓存            | 保留：多来源（§4.2）；dataProvider 返回排序前缀串；renderCell 徽章；Map 重写语法兼容（`A=B, /re/=X`）                                                                                                                                                                                        | C    |
| IF 列                            | 字符串排序                         | 保留；零填充数值排序；线性条                                                                                                                                                                                                                                                                 | C    |
| Rating 列                        | Extra `rate: N`，悬停预览+二次点击 | 保留；读 `rate:`/`Rating:`，写回沿用条目已有键否则 `Rating: N`；renderCell 内委托点击                                                                                                                                                                                                        | B    |
| Creator 列格式化                 | 补丁内置列                         | 改为独立 **Authors 列**（better-authors 逻辑重做，§4.3），原生列不动                                                                                                                                                                                                                         | D    |
| Publication 列后备字段           | 补丁内置列                         | 改为独立 **Venue 列**（第一个非空 `publicationTitle/proceedingsTitle/university/publisher/…`）                                                                                                                                                                                               | C    |
| 快速笔记 / 简记                  | 3.3 二进制                         | **Remark 列**：Extra `Remark: <一行>`，列内双击编辑 + 信息面板可编辑                                                                                                                                                                                                                         | D    |
| 嵌套标签（树、筛选、右键）       | DOM 覆盖 + getSearchObject 替换    | 自绘树挂在 `#zotero-tag-selector-container` 内与 React 根**并列**（切换按钮）；筛选 = 前缀展开为**精确标签名集合** → `itemsView.setFilter('tags', Set)`（不改原生语义、不打补丁）；右键：重命名/删除（确认）/复制/设 Zotero 颜色/设规则色与 emoji/合并；Notifier `tag/item-tag/setting` 刷新 | C    |
| 标签颜色/位置管理                | Shift+P 命令                       | 嵌套树右键 + 设置页"标签规则"；Zotero 颜色 ≤9 走 `setColor`（修正差一），超出的走 Zest 本地规则（§3）                                                                                                                                                                                        | C    |
| Graph View                       | Obsidian iframe                    | 复用 Refs `src/graph/` d3-force SVG；宿主 = 条目列表下方可折叠面板（`#zotero-items-pane-container` 内 `<splitter>+<vbox>`，高度记 pref），4 模式（related/author/tag/collection）+ 选中同步 + 右键定位；修 90 分位 hub bug 与 id 冲突；当前范围用复数 `getSelectedCollections()`（Z10）      | C    |
| PDF 阅读热力图（每页时长）       | 高能进度条（Shift+P）              | Reading 列 + 信息面板内的**每页热力条**（点击跳页 `Zotero.Reader.open(itemID,{pageIndex})`）                                                                                                                                                                                                 | B/C  |
| 按类型快速筛选                   | 补丁 `getItems`                    | 保留交互（点标题格类型图标切换）+ 工具栏筛选 chip（可见、可清除）；实现 = 特性检测的 `CollectionTreeRow.prototype.getItems` 过滤管线（9.0.6 仍在），失败降级为临时 `Zotero.Search`                                                                                                           | C    |
| 视图组                           | pref JSON + 私有列 API             | 保留：存 `zest-config.json`（D4）；应用 = 特性检测 `itemsView.tree._columns` + `_storePrefs`（7.0.0/8/9 未变）→ `refreshColumns()`；UI = 列选择器菜单子项 + 工具栏圆点；"添加视图"同时抓宽度/顺序/排序（原版不抓）                                                                           | C    |
| PDF 注释/背景样式                | 脚本劫持 map / 3.x 二进制          | **背景**：8+ 官方 `readerCustomThemes`（预设 护眼绿/羊皮纸/暗灰 + 自定义，一键写入并选中）；7.0.x 隐藏该项。**标注配色方案**：`createColorContextMenu` 事件添加"配色方案"子菜单 + `reader.setTool({color})`（不改 Zotero 内置调色板名称——那需要劫持，放弃）                                  | C    |
| 阅读时长/进度                    | 10 s 定时器                        | §4.1 会话追踪器                                                                                                                                                                                                                                                                              | B    |
| 文献信息面板                     | 3.2/Pro                            | ItemPane section "Zest"（§2.2 P3）                                                                                                                                                                                                                                                           | D    |
| easyScholar 数据源               | 密钥 pref 明文                     | 密钥 → `Services.logins`（回退 prefs 并提示）；`logBodyLength:0`；业务码处理 + 退避 + 负缓存                                                                                                                                                                                                 | C    |
| 配置导入/导出                    | 3.3.6 二进制                       | JSON（prefs 快照 + 视图组 + 标签规则 + 数据集），版本号 + 双向 sanitize                                                                                                                                                                                                                      | C    |
| 分类计数                         | 补丁 renderItem                    | 保留为可选（默认开），特性检测 `collectionsView.renderItem`（9.0.6 在）；失败静默                                                                                                                                                                                                            | C    |
| Alt+, / Alt+. 切视图             | 命令                               | 保留快捷键（可配置）                                                                                                                                                                                                                                                                         | C    |

### 2.2 Pro 功能（清洁室独立实现，只依据公开描述）

| #     | 功能                          | Zest 设计                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 阶段 |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| P1    | **垂直标签页 / Tab Manager**  | 左侧（可换右侧）侧栏：列表按 `_tabs` 顺序，行显示类型图标/标题/作者·年/阅读进度小条；**拖拽排序**（→ `move`）；**分组**（本地模型 keyed `(libraryID,itemKey)`，折叠/重命名/配色；组内"关闭全部/其它"）；**搜索**框；**会话**：保存当前标签集、一键恢复（`add({type:'reader-unloaded'})`）、最近关闭（`tab/close` 前抢先快照）；右键菜单（关闭/关闭其它/关闭右侧/移入组/固定/在文库显示）；`Cmd/Ctrl+Shift+E` 显隐；原生横条可选 CSS 隐藏；双向同步 = Notifier + MutationObserver + 从 `_tabs` 全量 reconcile（去抖）。 | D    |
| P2    | **被引数列（Cited Counts）**  | 来源链 Crossref（polite mailto）→ OpenAlex（可选免费 key；读 `x-ratelimit-*` 自适应）→ Semantic Scholar（可选 key；含 influentialCitationCount）；**Google Scholar 仅 opt-in**（默认关；5–30 s 抖动、单次 CAPTCHA 窗口 + 正确的关闭检测、失败即停批）；写 Extra `Citations: N (Source) [YYYY-MM-DD]`（citation-tally 兼容），**读**旧格式（GSCC/ZSCC/eschnett/`Citations: N`/openalex.*）；列显示数字（空则空串）；更新入口 = 右键（确认 + 进度窗可取消）/ 工具菜单"更新过期"/ 可选新增自动；失败退避存本地。          | D    |
| P3    | **文献信息面板（Explore）**   | ItemPane section：标题、Authors（管线格式化）、venue + 分区/IF/被引徽章、可折叠摘要、Open in（DOI/Scholar/S2/PubMed/CNKI）、Zotero 标签+#标签、评级/状态/简记可编辑、阅读统计（总时长、上次阅读、每页热力条）、TLDR（S2 `tldr` 字段，可关）。                                                                                                                                                                                                                                                                          | D    |
| P4    | Attachment Preview / 对照阅读 | **不做**：Zotero 7 原生附件预览；跨文档对照 = 打开两个 reader 窗口即可                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —    |
| P5    | Annotation Manager + 文献矩阵 | **可选**（D 末，视余量）：按当前分类聚合标注、`&&`/`\|\|` 搜索、核心字段（tag/color 条件）→ 表格 + 导出 CSV/Markdown。⏸ 你决定是否纳入                                                                                                                                                                                                                                                                                                                                                                                 | D?   |
| P6/P7 | Note Manager / Backlinks / AI | **不做**（与 Better Notes 重叠；Backlinks 行为公开资料为空；AI 需外部 LLM）                                                                                                                                                                                                                                                                                                                                                                                                                                            | —    |
| —     | TLDR                          | 并入 P3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | D    |

### 2.3 新增功能（候选 8 → 实现 5 + 你追加的 2）

| 候选                                             | 对科研用户的价值                                                                | 决定                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ① 阅读统计面板 + GitHub 式日历热力图 + 周/年总结 | 用已采集数据回答"我这周读了多久/读了什么"，无额外成本                           | ✅ 实现（宿主：Zest 设置页旁的独立对话框/或 Zotero 库标签页 🔍） |
| ② 分区数据离线缓存 + 多来源并存                  | 无 easyScholar key 也能用（本地 JSON 数据集导入 + OpenAlex 期刊指标），断网可用 | ✅ 实现                                                          |
| ③ 阅读记录导出/导入 + 旧版一键迁移               | 数据可携带；老用户零损失                                                        | ✅ 实现（一等公民）                                              |
| ④ Zotero 彩色标签互通                            | 徽章默认用 Zotero 颜色；"提升为 Zotero 颜色/降级为本地规则"                     | ✅ 实现                                                          |
| ⑤ 阅读状态自动化                                 | 开始阅读→In Progress、进度≥阈值→Read（可关、可撤销）                            | ✅ 实现                                                          |
| ⑥ 按进度/评分/状态智能筛选                       | 快速 chip 过滤（"未读且评分≥4"）                                                | 候选（C 阶段若余量则做，用 `getItems` 过滤管线）                 |
| ⑦ 批量操作确认与可取消                           | 所有批量（更新分区/被引/迁移）走 Refs `runBatchImport` 模式                     | ✅（横切规范，不单列）                                           |
| ⑧ 自定义 CSS（Style Editor）                     | 少数高级用户                                                                    | 不做（易坏、难支持）                                             |
| 你追加：**Authors 列**                           | 见 §4.3                                                                         | ✅ 实现                                                          |
| 你追加：**被引数列**                             | 见 P2                                                                           | ✅ 实现                                                          |

### 2.4 删除 / 简化（含理由）

- **隐藏 Addon Item 笔记存储**：污染文库、同步冲突、O(N) 读取 → SQLite。
- **Shift+P 命令面板**：Zotero 无此范式、可发现性差；所有功能改为菜单/设置页/列内交互。
- **斑马纹 / 选中行 / 悬停行硬编码颜色**：违反"只用 Zotero 变量"，且虚拟表复用行使 nth-child 失效（原版靠 DOM 重排 hack）。
- **按扩展名替换附件图标**：Zotero 7 已有类型图标。
- **Obsidian/pixi 图谱引擎**：专有代码不可复用 → d3-force。
- **`Array.prototype.map` 劫持改标注配色名**：脆弱且污染 reader 全局 → 用官方 `createColorContextMenu`。
- **全局补丁**（`Item.prototype.getField`、`Search.prototype.search`、`Tags.setColor`、`getSearchObject` 整体替换）→ 官方 API + Notifier。
- **死 pref**：`enable`、`graphView.show`、`textTagsColumn.prefix`、`nestedTags.sortord`；`Zotero.AddonItem.key`（越界写别人的分支）。
- **Raphael 线图**：内联 SVG。
- 二进制版里的 全文翻译 / Favorites / Menu Visibility Manager / 年终总结彩蛋 / 侧栏折叠快捷键：与其它插件重叠或与本插件主题无关，不做（年终总结由 ① 覆盖）。

---

## 3. 数据存储方案（按 §3 分流，含 D4 修正）

| 数据                                           | 位置                                                                                      | 细节                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阅读时长 / 翻页 / 热力图原始数据               | **`<dataDir>/zest.sqlite`**（`new Zotero.DBConnection("zest")`）                          | 表 `page_time(libraryID, itemKey, pageIndex, seconds, PRIMARY KEY(libraryID,itemKey,pageIndex))`；`daily_time(libraryID, itemKey, day TEXT 'YYYY-MM-DD', seconds, PK(libraryID,itemKey,day))`；`item_meta(libraryID,itemKey,pages,lastRead,version)`；`meta(k,v)` 存 schema 版本。内存聚合 + **每 15 s 或事件边界（tab select/close、窗口失焦、shutdown）flush**，单事务 UPSERT；被杀最多丢 15 s。导出 CSV/JSON；导入按 key 合并（逐页 max，可选求和）；一次性迁移器按 progress-storage.md §8 规范（G0/G1/G2/G3、`-1` 偏移探测、回收站、多 Addon Item、孤儿报告；**不删旧数据**）。shutdown `closeDatabase()`。 |
| 评分 / 已读未读 / 手动进度 / 简记              | **Extra**（无开关，仅用户操作时写）                                                       | `Read_Status: <New\|To Read\|In Progress\|Read\|Not Reading>` + `Read_Status_Date`（Reading List 兼容；用户在 RL 里自定义的状态名按原文显示、不改写）；`Rating: 1–5`（读旧 `rate:`，有则原位更新）；`Read_Progress: 0–100`（手动进度）；`Remark: <一行>`。写入 = 逐行替换/追加，绝不用 toolkit `replaceExtraFields`。                                                                                                                                                                                                                                                                                           |
| 视图组 / 标签规则 / 分区显示偏好 / 数据集配置  | **prefs（JSON 字符串）+ `<dataDir>/zest-config.json`** ⏸                                  | SyncedSettings 白名单不允许（D4）。设置页提供"导出/导入配置"；导入前 schema 版本 + sanitize。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 期刊分区 / IF / 注释密度 / 页数 / 被引数中间态 | `<dataDir>/zest-cache.json`（Refs storage.ts 模式：版本 + 双向 sanitize + LRU）+ 内存 Map | 分区按 `publicationName` 归一化键（小写、去标点、去 "the"）缓存 + TTL；注释密度按 `libraryID/itemKey`，由 Notifier `item` 事件里的 annotation add/modify/delete → 父附件 → 父条目 触发失效（去抖重算，不依赖 9.0 的 `dependsOnChildren`）；页数缓存随 reader 打开时的 `pagesCount` 更新；被引数成功值进 Extra，失败退避进缓存。                                                                                                                                                                                                                                                                                 |
| 禁止                                           | 主库加表；隐藏条目/笔记；SyncedSettings 自定义键                                          | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 凭据（easyScholar / S2 / OpenAlex key）        | `Services.logins`（origin `chrome://zest`，realm 按服务）                                 | 读写失败回退 prefs 并在设置页红字提示"以明文存储"；HTTP 请求 `logBodyLength: 0`，URL 中的 key 不进日志（自定义 log 前脱敏）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 4. 架构

```
src/
  index.ts / addon.ts / hooks.ts        # 与 Refs 同骨架；每步 startup 独立 try/catch
  utils/  guard.ts ztoolkit.ts prefs.ts locale.ts window.ts extra.ts(Extra 行读写) names.ts(脚本判定/归一)
  core/   http.ts(限流/缓存/重试/负缓存/脱敏) storage.ts(JSON 缓存) db.ts(zest.sqlite 封装) config.ts(zest-config.json + 导入导出)
          probes.ts(特性检测：tabs/itemTree/collectionTree/reader)
  reading/ tracker.ts(会话追踪器) heat.ts(每页/日历数据→渲染模型) migrate.ts(旧版迁移) exportImport.ts
  columns/ registry.ts(统一 registerColumn 封装：dataKey 白名单、defaultIn、zoteroPersist、刷新去抖)
           reading.ts status.ts rating.ts remark.ts tags.ts textTags.ts pubTags.ts if.ts progress.ts venue.ts authors.ts citations.ts
           titleDecor.ts(可选 _renderCell 包装：底纹+加粗)
  rank/    sources/{easyscholar.ts, localDataset.ts, openalex.ts} index.ts(合并/优先级) map.ts(Map 重写语法)
  cite/    sources/{crossref,openalex,semanticscholar,googlescholar}.ts index.ts(链+退避) extraFormat.ts(读 10 种旧格式)
  tags/    rules.ts(前缀→颜色/emoji 本地规则) nestedTree.ts(自绘树) filter.ts(前缀展开→setFilter) menu.ts
  views/   viewGroups.ts quickFilter.ts collectionCounts.ts
  graph/   build.ts view.ts(复用 Refs)  graphPane.ts(列表下方面板)
  reader/  themes.ts(readerCustomThemes 预设) colorSchemes.ts(createColorContextMenu)
  tabs/    model.ts(组/会话，keyed libraryID+itemKey) sync.ts(Notifier+MutationObserver+reconcile) sidebar.ts(UI) menu.ts
  panes/   infoSection.ts(文献信息面板) statsDialog.ts(阅读统计+日历热力图)
  modules/ menus.ts(MenuManager Z8+/DOM 回退) preferenceScript.ts devEval.ts(仅 dev)
  ui/      styles.ts(单一样式表；只用 Zotero 变量) batch.ts(确认+可取消进度) icons
addon/   manifest.json bootstrap.js prefs.js preferences.xhtml locale/{en-US,zh-CN}/*.ftl content/icons/{16px,20/}
```

### 4.1 阅读会话追踪器（核心算法）

- 触发：`Zotero.uiReadyPromise` 后启动；Notifier `tab`(add/select/close/load, **priority 50**)、`file`(open/close/pageChange, 9+)、`setting`(`lastPageIndex_*`, 7+) 作为边界；每 5 s 采样一次"活动 reader"：`Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID)`（独立窗口：`_readers` 中 `!tabID` 且 `Services.focus.activeWindow === r._window`）。
- 准入：主窗口/阅读器窗口是前台（`Services.focus.activeWindow`）、`nsIUserIdleService.idleTime < 60 s`（Read Aloud 播放中豁免）、8+ 可加 `visibilityState !== 'hidden'`。
- 页码：`ir._state.primary` 决定读 primary/secondary；PDF `viewStats.pageIndex/pagesCount`；EPUB `stats.pageIndex/pagesCount`（存 EPUB 页映射页码）；快照只记总时长。
- 记账：每个 tick 把 5 s 记到 `(libraryID, parentItemKey, pageIndex)` 与 `(…, day)`；写内存；15 s / 边界 flush 到 SQLite。附件无父条目 → 记到附件自身 key。
- 边界：`tab/close` 抢先（priority<100）读到 reader 时 flush；`getByTabID` 为空时按 tabID→itemKey 映射 flush。
- 状态自动化（新增⑤）：首次记账 → 若 `Read_Status` 空/New 则写 In Progress；`已读页数/总页数 ≥ 阈值(默认 90%)` 且总时长 ≥ 5 min → Read（每条目只自动升一次，可撤销）。

### 4.2 分区/影响因子多来源

- 统一记录 `{source, field, value, rank(1–5 归一), updated}`；来源优先级可拖动：easyScholar（有 key）> 本地数据集（用户导入 CSV/JSON：`name/issn → {field: value}`，附 3 个示例模板）> OpenAlex `sources`（`summary_stats.2yr_mean_citedness/h_index`，标注为"OpenAlex 指标"，不冒充 JCR）。
- 徽章颜色：5 档 rank 色（Zotero 变量 + 固定的 5 个语义色）；Map 重写语法兼容原版（`A=B` 精确、`/re/=X` 正则、空值=隐藏）。
- 缓存键 = 归一化期刊名；TTL 默认 30 天；离线可用；批量刷新走 batch.ts。

### 4.3 Authors 列（better-authors 逻辑重做）

- 管线：`resolveRoles(item)`（按 item type 用 `Zotero.CreatorTypes.getPrimaryIDForType` 动态取主角色，回退 editor→director→contributor；thesis advisor、patent inventor 特例；**不出现 creatorTypeID 字面量**）→ `normalize`（Unicode Script 判 han/kana/hangul/latin/cyrillic；单字段=机构原样）→ `select(policy)`（`all | first{n,etAl} | first+last{n,omitted} | first | last | advisor`，APA 式阈值，"等/et al." 走 `Zotero.getString('general.etAl')`）→ `format(nameRules)`（顺序 given-family / family-given / auto；全名/首字母/无；按**相邻两名脚本**决定分隔符）→ `decorate(marks)`（末位/首位/自我姓名高亮/Extra `corresponding:` 覆盖，用 span+class 渲染，**符号不进排序键**）。
- 预设：Creator-like / First / Last / First+Last / First 3 + et al. / All / Thesis advisor；高级模板变量 `{first} {last} {first:n} {all} {etal} {omitted} {advisor} {n}`。
- 默认三列 Authors / First Author / Last Author，可增删；`zoteroPersist: ["width","hidden","sortDirection"]`；pref 变化 → 清缓存 + `refreshColumns()`（即时生效）；缓存 `Map<itemID,{display,sortKey,ver}>`；提供 better-authors 设置导入映射。

### 4.4 列层通用规范

- 每列一个 `ColumnSpec {dataKey(short,[a-z0-9_]), label, icon?, dataProvider(sync, string), render(sync)}`，`registry.ts` 统一加 `pluginID`、`defaultIn:["default"]`、`zoteroPersist`、`enabledTreeIDs:["main"]`，只注册一次；显示偏好变化不重注册。
- dataProvider 只查内存缓存（O(1)），缺数据 → 入队异步获取 → 完成后 `Notifier.trigger('refresh','item',ids)`（去抖 300 ms）；`refreshColumns()` 仅在列集合变化时用。
- renderCell 用 `doc.createElement`，`span.cell` + `.cell-text`，图标用 `.icon.icon-bg + background-image`（context-fill SVG）；所有交互事件委托绑定于 renderCell 返回元素（注意行复用，用 `data-*` 存 itemID）。
- 数值列 dataProvider 零填充；数据缺失返回 `""`（不返回 `-1`/`0`）。
- 全部回调 `guard()`；抛错返回 `""` / 空 span，绝不抛到 itemTree。

---

## 5. UI / 设计规范（遵守 §5，摘录落地点）

- 单一样式表 `ui/styles.ts`：只用 `--fill-*/--color-*/--material-*/--zotero-font-size`；按钮只写 `background-color`；次要文字 `calc(var(--zotero-font-size)*.923)`；内容内缩 12 px。
- 图标：`addon/content/icons/*.svg`（16 px 表头/列内）与 `icons/20/`（侧栏），`context-fill/context-stroke`，像素网格；无 dark 双份。
- 明暗核对：dev 实例 `Services.prefs.setIntPref("ui.systemUsesDarkTheme",1)` + `canvas.drawWindow` 截图；被遮挡窗口等 transition 完成。
- 每个控件 tooltip（FTL 属性形式）；破坏性操作 confirm + 可取消进度窗；悬停不移动指针下方 DOM。
- 列内绘制：CSS 渐变（阅读热力）/内联 SVG（星级、直方图）。

---

## 6. 风险与对策

| 风险                                                                                                     | 等级   | 对策                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 垂直标签页依赖 `Zotero_Tabs` 私有对象；官方计划做 tab groups（可能改 `_tabs`/DOM）                       | 高     | `probeTabsAPI()` 五项探针，缺一即禁用整块；只调 5 个方法、只读 `_tabs`；不用自定义 tab type；组模型 keyed itemKey，原生分组落地时可导出/让位；不 patch `_update` |
| Title 底纹/加粗依赖 `_renderCell` 包装                                                                   | 中     | 每窗口包/还原；探针（函数存在 + 参数个数）；失败 → 只用 Reading/Status 列                                                                                        |
| Google Scholar 抓取封 IP/CAPTCHA                                                                         | 中     | 默认关；抖动、单窗口 CAPTCHA、失败停批、README 明示风险                                                                                                          |
| easyScholar 免费额度/40006 限流                                                                          | 中     | 串行 + 退避 + 负缓存 + 离线数据集回退                                                                                                                            |
| OpenAlex 匿名 100 次/天                                                                                  | 低     | 可选免费 key；读速率头自适应；只在需要时请求                                                                                                                     |
| `refreshColumns()`/重注册引发列宽 bug（Z7.0.23+）                                                        | 中     | 只注册一次；刷新走 Notifier `refresh`                                                                                                                            |
| SQLite 独占锁与热重载                                                                                    | 低     | shutdown `closeDatabase()`；启动前若已开则复用                                                                                                                   |
| Zotero 10（beta）：多选 header 行进 dataProvider、单数选择 API 抛错、WAL、`_getColumns` 按 viewType 缓存 | 中     | `instanceof Zotero.Item` 防御；复数 API 优先 + 特性检测；全部私有调用有守卫与降级；`strict_max 10.*`；AGENTS.md 留升级清单；交付说明「10 beta 未真机验证」       |
| reader tab 的 `add` 事件标题为空、`move/rename` 无事件                                                   | 低     | 侧栏以 `_tabs` 全量 reconcile + MutationObserver 兜底；标题在 `load`/DOM 变化后重取                                                                              |
| SyncedSettings 误用导致同步失败                                                                          | 已规避 | 只写白名单内 `readerCustomThemes`/`tagColors`                                                                                                                    |
| 与 Ethereal Style / Reading List / tab-enhance 同装                                                      | 低     | 不同 addon ID/prefs；不读写它们的数据；列 dataKey 独立                                                                                                           |

---

## 7. 里程碑与验收

**B · 核心（列 + 阅读记录 + 存储层）**

- 工程骨架（复用 Refs：scaffold/toolkit 5.2/typings/.env/devEval/guard/http/storage/styles）；名字 Zest；`npm run build` 通过。
- `db.ts`（zest.sqlite + schema v1 + flush 策略）、`tracker.ts`、`migrate.ts`（含报告）、`exportImport.ts`。
- 列：Reading、Status、Rating、Tags、#Tags（含规则色/emoji）+ 可选 Title 底纹/加粗；`registry.ts` 刷新机制。
- 设置页骨架（Fluent、groupbox 分节）。
- 验收探针（dev 实例）：打开 PDF 翻页 30 s → `page_time` 有行、Reading 列出现渐变、Status 自动 In Progress；杀进程 ≤15 s 内数据不丢；迁移器对造的 Addon Item 笔记（G2 + `-1` 偏移样本）解析正确；列排序正确；`Zotero.getErrors(true)` 无插件错误；明暗截图。

**C · 标签体系 + 视图组 + 分区 + 图谱 + 热力图**

- 嵌套标签树 + 筛选 + 右键；标签规则/颜色互通；视图组；分区多来源 + Publication Tags/IF/Venue/Progress 列；图谱面板；快速类型筛选；分类计数；PDF 主题预设 + 标注配色方案；配置导入导出。
- 验收：前缀筛选与原生 tag is 一致；视图切换保留宽度/顺序；无 key 时本地数据集/OpenAlex 徽章可显示；图谱 200 节点流畅；8+ 主题写入 `readerCustomThemes` 并生效。

**D · Pro 清洁室 + 新增**

- 垂直标签页/Tab Manager；Cited Counts 列 + 批量更新；Authors 列；Remark 列；文献信息面板（含 TLDR）；阅读统计面板 + 日历热力图；（可选）标注矩阵。
- 验收：Zotero 原生开/关/切/拖标签 ↔ 侧栏一致；重启后组/会话恢复；被引批量 20 条可取消；作者列 CJK/机构/编者/学位论文样例正确；面板明暗截图。

**E · 审查**：多智能体 安全→功能→性能→UI 四维审查，重大发现逐条对抗验证 → 修复 → 回归清单。

**F · 交付**：`npm run build` → `~/Downloads/zest.xpi`；GitHub `yimmy23/zotero-zest` + Release 附 xpi + MD5 回校；README（中英：安装、需要填哪些密钥（全部可选）、每项功能用法、数据存哪/导入导出、协议与来源声明、清洁室声明）；AGENTS.md（架构 + 不变量 + 测试清单）；`session-notes.md` 存档 + .gitignore。

---

## 8. 需 dev 实例真机探针的未决点（进入 B 后逐一打勾）

1. `_renderCell` 包装在 9.0.6 的实际效果（primary 单元格结构、注解行是否误触）。
2. `CollectionTreeRow.prototype.getItems` 过滤管线在 9.0.6 的表现（类型筛选/智能筛选）。
3. 嵌套树与 React 标签选择器并列挂载：`createRoot`/uninit 与注入兄弟节点的交互；`#zotero-tag-selector-container` 折叠时 `ZoteroPane.tagSelector` 为 null 的处理。
4. `readerCustomThemes` 写入后 reader 是否即时切换（`setting` 通知链）。
5. `Zotero_Tabs.add({type:'reader-unloaded'})` 恢复会话在 7.0.x/8/9 的表现；`#tab-bar-container > div{display:none}` 在 macOS 全屏/非全屏的标题行高度。
6. `naturalSorting` 默认 true 下零填充是否仍需要（保守：都零填充）。
7. `Services.logins.addLoginAsync` 在 7.0.x 的可用性（api 报告称 Fx115 有 `searchLoginsAsync`，未实跑）。
8. easyScholar 免费 key 实际额度/字段集（需要一个真实 key；README 只写"可选"）。
9. 带真实 `pluginID` 的 dataKey（含 `\@ \.`）经 `refreshColumns()` 后列宽是否失灵（reading-list #27）；必要时 dataKey 走 `pluginID: ""` + 自命名空间（🔍 B 阶段第一件事）。
10. 9.0.x `typeof window.title`（决定 `tab.audioStatus` 是否可用）。
11. Zotero 10 beta 本机不可测：若你能提供一台装 10 beta 的隔离 profile，E 阶段补测多选 header 行与视图组；否则按官方清单写兼容代码并在 README 注明。
