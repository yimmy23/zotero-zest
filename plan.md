# plan.md — Zest（zotero-style 的 Zotero 9–10 从零重构）

> 阶段 A 产出。研究底稿在会话 scratchpad `research/`（19 份报告 + 5 份对抗核验 + 批评稿），本计划只保留结论与依据。所有"文件:行"引用指 Zotero 9.0.6 解包源码（`omni-app/`）或 zotero-style AGPL 源码（`zotero-style/`）。
> 图例：✅ 已定（可回退）· ⏸ 需拍板 · 🔍 需 dev 实例真机探针后再定。

## Release 1.1.1 — 图谱与文献阅读面板改进

用户请求发布当前全部已验证改动；线上最新为 1.1.0，本次递增补丁版本为 1.1.1，不覆盖旧版本。保持 Zotero 10 兼容范围、原图标和单一稳定更新渠道。

- [x] 核对主分支与远端、未提交范围及版本标签；更新版本、README 和面向用户的双语发布说明。
- [x] 运行单元/静态/构建检查，复验 1.1.1 隔离 Zotero 功能及最终 XPI 安装工作流，检查包内容与更新清单。
- [ ] 提交并推送主分支，等待对应提交 GitHub CI 成功。
- [ ] 发布 v1.1.1 安装包，再更新稳定渠道清单；匿名重新下载公开包和清单并核对版本、兼容范围与 SHA-512。

发布候选验证：245 项 Node 回归、静态检查与构建通过；Zotero 10.0.1 隔离实例 C/D/E/F 20/24/91/19 项与设置 5 项通过。明确通讯／首末回退、宽窄栏与明暗主题 6 张截图通过。最终生产 XPI 为 197980 字节，版本及 API 为 1.1.1。首次安装验收的摘要检查未通过：脚本依赖之前缓存，却未在缺少缓存时点击获取；已暂停发布，改为自包含的真实获取后复验。包内无开发接口/令牌或本机测试数据，单一稳定渠道和 Zotero 10.0–10.* 兼容范围不变。

候选 SHA-512：`e982c92745601afbc254b4758d2ee49d46368b1e944b5f5df9bdc861a9d4f3486a222f9f72c7dbfdaeade5591c4ae6d9e5ecf08e39690d55b0b54721aa226765`。现有 1.1.0 更新清单已另存于忽略的验证目录，仅正式发布新版本包后才替换渠道清单。

安装复验通过：使用哈希不变的最终候选包，在干净启动的隔离实例实际点击获取 Europe PMC 完整摘要，再点击翻译并切回原文，31 项均通过；原摘要、Extra、语言字段不变，无新增插件错误。脚本不再依赖历史来源缓存，自建条目清理后正常退出。尚未发布前未改动任何线上资产。

## 2026-09-06 — 通讯作者与机构归属标识

范围：优先让有明确来源标记的第一作者和通讯作者共同保持默认可见；按用户追加规则，缺少标记时用位次第一/最后的作者回退。末位回退与来源确认的通讯身份区分，机构增加对应归属标识，共同机构合并角色，机构未知归属不冒认。复用原图标和单摘要设计，不发布、不改日常文库。

- [x] 检查通讯身份在作者格式化/缓存与面板之间是否遗漏，核对缺失信息的安全边界。
- [x] 机构去重时合并第一/通讯角色；默认预览兼顾两类机构，共同机构只显示一次且保留双重标识。
- [x] 用紧凑、可换行的小标签呈现角色，保持机构完整名称与展开操作，更新中英文说明与回归。
- [x] 完成测试、构建、隔离 Zotero C/D/E/F、明暗主题及实际 XPI 工作流验证。

实现与验证：

- 作者格式化固定输出全部主角色作者，count/first3/姓名缩写不会截掉匹配所需原名。唯一明确的第一作者标记优先，否则取条目首位；有明确通讯作者显示通讯作者，无明确标记则显示条目末位，单作者不重复。末位只是条目顺序回退，不声称是出版物确认的通讯作者；不会回写用户作者列表。
- 机构携带第一/通讯/末位角色及匹配的关键作者姓名；去重时合并角色，共同机构保留双标签，悬停可见作者名。预览仍最多 3 家，但优先确保第一与通讯／末位各有代表；展开保留所有机构与角色，无法匹配的机构无归属标签。原图标和单摘要设计不变。
- 245/245 Node 回归、Prettier、ESLint、TypeScript 与构建通过。隔离 Zotero 10.0.1 C/D/E/F 20/24/91/19 和设置 5 项通过；E 新增机构归属、首末回退、共同机构合并、明确通讯替换末位回退 4 项实际 DOM 检查。
- 用自动清理的合成作者/机构示例验证明确通讯和无标记回退两种状态，571px / 291px、明暗主题共 6 张截图均无溢出，机构双标签可见；不会用作者不完整的真实文献示例冒认实际末作者。截图为本次 visualizations 目录的 zest-author-roles-{confirmed,fallback}-{light,dark,narrow}.png。自建视觉条目及缓存已清理，未访问日常文库。
- 最终 XPI 为 197983 字节，仍是 1.1.0 本地候选，Zotero 10.0–10.*，包内无开发端点/令牌/测试夹具。实际临时安装后 31 项验证通过，包括首末作者可见和准确标签、无凭空通讯/机构归属、完整展开、真实翻译前后状态与原字段保留；新增插件错误为零。自建生产条目已清理，隔离实例正常退出。本轮未复现上一轮宿主崩溃，未提交、推送、发布或安装到日常 Zotero。

## 2026-09-06 — 单摘要、按需翻译与关键作者

范围：按用户最新反馈删去摘要空提示、常驻缓存/翻译说明和多个原文/译文区；只保留一个摘要主体。翻译按钮点击才请求并切换为译文，未点击不显示译文。作者默认展示第一作者和来源明确标记的通讯作者，其余折叠；机构优先匹配这些作者并去重。保留其他未提交改动、原图标和摘要段落排版，不更改版本、不发布、不改日常文库。

接口研究：复用 Translate for Zotero 官方 `api.translate(raw, { pluginID, langfrom, langto })` 自定义任务，不传 itemID、不读取密钥、不走写入 Extra 分支；无插件时使用其 Bing 适配公开端点，明确服务来源、只按点击发送，不在已配置服务失败后静默切换供应商。OpenAlex 通讯身份只取 `is_corresponding === true`，`author_position: last` 不能替代；旧作者缓存按面板请求补齐详细元数据，不影响图谱已有缓存和身份规则。

- [x] 核对当前源代码、官方翻译 API 和作者字段语义，确定最小改动范围。
- [x] 扩展作者缓存的角色/机构信息及旧缓存补全；独立验证严格作者匹配、核心机构和未知通讯情况。
- [x] 接通按需翻译：默认无请求/无译文、成功缓存、失败可重试、切换条目/摘要更新时丢弃过期结果。
- [x] 收敛为单一摘要视图，移除多余提示和旧代码；实现关键作者与核心机构的默认展示及展开。
- [x] 更新回归与文档；执行 Node、静态检查、隔离 Zotero 功能/视觉/真实翻译和最终 XPI 验证。

接口依据：[Translate API](https://github.com/windingwind/zotero-pdf-translate/blob/main/src/api.ts)、[Bing 适配](https://github.com/windingwind/zotero-pdf-translate/blob/main/src/modules/services/bing.ts)、[OpenAlex authorships](https://help.openalex.org/data/authorships/)。

实现与验证记录：

- 摘要只保留一个正文，译文仅由点击产生并在原区域切换，不再自动展示 Extra 旧译文；删除 9 条无引用文案与原多摘要/空提示样式。翻译最多 4 个并发任务、32 条一小时内存缓存，插件关闭/来源变化/面板离开丢弃过期结果；配置的翻译插件失败后不切换供应商，不记录带密钥的任务或错误。
- 作者详情缓存增加来源 DOI、通讯标记和完整机构，旧图谱缓存兼容；DOI 改变时不复用旧详情。详情补全的临时失败只退避 30 秒，确定缺失才缓存 6 小时。面板用独立的一对一姓名匹配，兼容省略中间名，但拒绝同名/缩写歧义；没有通讯标记不推定末位作者。
- 机构在第一/通讯作者匹配的并集中去重，默认最多展示 3 家；同一篇多中心来源泛挂机构时，优先展示出现在更少作者记录中的机构，同频保持来源顺序。无可靠匹配则保留 2 家去重机构预览，不声称其属于某位作者；所有其余机构均可展开。该排序仅为展示启发式，不是机构真实性或学术地位判断。
- 231/231 Node 回归通过；Prettier、ESLint、TypeScript 和生产构建通过。Zotero 10.0.1 隔离实例 C/D/E/F 分别 20/24/87/19 项、设置 5 项全部通过；E 用可恢复的官方 API 测试替身核对点击时机、语言参数、单正文、字符安全及不写文库字段。
- 独立实际点击 Microsoft 接口完成公开 KEYNOTE-671 摘要翻译，可返回原文；源摘要及译文均保持 4 段和 P<0.001，abstractNote / Extra / language 未变化。服务曾将独立 Results 标题误译为“选举结果”，仅固定已知整行结构标题后复验通过，正文仍由服务生成，未声称医学翻译质量已全面验证。
- 实际 OpenAlex 返回 19 条作者详情、无通讯标记，故默认仅显示第一作者。第一作者省略中间名的匹配已复验，机构从其来源记录中优先显示 Stanford 相关条目；未伪造通讯作者或删改源机构记录。
- 最终截图覆盖 667px / 307px / 367px、13px / 20px 与原文/译文明暗主题，无横向溢出。截图需等待原生主题变量完成更新，不能只看 matchMedia。一次验证发生未定位的 XUL 原生 SIGSEGV，无符号栈不能归因于 Zest 或排除其触发；干净重启后功能回归及全部视觉验证均通过，未复现。
- 自建视觉测试条目及其作者缓存已定点清理；日常文库未访问或修改，图标、版本和发布渠道未改。
- 最终 `.scaffold/build/zest.xpi` 为 197165 字节，版本仍为未发布的本地 1.1.0 候选，Zotero 10.0–10.*；ZIP、内容和清单核对通过，无开发端点/令牌/夹具。临时安装该 XPI 后 28 项冒烟全部通过，包括真实 Microsoft 翻译与原文切换、单正文、第一作者折叠、全部作者展开及三项字段不变；无新增插件错误。生产测试条目已清理，隔离实例正常退出，未提交、推送、发布或安装到日常 Zotero。

## 2026-09-06 — 书目信息重排与审阅闭环

范围：按最新反馈保留摘要区布局及图标；将标题下的期刊、作者、机构改为全宽阅读式排版，减少左侧标签列、半个姓名截断和连续展开按钮造成的视觉噪声。保留现有图谱/摘要未提交修改，不变更版本、不发布、不改日常文库。

- [x] 核对最新工作区、上一轮截图、计划中的审阅清单和隔离验证约定。
- [x] 复查未闭环的字段/缓存/交互问题，记录可复现证据和最小修复范围。
- [x] 刊名与分区归入标题下方；作者按完整姓名排列，长列表明确展开；机构独立列出，保持可访问性和原作者菜单。
- [x] 修复已确认的审阅问题，补齐行为回归；不改摘要布局，不覆盖用户字段。
- [x] 检查窄/宽侧栏及明暗主题；执行 Node、TypeScript、lint、C/D/E/F 与设置回归、生产构建及隔离 XPI 冒烟。

本轮审阅闭环：同项重绘丢失简记草稿/焦点/选区；机构请求绑定旧 DOM 导致取消与重复请求，自动未命中循环重试；关闭后立即开启摘要偏好复活旧请求；Extra 结构标题和多词元数据边界；跨行或缩进 PMID；Europe PMC 来源链接与记录 PMID 不一致；Extra 写入失败后内存残留导致同值重试被跳过（单键与多键均修复，保留并发新编辑）；作者/星级/阅读热条无法键盘操作；简记及评级保存失败缺少可见反馈。均有针对性行为回归，移除原半行截断样式和两条无引用文案。

验证记录：

- 169/169 Node 回归通过，信息面板覆盖 44 项；Prettier、ESLint、TypeScript、生产构建及 ZIP 完整性检查通过。
- Zotero 10.0.1 隔离实例 C/D/E/F 分别 20/24/82/19 项、设置 5 项全部通过。新增 E 实测作者/机构整条展开、同项状态保留、刊物位置、320px 全宽布局、原生按钮可访问性，以及真实焦点/选区/未提交简记保留且 Extra 不被写入。
- 实际侧栏 667px / 307px / 367px、13px / 20px 字号与明暗主题截图通过，无横向溢出、姓名前置分隔符或半行截断；中文默认徽章顺序为中科院 → JCR → IF。新截图为本次 visualizations 目录的 zest-bibliography-{light,dark,narrow,large-text}.png。摘要区布局和全部图标未变。
- 最终 `.scaffold/build/zest.xpi` 为 193232 字节，仍是未发布的 1.1.0 本地候选；无开发端点/令牌、测试脚本或文库夹具。安装到干净启动的隔离实例后，22 项生产冒烟通过，包括真实 XPI 来源、新书目顺序、完整作者展开、可访问控件、四段摘要和设置；真实插件错误为零。第一次安装探针把 AddonManager 的正常同 ID 替换 WARN 计作错误，已按精确消息单独记录，复验通过。
- 自建视觉/生产测试条目及其机构缓存已定点清理，隔离实例正常退出；未访问或修改日常文库，未提交、推送、发布或安装到日常 Zotero。

## 2026-09-06 — 侧栏摘要补全与阅读排版

范围：保留上一轮未发布的图谱修改；修复摘要/译文展示与单篇在线补全，优化 Zest 信息侧栏。图标、版本、文库内容与发布渠道不变。

研究结论：现有面板仅显示 abstractNote 和 Extra.abstractTranslation，没有摘要补全；英文结构标题还可能被误判为下一条 Extra 字段。公开示例 DOI `10.1056/NEJMoa2302983` 对应 PMID `37272513`：Europe PMC core / PubMed 提供四段摘要，Crossref 未提供摘要。采用仅 DOI/PMID 精确检索、二次身份核验、可见来源的单篇手动获取，不爬全文、不自动批量联网、不生成摘要、不覆盖已有摘要和译文。
官方接口：[Europe PMC](https://europepmc.org/RestfulWebService)、[PubMed E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25499/)、[NCBI 使用与速率约定](https://www.ncbi.nlm.nih.gov/books/NBK25497/)、[Crossref REST](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)。

- [x] 审查摘要来源、Extra 多段边界、生命周期与网络/缓存复用；验证公开示例和当前官方接口。
- [x] 修复译文结构标题截断；安全解析摘要段落和标题，保留 P<0.001 等统计表达与完整正文。
- [x] 加入 Europe PMC / PubMed / Crossref 精准补全与来源缓存，区分缺失/限流/离线/错误；多窗请求去重并丢弃关闭或切换条目后的回包。
- [x] 实现摘要空状态、获取反馈、来源和原摘要/译文切换；只写插件派生缓存，不写 Zotero 字段。
- [x] 重新组织文献信息、摘要、阅读与简记分组，改善作者/机构、长简记、段落宽度和明暗主题，保持图标与原操作语义。
- [x] 回归纯文本/结构化摘要、准确匹配、缓存/取消、窄宽侧栏及大字号；运行 Node、类型、lint、生产构建与隔离 Zotero C/D/E/F 和视觉检查。

验证记录：

- Zotero 10.0.1 隔离实例中，公开 KEYNOTE-671 示例实际点击「查找完整摘要」取得 Europe PMC 的 2804 字符、4 段结构化摘要；额外验证真实 PubMed EFetch 回退也保留 4 段、3 个小于号。原 abstractNote / Extra 未被获取操作覆盖；没有访问或修改日常文库。
- 只在点击时发送 DOI / PMID，正缓存 30 天、确定缺失缓存 6 小时、最多 500 条；DOI 与 PMID 冲突不能通过不提供 PMID 的 Crossref 绕过核验。限流/离线/无效数据不写缺失缓存，切换条目或关闭后不写过期结果。
- 文献信息、摘要、阅读与简记分组；长作者/机构可展开，超过 900 字符的摘要提供明确的完整阅读按钮，全文保留在 DOM。自然折行的简记仍保存为单行 Extra，回车不能注入其他字段。移除两条不再使用的本地化文案。
- 纯文本与标记解析分离：API 标记只解码一次，缓存和 PubMed DOM textContent 不重复解析；回归 P<0.001、A<B and C>D、字面 <b>、&lt; 与未知实体，避免医学数值或比较式被标签正则删掉。
- 140/140 Node 测试；隔离 C/D/E/F 分别 20/24/74/19 项、设置 5 项通过。新增 E 回归覆盖离线渲染、完整结构化摘要、多源精确回退、原字段保护、译文边界、统计符号、折叠状态和窄屏布局。
- 实际侧栏 667px / 307px / 367px，13px / 20px 字号，以及明暗主题无横向溢出；截图位于本次 Codex visualizations 目录的 zest-abstract-sidebar-{light,dark,narrow,large-text}.png。展开后可读全部 4 段，主题颜色跟随 Zotero 原生变量，图标不变。
- Prettier、ESLint、TypeScript、生产构建、ZIP 完整性检查通过；最终 `.scaffold/build/zest.xpi` 为 191119 字节，仍为 1.1.0 的本地候选。包内无开发端点、令牌、测试脚本或真实文库夹具。
- 最终 XPI 临时安装到隔离实例，18 项冒烟通过：版本/启用/实际 XPI 来源/新实例/API/样式/开发端点移除/设置/按钮/卡片/完整摘要/展开/原字段/简记与分组，新增插件错误为零。首次复用安装探针的摘要检查未通过，补充安装后明确重选自建条目及错误差分诊断，在干净启动实例重跑通过。自建测试条目已清理，隔离实例正常退出；未提交、推送、发布或安装到日常 Zotero。

## 2026-09-06 — 大文库图谱布局与标签可读性

范围：针对顶部节点排成直线、密集标签互相遮挡及视角恢复问题改进图谱；不改图标、关系定义或发布版本。
用户明确授权用现有数据库验证：仅只读提取必要条目/关联元数据，在隔离实例中测试；不运行会改真实文库的现有探针，不改标签、笔记、阅读记录，不联网补全，也不复制整库。

- [x] 核对 1.1.0 干净工作区、截图和实际 d3-force 实现，复现硬边界压平节点问题。
- [x] 提取真实文库的大图谱只读测试用例，记录规模与截断边界，保持数据本地且不纳入版本库。
- [x] 去掉逐节点硬裁剪，改为保留布局坐标、整体适配视野；改进大小分量的空间分配。
- [x] 标签按屏幕空间避让、限制同时显示数量，悬停/键盘聚焦优先展示当前节点；保留完整 tooltip。
- [x] 新数据重置视角，加入适配视图入口；缩放、平移、拖动和窗口变化保持可控。
- [x] 添加密集图/极端宽高比/标签碰撞/交互与清理回归，检查真实大文库明暗主题截图、静态检查和构建。

验证记录：

- 经用户授权，通过日常 Zotero 本机只读 API 提取 978 条顶层记录中的 975 条普通文献；测试副本仅保留图谱所需元数据，不保留摘要、Extra、笔记或附件内容，未复制数据库。测试 JSON 权限 0600，置于 Git 忽略的 `.scaffold`，分类名称匿名化；未导入隔离数据库或回写原文库。
- 四种实际图结构：关联 129 节点/110 边、作者 499/427、标签 146/207、分类 497/749。分类图有 437 节点的大连通分量，最高度数 103；500 节点预算曾留下 3 个失去邻居的分类节点，已在截断后清除，保留全部 749 条有效边和截断提示。
- Zotero 10.0.1 隔离实例：四种图谱 × 960×460、320×460、1200×600，共 12 组，默认与 hub 聚焦状态均无节点越界或可见标签重叠，焦点标签存在；按 0.01px 分桶，同一 y 行最多 3 个节点。模型坐标不再被视口硬边界压平。
- 大图初始同步布局实测 254–300ms；标签避让均值约 0.38–0.56ms（近 500 节点，30 次采样），与模拟布局分离且无每帧文字测量。字号 24px、2 倍缩放和明暗主题截图通过；手动放大时节点允许离屏，文字仍避让且留在视口内。
- 回归：Node 86/86；Zotero C/D/E/F 20/24/64/19、设置布局 5 项通过；新增适配按钮在 320px 面板内无溢出。隔离窗口因 macOS 遮挡曾暂停 RAF，恢复可见后按实际动画重跑通过，未改计时机制规避测试。
- 最终 Prettier、ESLint、TypeScript、生产构建与 XPI 压缩包校验通过。`.scaffold/build/zest.xpi` 为 181694 字节，仍为 1.1.0 的本地候选，含新布局/标签逻辑、不含开发端点/令牌或真实文库测试文件。图标、版本、发布渠道未改；未提交、推送、发布或安装到日常 Zotero。隔离实例已正常退出。

## Release 1.1.0 — 稳定性修复与界面优化

用户指定版本 1.1.0，发布此前已完成的全部修复与 UI 调整，保持 Zotero 10 兼容范围及单一稳定更新渠道。

- [x] 核对本地与远端 main、版本标签及更新渠道；确认 v1.1.0 尚未发布。
- [x] 更新 package、lockfile、README 和中英文发布说明，完成发布前差异审查。
- [x] 通过单元测试、静态检查、1.1.0 隔离 Zotero 探针和最终生产 XPI 检查。
- [x] 提交并推送 main，等待该提交 GitHub CI 成功，再发布 v1.1.0 安装包。
- [x] 更新稳定渠道 update.json，独立下载公开安装包和清单，核对版本、URL、大小与 SHA-512。

发布候选验证：58 项 Node 行为回归；Zotero 10.0.1 上 C/D/E/F 分别 20/24/63/19 项，设置布局 5 项全部通过。
最终生产 XPI 直接加载于隔离 profile，11 项安装冒烟检查通过（版本、启用、XPI 来源、新实例、API、样式、无开发端点、设置加载、按钮对齐、紧凑标题和无插件错误）。
包大小 179906 字节，更新清单 SHA-512 与安装包相符；明示支持 Zotero 10.0–10.*，未改变图标。

发布完成：提交与 `v1.1.0` 标签指向 `451d2ac7cd7b5ef2dff47a7381e220088a73086a`，GitHub CI `34003199636` 成功。
正式 Release 已设为 Latest；安装包与稳定渠道清单均匿名重新下载验证。初次渠道读取命中旧 CDN 缓存，后续规范 URL 已返回 1.1.0，哈希、兼容范围与安装包一致。
公开安装包 SHA-512：`4ce5800138cc2d0285ac7d8c87e3a63a5bfadf756ee73c34b9acb68434615df3414a584a56fd68b0c4b4c7a302a0b82d1601022e6571c7fda69194485cd2bd6c`。

## 2026-09-06 — 设计审阅逐项修复与运行效率优化

范围：修复 10 项审阅发现，改进相关设置、反馈与局部刷新；保留现有功能边界及 Zotero 原生交互。验证使用隔离开发 profile；本轮不变更版本或发布渠道。

追加范围：美化设置页、条目面板/标签侧栏与文献关联图，保留全部现有图标；统一层级、留白、控件反馈与明暗主题，避免为装饰增加后台计算。

- [x] 核对当前代码、仓库约定、审阅证据与 Zotero 本地类型；确认修改边界和分工。
- [x] 阅读导入与增量写入串行协调，失败不污染内存；启动加载失败可恢复。
- [x] 阅读导出携带稳定文库身份，导入映射目标库并反馈未匹配记录。
- [x] 期刊缓存、队列、批量去重统一使用可靠身份，拒绝跨 ISSN 歧义命中。
- [x] HTTP 普通/密钥请求统一失败分类；作者补充抓取正确退避、去重及取消。
- [x] 信息面板机构自动获取默认关闭，提供明确手动入口和双语设置。
- [x] 样式、原生面板可见性和延迟清理具备副本所有权；补齐升级回归。
- [x] 标注摘要在附件归属或总页数变化时定向失效，避免每个阅读 tick 全量重算。
- [x] 作者/标签筛选统一清理，布局撤销按窗口保存。
- [x] 减少重复面板刷新及无效任务，删除确认无用代码，保留兼容性需要的分支。
- [x] 建立 Node 内存回归用例并接入 CI，补充 Phase E 行为断言及用户文档。
- [x] 美化设置页分组与控件布局、日常阅读面板和文献关联工具栏/画布；保留图标与数据语义，并检查窄宽度与键盘焦点。
- [x] 按截图反馈收窄原生控件样式、消除卡片标题重复留白；期刊标签归入内容列、收紧外链布局，图谱分段控件改为中性色。
- [x] 检查全部 diff；通过格式、ESLint、TypeScript、生产构建、Node 回归及 Zotero Phase C/D/E/F；检查明暗主题截图与相关交互。

分工：阅读持久化/导入、网络/期刊身份、生命周期/筛选/布局独立实施；主任务整合信息面板 UI、标注失效、测试入口、翻译和验证。共享文件由主任务统一修改。

验证记录（2026-09-06）：

- Node 行为回归 58/58；全库 Prettier、ESLint、TypeScript 和生产构建通过。
- 隔离 Zotero 10.0.1：Phase C 20、D 24、E 63、F 19 项全部通过。E 的原 60 项分别跑过中英文；新增 3 项控件布局断言在最终中文实例通过。
- 停用/副本升级探针 8/8；原生标签与标签页恢复，样式移除，延迟任务不复活旧徽章。正常退出并重启后，API、样式、SQLite 内存索引恢复，无 Zest 错误。
- 设置布局探针 5/5，重启后无需缓存绕过：17 个原生按钮无文字越界，内部按钮/复选框布局不受污染，标题无重复上边距，420px 设置内容无横向溢出。
- 信息面板在 270/304/420px 下无横向溢出，分区标签置于刊名下方并与内容列对齐。明暗主题截图已检查；原有图标文件无改动。
- 最终 `.scaffold/build/zest.xpi` 压缩包检查通过；包含最新 scoped CSS、中性色图谱样式，不含开发执行端点或开发令牌。版本仍为 1.0.10；未提交、推送或发布。

## Release 1.0.10 — 期刊分级与刊名查询修复

- [x] 核对当前工作区、`main`/`origin/main`、公开最新版与发布范围；确定下一个补丁版本为 `1.0.10`。
- [x] 完成全部 diff 对抗审计，更新 package/lockfile/README 版本号与发布说明。
- [x] 运行 lint、TypeScript、生产构建、XPI manifest/压缩包检查及 Zotero 10 Phase C/D/E/F 隔离探针。
- [x] 提交并推送 `main`，等待 GitHub CI 通过，再发布版本化 `zest.xpi`。
- [x] 替换滚动 `release/update.json`，匿名下载公开资产，独立核对版本、兼容性、URL、大小与 SHA-512。

## 2026-09-04 — easyScholar 官方刊名后缀兼容

- [x] 追踪 publicationTitle → 查询名 → easyScholar → 负缓存链路，界定不会误截断正式冒号刊名的保守规则。
- [x] 对 `: Official Journal/Publication/Organ of …` 生成主刊查询名和共享缓存键，保留 Zotero 原始出版物字段。
- [x] 增加示例长刊名、全角冒号、合法冒号刊名与缓存身份回归断言。
- [x] 运行格式、TypeScript、ESLint、构建及 Zotero 10 隔离开发实例探针，检查最终 diff。

## 2026-09-04 — 中文期刊标签默认顺序

- [x] 核对 easyScholar 当前公开字段、字段语义及权威期刊评价体系的一手来源。
- [x] 将未自定义字段顺序的中文界面默认值改为：中科院分区 → JCR 分区 → 影响因子；保留英文默认和用户自定义顺序。
- [x] 同步更新中英文说明与回归断言，避免旧默认偏好失去 locale-aware 迁移。
- [x] 运行格式、TypeScript、ESLint、构建及 Zotero 10 Phase C/D/E/F 探针，并检查最终 diff。

## Release 1.0.8 — APP_SHUTDOWN lifecycle repair

- [x] Reproduce the shutdown race in an isolated profile: the plugin's own
      `Zotero.Plugins` shutdown notification queued a delayed re-registration after
      `zest.sqlite` had closed.
- [x] Mark the instance dead and unregister its sweep observer before the
      app-shutdown persistence barrier; preserve in-place upgrade recovery.
- [x] Add a Phase E regression assertion and run all declared static/build and
      Zotero 10 isolated-profile probes.
- [x] Capture the maintainer's production columns, order and sort, and
      make it the non-destructive recommended default with a regression check.
- [x] Publish `v1.0.8`, refresh the rolling `release/update.json`, and verify the
      public XPI version and SHA-512 independently.

---

## 0. 决策摘要（先看这一页）

| #   | 事项                                  | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **名字** ✅（易改）                   | **Zest**——短、易记、无同名 Zotero 插件（GitHub / zotero-chinese 商店均无）。ID `zest@zotero-zest.app`，chrome `zest`，prefs `extensions.zotero.zest`，仓库 `yimmy23/zotero-zest`。备选：Flair / Prism。                                                                                                                                                                                                                                                |
| D2  | **开源基线**                          | GitHub 源码冻结在 **2.6.7（2023-05 主体 + 2023-12 一个 5 行 PR）**，Zotero 6 时代代码；2.8.0→6.0.8 的全部发布只有 xpi（含 Zotero 7 支持、"Ethereal Style"命名、Pro）。因此"开源版功能"= 2.6.7 源码 + README；一切都是在 Z7–9 官方 API 上的重新实现，不存在可移植的 Z7 代码。                                                                                                                                                                           |
| D3  | **Zotero 版本** ✅（2026-08-18 更新） | 用户拍板：**只支持 Zotero 9–10**。`strict_min_version 9.0`、`strict_max_version 10.*`。Zotero 10.0 已正式发布（tag 10.0.0，2026-08-17）；本机 /Applications/Zotero.app 已升到 10.0；测试用 9.0.6 与 10.0 两份独立副本放在 `.scaffold/apps/`（隔离 profile `dev-profile9` / `dev-profile`），两版都真机验证。Zotero 10 官方开发者页的破坏性变化见 §1.3b。                                                                                               |
| D4  | **SyncedSettings 不能用于插件配置** ⏸ | dataserver 对 setting 名**白名单**（`tagColors/feeds/lastPageIndex_*/readerCustomThemes/…`，dataserver `model/Settings.inc.php` L30-40 已亲自核对），自定义键会让整个 `POST /settings` 400 → **该库同步持续失败**。故 §3 里"视图组 / 标签规则 / 分区显示偏好 → SyncedSettings"不可行。**建议**：这类配置存 prefs（JSON 字符串）+ 数据目录 `zest-config.json`，"插件配置导入/导出"做成一等功能；跨设备靠导出文件（不写隐藏条目、不碰 SyncedSettings）。 |
| D5  | **标题列底纹 / 未读加粗** ✅          | Zotero 不允许替换内置 Title 列渲染。采用"每窗口包一层 `ItemTree.prototype._renderCell`（primary 列后处理）"——7.0.0→10-main 签名未变（评级 B+），全程 `guard()`，探针失败即静默降级为独立 "Reading" 列。                                                                                                                                                                                                                                                |
| D6  | **垂直标签页** ✅                     | 无公开 Tabs API；依赖 `Zotero_Tabs.{_tabs,selectedID,select,close,move}` + Notifier `tab` 事件 + `#tab-bar-container` MutationObserver（三者 7.0.0→main 契约未变）。侧栏为 `<vbox>+<splitter>` 插在 `#tabs-deck` 前；原生横条**仅 CSS 隐藏** `#tab-bar-container > div{display:none}`。全部私有调用走 `probeTabsAPI()` 特性检测，缺失即整块功能禁用并提示。                                                                                            |
| D7  | **Pro 清洁室范围** ⏸                  | 实现：Tab Manager/垂直标签页、Cited Counts（你追加的需求）、Explore→"文献信息面板"（ItemPane section）、TLDR（S2 一句话摘要，顺手）。**不做**：Attachment Preview（Zotero 7 已原生）、Note Manager、Backlinks（行为不明）、AI 简记/标签（需外部 LLM）。**Annotation Manager + 文献矩阵**：价值高但体量大，建议列为 D 阶段末的可选项，视余量决定。                                                                                                      |
| D8  | **新增功能（实现 5 个）** ✅          | ① 阅读统计面板 + 日历热力图 + 周/年总结；② 分区数据离线缓存 + 多来源并存（easyScholar + 本地 JSON 数据集 + OpenAlex 期刊指标兜底）；③ 阅读记录导出/导入 + 旧版一键迁移；④ Zotero 彩色标签互通；⑤ 阅读状态自动化（开始阅读→In Progress、进度≥阈值→Read，可关）。加上你追加的 **作者列（better-authors 逻辑重做）** 与 **被引数列**。                                                                                                                    |
| D9  | **删除** ✅                           | Shift+P 命令面板、隐藏"Addon Item"笔记存储、斑马纹/选中行硬编码颜色、按扩展名替换附件图标、Obsidian 图谱引擎、4 个死 pref、`Array.prototype.map` 劫持式标注配色、全局 `getField/Search.search` 补丁。理由见 §4.4。                                                                                                                                                                                                                                     |

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

---

## 9. 官方手册对比结论（2026-08-18，Opus 子代理 · `.research/notion-manual-spec.md` + `notion-gap-matrix.md`）

矩阵 120 行：✅ 已实现 21 · 🟡 部分 25 · 📅 C 29 · 📅 D 1 · ❌ 有意删除 12 · ⛔ 原 plan 未提 32。处理办法：

**B1（阶段 B 内已改，commit 0b9c449）**：未读加粗只对「未读/待读」（无状态可选加入，默认关）；`#标签` 文字色 `auto`（同色相、亮度压到可读，暗色主题反向）；Tags 列不再重复显示被 `#标签` 规则命中的标签；`~~X` 多字符按字符类；前缀规则余下为空则隐藏；热力默认色原为 `#FFC6D3`/0.7 对齐原版，**用户拍板改为 GitHub / Codex 式的蓝色离散热力（4 级台阶，基色 `#66ADFF` = Zotero `--accent-azure`，不透明度 0.7），徽章默认 `#4072E5` = Zotero `--accent-blue`；待读圆点与星级也统一到蓝系**；评级 `mark/option/color` 三个符号项 + `Extra 键名`（默认 `rate` 兼容原版，读取两者）；工具→Zest 顶部「Zest 设置…」入口；设置页 hint 修正。

**折进阶段 C（原 plan 缺失或需细化）**

1. 嵌套标签的**标注定位卡片**：按选中标签过滤当前条目的 PDF 标注 → 单击复制、双击 `Zotero.Reader.open(itemID,{annotationID})` 跳转（原版 2.2 的核心承诺，原 plan 遗漏）。宿主：条目面板 section（与 D 的信息面板同一容器）。
2. 期刊标签：`Fields`（默认 `sci, sciif5, eii`，40+ 字段清单入设置页）、`Sort By` 多键（`sci, -sciif`；**缺失值永远排最后**，README 注明有意修正）、rank 阈值表（sciif ≥10/4/2/1/0 → 1–5 等）、`rankColors` 5 色（`#EE0000, #2F998C, #D2A500, #DA6D00, #007BF6`）、`Map` 对 key/value 分别映射（`A=B` 全等、`/re/=X` 正则 replace）、`defaultColor/textColor`、单条强制刷新（单元格右键）、easyScholar 密钥申请引导 + 全角逗号纠正 + 字段名大小写不敏感 + 刊名括号剥离。
3. IF 列 `max`（15）/`progress`（条）/`info`（文字）三开关 + 默认色。
4. 标注密度列（改名「标注」）：`bar` + `stack` 两种样式、`circle`、默认**关闭**（性能）。
5. 视图组：新增/更新/删除三个入口改为显式菜单项 + 确认（不复刻长按与隐藏条件）；`Position` 改拖拽；提供旧 `columnsViews` 导入。
6. 嵌套标签：`linkSymbol`（默认 `/`，7 选项）、4 种排序、全部折叠/展开、与原生标签选择器互切、`Copy Tag`/`Copy Full Tag`、批量前缀改名影响面提示。
7. 分类计数默认关 + 4 种模式；Tags 列 `margin`、#标签 `opacity/margin/padding`（与「标签规则」设置页一起做）。
8. 图谱：模式圆点常驻、节点文案 `lastName, year`、显式「重新分析」、默认高 400px、跟随主题。

**折进阶段 D**：Authors 列接受旧变量 `${firstName} ${lastName} ${firstCreator}`、旧切片语法 `0:1, -1:`、`join` 默认 `", "` 并提供旧配置导入；信息面板的每页热力条可点击跳页（原「高能进度条」）；阅读统计面板注明数据来源与导出方式。

**D10 · 与 Zotero 10 原生功能的关系（2026-08-18 用户拍板）**：Zest 只做 Zotero 10 的**扩展与优化**，不与原生功能冲突。落地约束：

1. 任何**替换**原生界面的功能默认关闭、可一键切回，且只隐藏不删除原生节点（嵌套标签树 `nestedTags.show` 默认 false，只对 `#zotero-tag-selector` 设 `hidden`，原生 React 根永不移除）。
2. 不占用原生已经在用的机制：筛选走 Zest 自己的 `getItems` 管线，**不碰** Zotero 10 的 `setFilter('advanced-search')`（那是高级搜索面板的槽位）、不改 `setFilter('tags')` 的语义、不替换 `getSearchObject`。
3. 复用而非另建：阅读器主题写官方 `readerCustomThemes`（按 id 合并，保留用户自己的主题）；标签颜色 ≤9 仍走 `Zotero.Tags.setColor`，超出部分才用 Zest 本地规则；列一律走 `ItemTreeManager.registerColumn`。
4. 不重复原生已有能力：附件预览、Recently Read、原生高级搜索、原生 emoji/彩色标签渲染一律沿用 Zotero 的实现，Zest 不另做一份。
5. 视图组会写 Zotero 自己的 `treePrefs.json`，因此只在用户显式「应用视图」时写，且提供「恢复上一次布局」。

**有意差异（写进 README「与原版的差异」）**：无 Shift+P 命令面板（功能分散到菜单/设置/列内交互）；不再可配奇偶/选中/悬停行底色（只用 Zotero 主题变量）；阅读记录不进文库（zest.sqlite + 导入导出）；也记录独立阅读器窗口与 EPUB；计时口径 = 120 s 无输入停表（原版 60 s 页面不动）；评级单击即写入；标签列跟随 Zotero 7+ 口径（彩色 + emoji）；`#标签` 正则无捕获组显示整个标签；期刊标签缺数据永远排最后；图谱跟随主题；视图组操作显式化；设置统一在「设置 → Zest」；附件图标不按扩展名替换；评分 Extra 键可选（默认 `rate`）；配色主色系为蓝（热力 `#66ADFF` 4 级台阶、徽章 `#4072E5`、星级保持黄色 `--accent-yellow`（用户拍板）、待读 `--accent-azure`），不再是原版粉/紫，且热力由连续渐变改为 GitHub 式离散分级。

**阶段 C 追加的有意差异**：嵌套标签树默认关闭（首装保持 Zotero 原生标签选择器），且**永不自动切回**；前缀筛选走 Zest 自己的过滤管线（与快速搜索、原生标签筛选叠加，而非覆盖），因此也不改变原生标签筛选的 AND 语义；标注定位卡片只在文库标签页出现（阅读器里 Zotero 自带带标签/颜色过滤的标注侧栏）；标注列的第三种样式是「按颜色分点」而非原版的折线圆点（原版 `line` 样式已删，`circle` 因此重新定义）；期刊数据在无 ISSN/DOI 时仍可通过 OpenAlex 免费的 `autocomplete` 精确刊名解析，但**不做模糊匹配**（缩写刊名会解析失败而不是猜错刊）；OpenAlex 指标以 `oa2yr`（两年篇均被引）呈现并标注来源，不冒充 JCR 影响因子；视图组写 Zotero 自己的 `treePrefs.json`，仅在显式「应用视图」时写，并提供一级撤销；分类计数默认关闭。

---

## 10. 阶段 C 落地记录（2026-08-18）

**新增模块**：`core/{storage,config,secrets}.ts`（zest-cache.json / zest-config.json / 登录管理器密钥）、`tags/{tree,scope,rules,nestedTree,menu}.ts`、`views/{itemFilter,viewGroups,typeFilter,collectionCounts}.ts`、`rank/{types,rank,normalize,map,index}.ts + sources/{localDataset,easyscholar,openalex}.ts`、`annots/density.ts`、`panes/annotSection.ts`、`graph/{build,view,pane}.ts`、`reader/{themes,colorSchemes}.ts`、`columns/{annotations,pubTags}.ts`。

**与 Phase A 计划的三处修正（真机核对后）**

1. **前缀筛选不能用 `setFilter('tags', Set)`**：Zotero 对该集合是「精确标签 AND」，父节点展开成兄弟标签必然筛空。改为自建 `getItems` 过滤管线（`views/itemFilter.ts`，分支内 OR、分支间 AND，附件/笔记/标注的标签也算），Zotero 10 的 `setFilter('advanced-search')` 属于高级搜索面板的槽位，**故意不占用**。管线额外处理：只对顶层条目跑判定，子条目按父条目存亡带走（否则条目树会因残留子条目把父行重新拉回来）。
2. **`ZoteroPane.getSelectedLibraryID()` 在 Zotero 10 被移除并主动抛错**，必须用 `getSelectedLibraryIDs()`（`tags/scope.ts:selectedLibraryID` 统一封装）。
3. **视图组**：`_getColumnPrefs()` 在没手动调过列的 profile 上返回 `{}`（Z10 删掉了构造函数里的回写），必须 `prefs[dataKey] ??= {dataKey}`；`_storeColumnPrefs()` 不再改活动列模型，之后必须 `_resetColumns()` + `sort()`。

**其它真机结论**：`Zotero.Tags.getAll` 是异步的（`getColors` 同步）；`collectionsView.renderItem` 是实例字段且以 React prop 形式传下去，取消挂钩后必须再扫一次 DOM 才能清掉徽章；OpenAlex 自 2026-02 起按信用点计费，Zest 只用 0 点的单体端点（`/sources/issn:`、`/works/doi:`、`/autocomplete/sources`），**永不按刊名 `.search`**；easyScholar 的错误码在 HTTP 200 的响应体里（40002/40005/40006），退避必须自己做；`unregisterEventListener` 在 9.0.6 仍是反向过滤（会误删其它插件的监听器），因此永不调用。

**验收探针**：`scripts/phase-c-probe.js`（`scripts/dev-eval.sh -f scripts/phase-c-probe.js`），覆盖嵌套树挂载/筛选/搜索、标注卡片、9 个列注册、期刊链路、视图组应用与还原、类型筛选、分类计数开关、图谱渲染与拆除、阅读器主题与菜单钩子、错误控制台。

**阶段 C 对抗审查（5 维 × 54 条原始发现 → 逐条反驳 → 27 条确认，全部修复）**：`.research/` 外的修复清单见 git 历史（commits `98e6755`、`5b01717`、`3af9edd`）。要点：

- **数据**：本地数据集写盘用自有格式、读回却又走了一遍导入解析器 → 重启后字段全部塌成 `[object Object]`（已改为 `readStoredRows`）；网络不可达被当成「该刊没有分区」缓存 30 天（改为内存态 10 分钟退避）；`getItems` 过滤在 Trash / 快搜命中子条目时会误删子行（改为「父条目原本就不在集合里则保留」）；标注删除事件里 Zotero 只给 `{libraryID,key}`，原分支是死代码（改为在扫描时记录 annotation→条目 的归属表）。
- **隐私**：easyScholar 密钥在 URL 里 → Zotero 会把每个请求 URL 写进 debug 日志（其内置脱敏只匹配 `key=`），我们自己的日志也会打印 → 改为 **绕过 `Zotero.HTTP` 用裸 XHR 发送 + 自有日志脱敏 + 该请求永不进 URL 缓存**；`politeEmail()` 不再伪造一个固定邮箱，用户没填就不带 `mailto`；配置导出永不包含任何含 `secret/key/token/password` 的项。
- **默认值**：`rank.autoFetch` 与 `column.pubtags.enable` 改为默认关闭——全新安装不应在首帧就对第三方 API 发起成百上千次查询。
- **多窗口**：过滤器注册表、类型筛选状态、标注卡片的标签来源全部改为按窗口隔离；`getItems` 包装通过 `row.view._ownerDocument` 判断归属窗口，判断不出来就不过滤。
- **生命周期**：标签树/图谱注入到 `mainPopupSet` 的菜单、`itemsView.onRefresh`/`collectionsView.onSelect` 监听器、分类计数徽章都在卸载时按窗口清理；热重载/升级留下的旧包装通过挂在函数上的 `__zestOriginal` 恢复。
- **性能**：标签扫描每 200 条让出主线程；筛选一趟内缓存每条目的标签；`setting` 通知只在 `tagColors` 时重建（否则阅读器每翻一页都会触发）；搜索框 150 ms 去抖；`Retry-After` 上限 60 s。

---

## 11. 阶段 D 落地记录（2026-08-18）

**新增模块**：`authors/pipeline.ts` + `columns/authors.ts`（作者三列）、`cite/{index,sources,extraFormat}.ts` + `columns/citations.ts`（被引数）、`columns/remark.ts`、`panes/infoSection.ts`（Zest 文献面板）、`panes/statsDialog.ts`（阅读统计 + 日历）、`panes/annotMatrix.ts`（标注矩阵）、`tabs/{model,sidebar}.ts`（垂直标签页）、`ui/icons.ts`（内联图标集）。

**关键设计**

- **作者**：角色由 `Zotero.CreatorTypes.getPrimaryIDForType` 动态解析（film→director、thesis→author + contributor 作导师），姓名顺序与分隔符按**相邻两名的文字系统**决定（王小明、李雷 / 王小明, John Smith），标记（†、我）作为独立 part 渲染，**永不进入排序键**；提供 better-authors 设置导入。
- **被引数**：数值只存 `Extra` 的 `Citations: N (Source) [YYYY-MM-DD]`（citation-tally 同款），列直接读 Extra（O(1)、无缓存可陈旧）；读取 8 种历史格式（GSCC/ZSCC/eschnett 两代/openalex/裸行）并在写入时**替换而非叠加**；来源链 Crossref → OpenAlex → 可选 S2，**只在用户触发时联网**（Crossref 的 `/works/{doi}` 不支持 `select`，实测 400，已改为取整条记录）。
- **面板**：`registerSection` 注册「Zest」与「Annotation Finder」两节；面板内每页热力条可点击跳页；渲染期间不发网络请求。
- **统计 / 矩阵**：两个独立窗口（basicViewer 宿主）。日历最后一列必须是本周（否则今天被裁掉，已修）；`openDialog` 会复用同名窗口，因此已加载时立即渲染。矩阵搜索语法：空格＝且、`|`＝或、`-词`＝排除；导出 CSV / Markdown。
- **垂直标签页**：五点探针（`add/close/move/select` + `_tabs`）不过就整块停用；分组按 `${libraryID}/${itemKey}` 存 `zest-config.json`（tab id 每次会话都变）；原生标签栏只在侧栏显示时用 CSS 隐藏，卸载即恢复。**默认关闭（用户拍板）**。Zotero 10 实测**没有**原生标签分组 API，不冲突。
- **UI**：用户要求扁平化、无奇怪阴影、加图标 → 新增 `ui/icons.ts`（16 网格、1.5 描边、`currentColor`）用于标签树 / 图谱 / 面板 / 标注卡片 / 标签页侧栏 / 两个对话框；对话框按钮与下拉改为自绘扁平样式（`appearance:none`、无 box-shadow、自绘箭头）。

**踩到并修掉的坑**：`sanitizeConfig` 会重建整份配置文档 → 以自由键写入的 tabGroups 被静默丢弃（改为一等字段）；`Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1","nsIXMLHttpRequest")` 在现代 Gecko 抛 `Invalid InterfaceID`（改用主窗口的 `XMLHttpRequest`，无窗口时退回 `fetch`）；标签选择器容器在启动时可能尚未挂载 → 安装重试；图谱/侧栏/标签树的头部需要 `flex-wrap: nowrap` 才不会换行。

**easyScholar 实测（用户提供真实密钥，仅存于隔离 dev profile 的登录管理器）**：Nature 返回 24 个数据集（`sciUp=综合性期刊1区`、`sciif=56.1`、`sci=Q1`…）；中华医学杂志返回 `cscd=核心库`、`pku=1`、`zhongguokejihexin` 等；密钥未出现在 Zotero 的 debug 日志、错误控制台或导出的配置包中。默认展示字段无命中时，回落顺序为 CN 常用索引（cscd/pku/cssci/…）→ OpenAlex `oa2yr`。

**验收探针**：`scripts/phase-d-probe.js` —— Zotero 10.0 **22/22 通过**（9.0.6 本机已随自动更新升到 10.0，用户拍板不再单独回归 9）。

**阶段 D 对抗审查（42 个 agent × 41 条原始发现 → 逐条反驳 → 30 条确认，全部修复；commits `7a5d05f`、`72a5af1`）**

- **侧栏挂载点（critical）**：`#zotero-layout-switcher` 位于 `#zotero-trees`，即 library 标签页自己的 deck 页 —— 一切到阅读器标签页侧栏就消失。改挂 `#tabs-deck` 同级（其父为 `#zotero-pane-stack` 内的匿名 hbox）。
- **标签页 → 条目解析（major）**：`Zotero.Reader.getByTabID` 只认已加载的阅读器，而重启后所有标签页都是 `reader-unloaded`，分组全部失效。改读 `tab.data.itemID`（由 `Zotero_Tabs.add()` 写入并经 session.json 往返），阅读器查找降级为兜底。
- **`Zotero_Tabs.move` 语义（major）**：前移时内部先删后插会自减索引 —— 向下拖永远差一位、且无法拖到末尾。向下移动改传 `to + 1`。
- **XUL `<menuitem>` 的 Fluent 必须是属性形式**（major）：13 条值形式字符串（含全部三个作者下拉框）渲染为空白，已批量转为 `.label`；设置面板同时补上样式表（`.zest-pref-hint` 用了 21 次却无定义）。
- **偏好实时生效（major）**：`tabs.*` / `nestedTags.*` / `graph.*` 只在挂载时读一次，设置页的开关要重启才生效 → 补齐 `Zotero.Prefs.registerObserver`。
- **Extra 是用户的**（major，上一提交）：`withCitationLine` 会删掉 Extra 里所有空行、且未锚定的模式会把「3 citations still missing…」这类正文当成引文行删除 → 模式整行锚定、保留空行与非引文行。
- 其余：信息面板尊重只读条目、热力条打开被统计的那个附件而非第一个、引文数 0 不再是空单元格、简记列不再抢走 Zotero 自己的双击、会话恢复后台打开并限速（>12 个先询问）、批量关闭一次调用、分组成员清理与满员丢最旧、matrix 丢弃下拉里已不存在的过滤值并给搜索防抖、两个对话框恢复文字可选中（chrome UA 样式表默认 `user-select:none`）、统计窗口重开时重算。

---

## 12. 阶段 E 审计落地记录（2026-08-18）

**审计方式**：7 维（安全隐私 / 数据完整性 / 与原生 Zotero 10 冲突 / 核心正确性 / 性能 / UI·主题·本地化·可访问性 / 生命周期）多智能体全库审查，每条发现交由独立"反驳者"对抗验证（构造不出具体失败场景即判不成立）。**41 → 34 条原始发现 → 25 条确认，全部修复**（commit `f943e63`）。

**两条 critical（均在分类计数）**

- `redraw()` 里调了 `CollectionTree.refresh()`，而它是**数据重建**：会置 `selection.selectEventsSuppressed = true` 并要求调用方恢复选择后清标志。裸调（且每个 item 事件都调）导致选择事件被永久抑制——**点分类不再加载条目**。改为 `forceUpdate + invalidate`（徽章只需要重绘）。
- 递归子树计数跑在**行渲染器**里，每行 O(子树)，且被每个 item 事件作废。改为渲染路径之外的一次自底向上遍历（1.5 s 合并、忽略不可能改变计数的 item 事件），渲染器只读；>2000 个分类的库只算直接计数并记录日志。

**"不与原生冲突"这条红线上的三处**

- 评分星、状态点、简记单元格吞掉 mousedown/mouseup → 落在这些列上的 **Shift/Cmd 点击变成了改评分**而不是扩展选择。现在只有"无修饰键的左键"归我们。
- Zest 的过滤器活在 `CollectionTreeRow.getItems` 里，Zotero 的 reveal 路径看不见 → 阅读器里的 **View ▸ Show Item in Library**、Connector 保存、Word 的"Show in Library"在条目被过滤时**静默失败**。现包一层 `ZoteroPane.selectItems`：Zotero 先试，条目没出现且 Zest 有过滤时，清掉**我们自己的**过滤再让 Zotero 试一次。
- 嵌套标签树替换了 Zotero 可键盘操作的标签选择器，却没有键盘契约 → 补齐 `role=tree/treeitem`、`aria-selected/expanded`、单一 roving tab stop、方向键 + Home/End + Enter/Space、焦点描边。

**Extra 是用户的字段**

- "更新被引数"会删除 GSCC / ZSCC / `openalex.cit_count`——**别的插件的数据**，且是批量跨条目。现在只替换我们自己的 `Citations:` 行，且**原位替换**不再挪到末尾。
- 写一个键会删掉该键的**另一种拼写**（`rate:` 与 `Rating:` 并存时），迁移过来的库每次写入都在丢行。
- `zest-config.json` 解析失败不再变成"空配置 + 下一次写入把真文件覆盖"：存储转只读并提示用户。

**其余已修**：第二个主窗口什么都没绑定（`onMainWindowLoad` 时 ZoteroPane 的树还不存在 → 改为按窗口等待）；关掉第二个窗口会清掉第一个窗口的徽章；标签过滤在每次条目列表刷新时重走全库附件/标注（缓存改为跨 pass 存活、由 notifier 精确失效）；全库标签遍历会叠加（改为同时只跑一个、过期再补跑一次）；CSV 导出只做了引号转义没有防公式注入（`=/+/-/@` 开头的标注文本在 Excel 里会执行）；强制刷新分区会在每次请求前清掉 easyScholar 退避、且批量在 40006 后继续硬打；本地数据集尚未加载完就发起分区查询并把"无分区"缓存 30 天；标注直方图按"最后一个有标注的页"缩放而不是全文；信息面板忽略评分符号/颜色偏好、只读库里控件看起来仍可点；"Like Zotero's Creator column" 预设与 `getFirstCreatorFromData` 不一致（现已逐字对齐：单作者姓氏、`A and B`、`A et al.`）；灰显标签行对比度只有 2.1:1。

**验收**：`scripts/phase-e-probe.js` —— Zotero 10.0 **20/20 通过**；`scripts/phase-d-probe.js` 24/24、`scripts/phase-c-probe.js` 23/23 回归通过；第二窗口实测（徽章 2、标签行 2、样式与主色 token 均就位，关闭后第一窗口徽章不受影响）。
