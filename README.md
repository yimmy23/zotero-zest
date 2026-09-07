# Zest — 把「阅读」放进 Zotero 的条目列表

> Zotero 10 插件 · v1.1.2 · [English below](#zest--reading-in-your-zotero-item-list)

Zest 记录你**读了多久、真的看过哪些页**，把阅读状态、评级、期刊分区、被引数、标注分布直接摆在条目列表里，
并配上图谱、阅读统计和标注矩阵三个视图。

<img width="4098" height="2464" alt="2026-08-21 精读 Must-Read - Zotero 001173" src="https://github.com/user-attachments/assets/e0f74c95-d707-4da9-9e75-b18559bbd1ce" />

---

## 安装

1. 从 [最新 Release](https://github.com/yimmy23/zotero-zest/releases/latest) 下载 `zest.xpi`。
2. Zotero →**工具 ▸ 插件**→ 右上角齿轮 →Install Plugin From File…→ 选中该 `.xpi`。
3. 按提示重启 Zotero。

## 1.1.2 更新

- 修复摘要译文直接显示 `**目的**` 等 Markdown 标记的问题，支持常见标题、加粗、行内代码和单层列表。
- 保留统计脚注、比较符号、原始列表编号与转义字符，避免格式识别改变原文含义。
- 改进明暗主题和窄栏中的摘要排版；仍然点击才翻译，可随时切回原文，不覆盖文献字段。

升级后请重启 Zotero。翻译引擎配置不变，无需重新配置。

## 1.1.1 更新

- 改进大文库图谱布局、标签避让与视图适配，缩放、拖动和调整面板后保持阅读位置。
- 摘要支持按 DOI / PMID 获取补全，保留结构段落；只显示一个摘要，点击「翻译」才显示中文，可随时切回原文。
- 关键作者默认可见，其余折叠；优先明确第一／通讯标记，缺少标记时显示条目首位和末位。
- 机构标注第一作者、通讯作者或末位作者归属，共同机构保留双标签；优化书目信息、窄栏和明暗主题布局。
- 修复简记草稿与选区丢失、保存失败重试及异步信息补全时的过期结果问题。

升级后请重启 Zotero。摘要获取和翻译不会覆盖已有文献字段；翻译按需联网，阅读时长仍保存在本机。

## 1.1.0 更新

- 设置页、信息面板和文献关联图更紧凑，改进换行、明暗主题和键盘操作；保留现有图标。
- 阅读数据写入、导入和关闭时保存更可靠，跨设备导入会按稳定文库身份匹配，并报告未匹配记录。
- 期刊缓存优先按 ISSN 区分，改进联网请求的限流退避、取消和错误重试。
- 机构信息改为手动获取，自动获取需主动开启；优化标注刷新、窗口独立状态和插件升级后的界面恢复。

升级后请重启 Zotero。阅读时长仍保存在本机；跨设备转移使用阅读数据导出/导入，不会自动随 Zotero 同步。

## 第一步：套用推荐布局

装好后，条目工具栏上会出现一个 **Z** 按钮（线条风格，和 Zotero 自带图标同一套），点它 →**套用 Zest
推荐列布局**。

这一步会把标题、简记、年份、作者、阅读、状态、评级、期刊、期刊标签、影响因子、被引数、添加日期、附件排成一行，并按添加日期倒序。
不喜欢可以立刻还原：**工具 ▸ Zest ▸ 撤销上一次布局切换**。你也可以自己右键列标题勾选想要的列——Zest 的列
和 Zotero 原生列一样，可以随意拖动、调宽、排序。

> Zest 的列默认大多是关的（每一列都要按行算东西）。**第一次**套用推荐布局时，它会把自己需要的那几列
> 一并打开；此后再套用就只排布局，不再动你的开关——你在**设置 ▸ Zest** 里关掉的列不会被翻回来。

## Z 按钮里有什么

| 菜单项                   | 作用                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **图谱面板**             | 条目列表下方的关系图：相关条目 / 共同作者 / 共同标签 / 共同分类，可切换模式。作者模式做同名消歧：同姓下按全名聚类（Wang Lei ≠ Wang Li），有 OpenAlex 缓存时按作者 ID 合并拼写变体，悬停节点显示所属机构 |
| **阅读统计…**            | 独立窗口：GitHub 式年度日历、累计时长、连续天数、读得最多的条目                                                                                                                                         |
| **标注矩阵…**            | 当前视图的全部标注汇成一张可搜索的表，可导出 CSV / Markdown                                                                                                                                             |
| **套用 Zest 推荐列布局** | 一键排好上面那套列                                                                                                                                                                                      |
| **联网获取期刊数据**     | 分区 / 影响因子的联网开关（默认关）——不开这一项，期刊标签列会是空的                                                                                                                                     |
| **Zest 设置…**           | 打开设置页                                                                                                                                                                                              |

## 各个列怎么用

**阅读**——阅读总时长，底下是每页热力条（4 级台阶，颜色越深看得越久）。计时只在阅读器窗口处于活动状态时
走，无输入 120 秒自动停表，朗读时不停。

**状态**——不用你动手也有答案：没设置过状态的条目，Zest 按阅读记录自动判定——有 PDF 但从没打开过是
**未读**，读过（本机记录 ≥ 30 秒，或 Zotero 自己记下的「最近阅读」/ 阅读位置，在别的设备上翻过也算）是
**在读**，页数与时长都达标（默认 90% 页 + 5 分钟）是**已读**。自动判定画成**空心圈**、灰字，手动设置的
是**实心点**；手动永远优先。要改：点圆点弹出菜单，直接选（选中多行时对整批生效）；也可以在条目右键
▸ Zest ▸ 阅读状态、或右侧 Zest 面板的状态按钮里改（阅读器标签页右侧的上下文面板里也有这一栏）。
手动值写在条目 `Extra` 的 `Read_Status` 行，与 Reading List 插件同键；「设置 ▸ 阅读记录」里还可以让达标
时顺手把在读 / 已读写进 Extra（同步到其它设备）。

**评级**——点第几颗星就是几分；再点当前最高那颗降一分，点第一颗清零。存 `Extra`。符号和颜色可改
（设置里能换成 ♥ 或任意字符）。

**标签 / #标签**——`#标签` 列把符合规则的标签显示成文字徽章。规则语法：`#` 表示以 # 开头的标签、
`~~X` 表示**不**以 X 开头、`/正则/` 用正则（有捕获组就只显示捕获的部分）。「标签」列把彩色与 emoji 标签
单独成列、可排序——Zotero 本身已在标题里画这些色点，所以这一列默认关，配合「隐藏标题列里的标签色点」用。

**作者 / 第一作者 / 末位作者**——Zotero 自带的「创建者」列只显示「第一作者 et al.」，这三列是它的扩展：
显示方式（全部 / 前 N 位 + et al. / 前 N 位 … 末位 / 仅第一 / 仅末位 / 导师）、显示几位、姓名顺序（自动按
文字系统 / 名前 / 姓前）、名的写法（全名 / 首字母 / 不显示）、**分隔符**（留空 = 王小明、李雷 / Ada Lovelace,
Alan Turing 自动）、**「等」文案**（留空 = Zotero 自身语言）、省略标记、末位作者标记（标记不进排序键）都可以
自己定；把自己的名字填进「我的名字」，你自己的署名会被高亮。装过 better-authors 的，工具 ▸ Zest ▸ 导入其设置。

**期刊标签 / 影响因子 / 期刊**——分区徽章与影响因子；「期刊」列把期刊名 / 会议名 / 书名 / 出版者按条目
类型合成一列（Zotero 自带的「出版物」列只有期刊名，混合文库要开三列）。影响因子默认画成数字底下一层**热力色块**：IF 越高颜色
越深，分四档（刻度上限的 1/15、1/5、1/2、上限，上限默认 15，设置里可改；也可以换回进度条或只显示数字）。
数据来源依次是：你导入的本地数据集 → easyScholar（填了密钥才用）→ OpenAlex（免密钥）。**默认不联网**，
所以刚装好时这两列是空的：从 **Z 按钮 ▸ 联网获取期刊数据**（等同于设置里的「自动获取」）打开，或右键条目
▸ Zest ▸ 更新期刊分区。空单元格的悬停提示会告诉你是哪种情况。查询按期刊（不是按条目）进行，只发送期刊名、
ISSN 或 DOI，结果按期刊缓存 30 天。中科院分区、北大核心等中文体系只有 easyScholar 有，需要在设置里填密钥。
中文界面使用默认字段时按 **中科院升级版大类（`sciUp`）→ JCR 分区（`sci`）→ 影响因子（`sciif`）** 显示；
英文界面仍按 **JCR → CAS → IF** 显示，中科院标签会写成 `CAS Z1 · Med.` 等英文短名，悬停可看完整英文说明。
旧版默认值也会自动显示为新顺序；你手动设置过的其他 Fields 顺序始终优先。easyScholar 还提供 `ssci`、`sciif5`、
`jci`、`esi`、`sciBase`、`sciUpSmall`、`sciUpTop`、`sciwarn` 以及 `xr` / `xrSmall` / `xrTop` / `xrWarn` 等字段；
中科院文献情报中心[已声明自 2026 年起不再更新和发布期刊分区表](https://las.cas.cn/news/tzgg/202603/t20260327_8178738.html)，因此 `sciUp` 应视为历史口径。
`xr*` 是 2026 年启动的独立“新锐学术”体系，不是新版中科院分区，不会自动替换 `sciUp`。
若 Zotero 出版物标题末尾带有 `: Official Journal/Publication/Organ of …` 机构说明，查询时会自动使用冒号前的主刊名，界面仍保留原始题名。
期刊身份和缓存优先使用 ISSN，缺少 ISSN 时才使用规范化刊名；刊名中有区分意义的括号内容会保留，
例如 `Medicine (Baltimore)` 不会被合并为 `Medicine`。

**被引数**——右键条目 ▸ Zest ▸ 更新被引数（可批量、可随时取消）。数值写进 `Extra` 的
`Citations: 12 (Crossref) [2026-08-18]`，来源依次 Crossref → OpenAlex →（可选）Semantic Scholar。
别的插件写的 `GSCC:`、`ZSCC:`、`openalex.cit_count:` 会被读取但**绝不删除**。

**标注**——这条文献你划了多少：稀疏柱状图显示标注在全文中的分布，或按高亮颜色分段。

**简记**——一行备注，双击单元格就能改，存在 `Extra`。

## 条目面板里的两栏

**Zest**——为了一眼了解这篇文献：**标题**（有译文时译文在上、原文在下）、紧随标题的期刊与分区徽章、**可展开的完整作者列表**（按作者列
的姓名规则，自己的名字高亮）、逐条列出的核心机构、被引数
（带刷新按钮）、阅读时长 + **可点击的每页热力条**（点哪一段就跳到那一页）、状态 / 评级 / 简记直接编辑、
一排外部链接（DOI、PubMed——有 PMID 直达，没有就按标题搜、arXiv、Google Scholar、Semantic Scholar、
OpenAlex、Connected Papers）。文献信息、**摘要**和阅读工作区分组展示；长摘要可点「阅读完整摘要」，保留结构标题、段落和统计符号。
摘要缺失或只有简介时，可手动点「查找完整摘要」，按 DOI / PMID 精确查询 Europe PMC、PubMed，符合身份校验条件时再尝试 Crossref。
摘要始终只有一个主体，优先显示已补全的来源摘要。点击「翻译」才翻译为中文并切换显示，点击「原文」即可返回；不会默认展示译文或多个重复摘要区。
翻译优先复用 Translate for Zotero 已配置的引擎；未安装时使用内置 Microsoft 网页翻译接口，不需要另填密钥。内置接口可用性取决于服务；已配置引擎失败时不会自动换服务。
更换引擎请在 Translate for Zotero 的「设置 → 翻译 → 服务」中选择；Zest 当前跟随其默认引擎，没有独立的引擎选择项。摘要支持常见 Markdown 标题、加粗与单层列表，保留统计符号和脚注；不会执行返回的 HTML 或加载其中的图片。
相同文本的翻译在本次运行中短暂缓存，切换文献后仍需点击才显示。摘要、Extra 中已有译文及语言字段不会被改写；标题仍可显示 `titleTranslation`。
Zotero 在阅读器右侧的上下文面板里也会显示这一栏。
作者优先展示来源明确标记的第一作者和通讯作者；第一作者无明确标记时取条目作者列表首位，无明确通讯作者时显示末位，分别用「一作」「通讯」「末位」区分。其余作者折叠，单作者不重复展示。
机构按这些作者在该文献中的归属去重，并标注「第一作者」「通讯作者」或「末位作者」；共同机构保留双重标签。默认最多三家并兼顾第一与通讯／末位机构，其余可展开；缺少可靠归属时仅显示两家不同机构，不添加作者归属标签。
同一条目的刷新会保留展开状态、正在编辑的简记及光标位置。简记或评级保存失败时会显示提示；简记草稿保留，便于重试。

作者机构信息优先读取 OpenAlex 缓存。缺少信息或旧缓存未含通讯身份时，可点击面板里的「获取机构信息」或「补全作者信息」，将当前条目的 DOI
发送到 OpenAlex，无需密钥。**自动查询默认关闭**；可在设置 ▸ Zest ▸ 条目面板中开启，只有在当前可见面板中
停留片刻才会查询。切换条目或隐藏面板会取消尚未执行的查询。

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

- **阅读数据导入导出**：设置 ▸ Zest ▸ 阅读数据 → JSON / CSV。新的 JSON v2 和 CSV 都带文库身份：
  个人文库按 Zotero 账号、群组文库按群组 ID 匹配，不依赖每台机器上的本地文库编号。换机器时先同步相同
  账号和群组的文献，再导入阅读数据；未登录账号的本地库备份只在原配置环境中恢复。旧文件没有文库身份时，
  仅在条目 key 在现有文库中唯一匹配时导入；找不到或存在歧义的记录会跳过，并在完成提示中显示数量。
  **阅读时长仍不随 Zotero 自动同步**，跨设备搬运需要手动导出、导入。
- **整套配置导入导出**：设置 ▸ Zest ▸ 配置 → 一个 JSON 文件（**刻意不含任何密钥**）。
- **所有密钥都是可选的**：不填 easyScholar 也有 OpenAlex 的期刊指标，被引数用 Crossref 就够。只有你主动
  触发（或打开自动获取）时才会联网。

## 其他

- **垂直标签页**（默认关）：把 Zotero 的标签页竖着排在侧边，支持分组（跨重启保留）、保存会话、搜索、拖拽
  排序。若 Zotero 改动了标签页内部实现，这块会自动停用而不是崩掉。
- **阅读器**：Zest 不往阅读器里加东西；背景主题与高亮颜色请用 Zotero 自带的「外观」菜单和颜色下拉。
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

zest.readStatus(item); // "In Progress"  状态列显示的那个值（手动或自动判定）
zest.readStatusSource(item); // "manual" | "auto" | "none"
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
npm run test:unit  # 执行真实源码的隔离行为测试
npm run lint:check
npm run build      # 生成 .scaffold/build/zest.xpi，并检查 TypeScript
npm start          # 启动隔离的开发 profile 并加载插件
```

`test:unit` 使用替代的 Zotero 宿主、存储和网络接口，检查错误重试、导入匹配、请求取消及多实例生命周期等
行为；不会启动 Zotero，也不能替代实际界面验证。开发实例运行后，还需通过 `scripts/dev-eval.sh -f`
依次运行 `scripts/phase-c-probe.js`、`phase-d-probe.js`、`phase-e-probe.js` 和 `phase-f-probe.js`，
验证真实 Zotero API 与插件行为。界面改动还需检查明暗主题；开发验证只使用 `.scaffold/dev-profile`。

---

# Zest — reading, in your Zotero item list

Zest records **how long you read something and which pages you actually looked at**, and puts read
status, rating, journal rank, citation counts and annotation spread straight into the item list —
with a graph, a reading-statistics window and an annotation matrix on top.

## Install

Download `zest.xpi` from the [latest release](https://github.com/yimmy23/zotero-zest/releases/latest),
then Zotero → **Tools ▸ Plugins** → gear icon → **Install Plugin From File…** → restart when prompted.

## What's new in 1.1.2

- Render common Markdown headings, bold text, inline code, and single-level lists in abstracts instead of showing raw markers such as `**Purpose**`.
- Preserve statistical footnotes, comparison symbols, original list numbering, and escaped characters without changing the meaning of the text.
- Improve abstract readability in narrow panels and both themes. Translation remains click-only, with one abstract body and no changes to stored item fields.

Restart Zotero after updating. Existing translation-engine settings are unchanged.

## What's new in 1.1.1

- Improve large-library graph layouts, label collision avoidance, and fit-to-view behavior while preserving the view during zooming, dragging, and resizing.
- Retrieve complete abstracts by DOI / PMID and preserve structured paragraphs. Click **Translate** to show Chinese in the same abstract body, or **Original** to switch back.
- Keep first and explicitly marked corresponding authors visible; without metadata, show the first and last creators and collapse the rest.
- Label institutions by first, corresponding, or last author, keeping both labels for shared institutions; refine bibliography layout and narrow/light/dark views.
- Preserve remark drafts and text selection, and improve failed-save retries and cancellation of stale metadata requests.

Restart Zotero after updating. Abstract retrieval and translation do not overwrite existing item fields; reading time remains local to each device.

## What's new in 1.1.0

- More compact settings, item panels and relationship graphs, with improved wrapping, light/dark themes and keyboard navigation. Existing icons are unchanged.
- More reliable reading-data writes, imports and shutdown saves. Cross-device imports match stable library identities and report unmatched records.
- ISSN-first journal caches and better rate-limit backoff, cancellation and retry handling.
- Manual affiliation lookup by default, with automatic lookup available as an opt-in; fewer unnecessary annotation refreshes and better per-window state and upgrade recovery.

Restart Zotero after upgrading. Reading time remains local; use reading-data export/import to transfer it between devices. It does not automatically sync through Zotero.

## Start here

A **Z** button appears in the item toolbar, drawn in Zotero's own line-icon style. Click it →
**Apply the Zest column layout**: title, remark, year, authors, reading, status, rating, journal,
journal tags, IF, citations, date added and attachments, sorted by date added (newest first). Don't
like it? **Tools ▸ Zest ▸ Undo layout change**.
Most Zest columns ship off, so the **first** apply also turns on the ones the layout needs. Every
apply after that only arranges columns — a column you switch off in **Settings ▸ Zest** stays off.

The same button opens the **graph**, the **reading statistics** window, the **annotation matrix** and
the settings. The graph's author mode disambiguates names: same-surname authors cluster by full
given name (Wang Lei ≠ Wang Li, an ambiguous "Wang L." stays its own node), cached OpenAlex author
IDs merge spelling variants, and hovering a node shows the institution when known.

## The columns

- **Reading** — total time plus a per-page heat strip (4 steps). The clock only runs while the reader
  window is active, stops after 120 s without input, and keeps running during Read Aloud.
- **Status** — answered without your help: an item with no status set is read off the reading
  record — a PDF nobody has opened is **New**, one you have read (≥ 30 s here, or Zotero's own
  last-read stamp / resume position, so a page turned on another device counts) is **In Progress**,
  and enough pages plus minutes (90 % + 5 min by default) is **Read**. Automatic statuses are drawn as
  a **ring** with a grey label, set ones as a **filled dot**; a set status always wins. To set one:
  click the dot and pick from the menu (applies to the whole selection when the row is part of it),
  or use the item context menu ▸ Zest ▸ Read Status or the status button in the Zest pane (which
  Zotero also shows in a reader tab's context pane). Set values go to `Extra` as
  `Read_Status`, the key Reading List uses; Settings ▸ Reading Tracker can also write In Progress /
  Read into Extra when the thresholds are crossed (so they sync).
- **Rating** — click star _k_ to rate; click the current top star to lower it. Stored in `Extra`;
  symbol and colour are configurable.
- **Tags / #Tags** — rule-matched tags as text badges (`#` prefix, `~~X` = everything NOT starting
  with X, `/regex/` with optional capture group). The Tags column puts the coloured and emoji tags in
  a sortable column of their own; Zotero already paints those swatches in the Title cell, so it ships
  off and pairs with "Hide tag swatches in the Title column".
- **Authors / First author / Last author** — Zotero's own Creator column shows "First et al." and
  nothing else; these three extend it: preset (all / first N + et al. / first N … last / first only
  / last only / advisor), how many, name order (per script / given first / family first), given
  names (full / initials / hidden), **separator** (empty = 王小明、李雷 / Ada Lovelace, Alan Turing
  by script), **"et al." text** (empty = Zotero's own), gap marker, last-author mark that never
  enters the sort key, and your own name highlighted. better-authors users: Tools ▸ Zest ▸ import
  its settings.
- **Publication Tags / IF / Venue** — rank badges and impact factor from your own dataset → easyScholar
  (only with a key) → OpenAlex (no key). The IF sits on a **heat wash**: darker for higher, four
  steps on a log-ish ladder (1/15, 1/5, 1/2 and the top of the scale, 15 by default — or switch to a
  bar / plain number in Settings). Offline by default, so both columns start empty:
  switch lookups on from **Z button ▸ Look journal data up online** (the same pref as auto-fetch in
  Settings), or use the item context menu. Hovering an empty cell tells you which case you are in.
  Lookups are per journal, send only the name, ISSN or DOI, and are cached for 30 days. The Chinese
  ranking systems exist only in easyScholar and need a key. With the shipped fields, a Chinese UI
  shows **CAS → JCR → IF**, while an English UI shows **JCR → CAS → IF** and renders CAS
  labels as compact English badges such as `CAS Z1 · Med.`, with the full wording on hover. Legacy
  shipped defaults are normalized to the same locale-aware order; any other Fields order you set
  yourself always wins. easyScholar also exposes `ssci`, `sciif5`, `jci`, `esi`, `sciBase`, the
  remaining `sciUp*` fields, and the independent 2026 XinRui `xr*` family. The CAS National Science
  Library [stopped updating and publishing its ranking in 2026](https://las.cas.cn/news/tzgg/202603/t20260327_8178738.html),
  so `sciUp` is now a historical scheme. XinRui is not a successor CAS ranking and is never
  substituted for `sciUp`. When a Zotero publication title ends in an institutional descriptor such
  as `: Official Journal/Publication/Organ of …`, lookups use the main title before the colon while
  the original title remains unchanged in the UI. Journal identity and caching prefer the ISSN,
  falling back to a normalized title only when no ISSN is available. Meaningful parenthetical
  text is preserved: `Medicine (Baltimore)` is not merged with `Medicine`.
  **Venue** merges publication title, proceedings,
  book title and publisher into one column by item type — Zotero's own Publication column is journal
  titles only.
- **Citations** — right-click ▸ Zest ▸ update (batchable, cancellable). Written to `Extra` as
  `Citations: 12 (Crossref) [2026-08-18]`, sourced Crossref → OpenAlex → optional Semantic Scholar.
  Other plugins' records (`GSCC:`, `ZSCC:`, `openalex.cit_count:`) are read but never deleted.
- **Annotations** — where your highlights sit in the document, or one bar split by highlight colour.
- **Remark** — a one-line note, double-click to edit, stored in `Extra`.

## Item pane

**Zest** — the paper at a glance: the **title** (translation above the original when there is one),
**an expandable, complete author list** (the Authors column's name rules, your own name highlighted,
and explicit role labels), venue and rank badges, citations with a
refresh button, reading time and a **clickable** per-page heat strip (click a segment, land on that
page), status / rating / remark inline, one row of links out (DOI, PubMed — by PMID, else a title
search —, arXiv, Google Scholar, Semantic Scholar, OpenAlex, Connected Papers).
Bibliography, **abstract**, and reading controls have separate groups. Long abstracts expand with
**Read full abstract**, preserving section headings, paragraphs, and statistical notation.
For a missing abstract or a short blurb, manually choose **Find full abstract** to query Europe PMC,
PubMed, then Crossref when identifier checks permit, using exact DOI / PMID matches.
There is one abstract body, preferring the retrieved source text. Click **Translate** to display Chinese
in the same body and **Original** to switch back. Translation uses a configured Translate for Zotero
engine, or the built-in Microsoft web translation service when the plugin is absent; a configured
engine's failure does not silently switch services.
To change engines, use Translate for Zotero's **Settings → Translate → Service**; Zest follows its
default and does not currently expose a separate engine selector. Abstracts support common Markdown
headings, bold text, and single-level lists while preserving statistical notation and footnotes;
returned HTML is never executed and embedded images are not loaded. Translations use a short-lived
memory cache and are never displayed automatically. Stored abstract, Extra, and language fields remain unchanged;
title translations still come from `titleTranslation`. Zotero shows the same section in a reader tab's context pane.

Authors with explicit first/corresponding metadata stay visible. Without first-author metadata, the
first creator is used; without explicit correspondence, the last creator is shown as **Last**, not
confirmed **Corresponding**. Other authors collapse, and a sole author appears only once.
Institutions carry **First author**, **Corresponding author**, or **Last author** labels; a shared
institution appears once with both labels. The three-institution preview represents both ends when
known. Unmatched institutions may appear as a two-entry fallback, without attributing them to an author.

Author affiliations are read from the OpenAlex cache first. When they are missing, click
**Fetch affiliations** in the panel to send the current item's DOI to OpenAlex; no key is needed.
**Automatic lookup is off by default** and can be enabled in **Settings ▸ Zest ▸ Item pane**.
It runs only after you pause on an item in a visible panel. Changing items or hiding the panel
cancels lookups that have not yet started.

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

Reading data exports and re-imports as JSON or CSV. New JSON v2 and CSV exports carry library identity:
personal libraries match by Zotero account and group libraries by group ID, independent of each
computer's local library number. Sync the same account and group items on the destination computer
before importing reading data. Backups from a local library without a signed-in account restore only
within the original profile identity. Older files without library identity import only when the item
key matches uniquely across the current libraries; missing or ambiguous records are skipped and
reported in the completion message. **Reading time still does not sync automatically through Zotero**;
moving it between devices requires a manual export and import.

The whole configuration exports as one JSON file that deliberately contains no secrets.
**No key is required** — journal ranks work from OpenAlex or your own dataset, citations from Crossref.
Nothing is fetched unless you ask for it or enable automatic lookup.

## Also included

Vertical tab sidebar with persistent groups and saved sessions (off by default), optional collection
counts, and one accent colour driving every Zest surface (picker plus five presets in **Settings ▸
Zest ▸ Appearance**). Zest adds nothing to the reader; backgrounds and highlight colours are
Zotero 10's own (Appearance menu, colour dropdown).

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

zest.readStatus(item); // "In Progress"  what the Status column shows (set or automatic)
zest.readStatusSource(item); // "manual" | "auto" | "none"
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
npm run test:unit  # isolated behavioral tests of the actual source modules
npm run lint:check
npm run build      # .scaffold/build/zest.xpi and TypeScript checks
npm start          # isolated dev profile with the plugin loaded
```

`test:unit` substitutes Zotero host, storage and network interfaces to check failure recovery,
import matching, request cancellation and overlapping plugin lifecycles. It does not launch Zotero
or replace live UI validation. With the dev instance running, also use `scripts/dev-eval.sh -f` to run
`scripts/phase-c-probe.js`, `phase-d-probe.js`, `phase-e-probe.js` and `phase-f-probe.js` in sequence,
covering the real Zotero APIs and plugin behavior. Check visual changes in both light and dark themes;
development validation uses only `.scaffold/dev-profile`.

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
