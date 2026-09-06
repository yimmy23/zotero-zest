# ---- columns ----
column-reading = 阅读
column-status = 状态
column-rating = 评级
column-tags = 标签
column-texttags = #标签
column-annots = 标注
annots-cell-tip = { $count } 条标注 · 划线与批注共 { $chars } 字

reading-cell-tip = 已读 { $time } · 看过 { $read } 页{ $pages }

status-new = 未读
status-to-read = 待读
status-in-progress = 在读
status-read = 已读
status-not-reading = 不读
status-set-tip = 点击设置阅读状态
status-auto-tip = 按阅读记录判定：{ $status }——点击可手动指定
status-auto-label = { $status }（自动）
status-menu-header-none = 未设置
status-menu-header-auto = 当前：{ $status }（按阅读记录判定）
status-menu-header-manual = 当前：{ $status }
status-menu-header-many = { $count } 个条目

rating-tip = 点击星星评级；再次点击当前星级可降一级

# ---- menus ----
menu-root =
    .label = Zest
menu-status =
    .label = 阅读状态
menu-rating =
    .label = 评级
menu-clear-reading =
    .label = 清除所选条目的阅读记录…
menu-settings =
    .label = Zest 设置…
menu-migrate =
    .label = 导入旧插件的阅读记录…
menu-export-json =
    .label = 导出阅读记录（JSON）…
menu-export-csv =
    .label = 导出阅读记录（CSV）…
menu-import =
    .label = 导入阅读记录（JSON / CSV）…
status-menu-new =
    .label = 未读
status-menu-to-read =
    .label = 待读
status-menu-in-progress =
    .label = 在读
status-menu-read =
    .label = 已读
status-menu-not-reading =
    .label = 不读
status-menu-clear =
    .label = 清除状态
rating-menu-5 =
    .label = ★★★★★
rating-menu-4 =
    .label = ★★★★
rating-menu-3 =
    .label = ★★★
rating-menu-2 =
    .label = ★★
rating-menu-1 =
    .label = ★
rating-menu-clear =
    .label = 清除评级

# ---- batch / dialogs ----
batch-confirm-count = 对 { $count } 个条目执行？
batch-cancel-hint = 点击此窗口可中止
batch-cancelled = 已中止：完成 { $ok } 个，剩余 { $left } 个未改动
clear-reading-confirm = 从 Zest 数据库删除 { $count } 个条目的阅读记录（每页 / 每日时长）？此操作不可撤销。Extra 中的评级与阅读状态不受影响。

export-title = 导出阅读记录
export-nothing = 还没有可导出的阅读记录
export-done = 已导出 { $count } 个条目的阅读记录
import-title = 导入阅读记录
import-mode-question = 找到 { $count } 条记录。如何与现有数据合并？
import-mode-max = 合并（取较大值）
import-mode-sum = 累加
import-parse-failed = 无法读取文件：{ $error }
import-nothing = 该文件中没有阅读记录
import-result = 已导入 { $count } 个条目 · 共 { $hours } 小时 · 跳过 { $skipped } 项（其中 { $ambiguous } 项有多个匹配）
import-write-failed = 阅读数据未能保存。已完成的条目会保留；请检查数据目录后，使用“取较大值”重试。{ $error }

migrate-title = 导入旧插件的阅读数据
migrate-scanning = 正在扫描各文库中的“Addon Item”/“ZoteroStyle”笔记与 JSON 文件…
migrate-nothing = 未找到旧版阅读记录（扫描了 { $parents } 个旧版载体条目、{ $notes } 条笔记）。
migrate-done = 已合并 { $merged } 个条目 · 共 { $hours } 小时
migrate-report-line = 旧版载体条目：{ $parents } · 笔记：{ $notes } · 解析成功：{ $parsed } · 跳过：{ $skipped } · 文件：{ $files } · 修正页码偏移：{ $offset } · 未能定位的条目：{ $unresolved } · 已合并：{ $merged }（{ $hours } 小时）
migrate-legacy-kept = 旧版笔记与文件原样保留，未做任何修改；确认无误后可自行把“Addon Item”移入回收站。

db-unavailable = Zest 无法打开阅读数据库（zest.sqlite）。阅读时长暂存在内存中，数据库可用后会自动写入；详情见错误控制台。

# ---- graph ----
graph-title = 图谱
graph-mode-related = 相关
graph-mode-related-tip = 按 Zotero「相关」关联的条目
graph-mode-author = 作者
graph-mode-author-tip = 共享作者的条目
graph-mode-tag = 标签
graph-mode-tag-tip = 共享标签的条目
graph-mode-collection = 分类
graph-mode-collection-tip = 同属一个分类的条目
graph-reanalyse = 重新分析
graph-fit = 适配视图
graph-fit-tip = 显示完整图谱，不改变节点布局
graph-reanalyse-tip = 用当前列表里的条目重建图谱
graph-close = 关闭图谱
graph-building = 正在构建…
graph-failed = 图谱构建失败——详见错误控制台
graph-status = { $items } 个条目 · { $nodes } 个节点 · { $edges } 条连线
graph-status-truncated = { $items } 个条目 · { $nodes } 个节点 · { $edges } 条连线（已保留连接最多的部分）
graph-status-isolated = { $count } 个无关联条目未显示
graph-menu-show = 在文库中显示
graph-menu-open = 打开
graph-menu-center = 以此条目为中心
menu-graph =
    .label = 图谱面板

# ---- nested tag tree ----
tags-sort-tip = 排序方式——点击切换
tags-sort-az = 排序：标签 A→Z
tags-sort-za = 排序：标签 Z→A
tags-sort-freq-desc = 排序：使用最多在前
tags-sort-freq-asc = 排序：使用最少在前
tags-collapse-tip = 全部展开 / 全部折叠
tags-clear-tip = 清除标签筛选
tags-tab-tree = 嵌套
tags-tab-all = 全部
tags-tree-toggle =
    .label = 嵌套标签树
tags-search-placeholder = 筛选标签
tags-empty = 没有符合当前规则的标签
tags-selected = 已选 { $count } 项
tags-row-tip = { $path } · { $items } 个条目 · 该分支下 { $tags } 个标签
tags-menu-rename = 重命名整个分支…
tags-menu-copy = 复制本层标签
tags-menu-copy-full = 复制完整标签
tags-menu-color = 颜色
tags-menu-color-clear = 取消颜色
tags-menu-emoji = Emoji…
tags-menu-rule-clear = 删除 Zest 规则
tags-menu-delete = 删除标签…
tags-rename-title = 重命名标签分支
tags-rename-label = { $count } 个标签的新前缀
tags-rename-confirm = 重命名 { $count } 个标签？
tags-rename-confirm-merge = 重命名 { $count } 个标签？其中 { $merges } 个在新名称下已存在，将被**合并**且不可撤销。
tags-delete-confirm = 从本文库删除「{ $path }」下的 { $count } 个标签？此操作不可撤销。
tags-emoji-title = 标签 Emoji
tags-emoji-label = 显示在该分支前的 Emoji（留空则移除）
menu-tagtree =
    .label = 嵌套标签树

# ---- annotation cards ----
anno-section-header =
    .label = 标注定位
anno-section-sidenav =
    .tooltiptext = Zest 标注定位
anno-page = 第 { $page } 页
anno-copy = 复制文本
anno-card-tip = 双击在阅读器中打开这条标注
anno-no-text = { $type } 类标注——双击在原文中查看
anno-empty-no-attachment = 该条目没有 PDF / EPUB 附件
anno-empty-no-annotation = 还没有标注
anno-empty-filtered = 没有标注符合标签树中选中的标签

# ---- journal rank columns ----
column-pubtags = 期刊标签
column-if = 影响因子
column-venue = 期刊 / 来源
if-cell-tip = { $field } = { $value }（来源：{ $source }）
rank-badge-tip = { $value }（字段：{ $field }；来源：{ $source }）
rank-category-medicine = 医学
rank-category-medicine-short = 医学
rank-category-internal-medicine = 医学：内科
rank-category-internal-medicine-short = 医学：内科
rank-category-clinical-medicine = 临床医学
rank-category-clinical-medicine-short = 临床医学
rank-category-multidisciplinary = 综合性期刊
rank-category-multidisciplinary-short = 综合性期刊
rank-category-general-medicine-health = 综合性医疗卫生
rank-category-general-medicine-health-short = 综合性医疗卫生
rank-category-mathematics = 数学
rank-category-mathematics-short = 数学
rank-category-physics-astronomy = 物理与天体物理
rank-category-physics-astronomy-short = 物理与天体物理
rank-category-chemistry = 化学
rank-category-chemistry-short = 化学
rank-category-materials-science = 材料科学
rank-category-materials-science-short = 材料科学
rank-category-geosciences = 地球科学
rank-category-geosciences-short = 地球科学
rank-category-environment-ecology = 环境科学与生态学
rank-category-environment-ecology-short = 环境科学与生态学
rank-category-agriculture-forestry = 农林科学
rank-category-agriculture-forestry-short = 农林科学
rank-category-engineering-technology = 工程技术
rank-category-engineering-technology-short = 工程技术
rank-category-biology = 生物学
rank-category-biology-short = 生物学
rank-category-social-sciences = 社会科学
rank-category-social-sciences-short = 社会科学
rank-category-management = 管理学
rank-category-management-short = 管理学
rank-value-cas-zone-short = { $category }{ $zone }区
rank-value-cas-upgraded-zone-long = 中科院期刊分区表（升级版）——{ $category }{ $zone }区
rank-value-cas-basic-zone-long = 中科院期刊分区表（基础版）——{ $category }{ $zone }区
rank-value-category-zone-short = { $category }{ $zone }区
rank-value-category-zone-long = { $category }{ $zone }区
rank-value-zone-short = { $zone }区
rank-value-zone-long = { $zone }区
rank-value-cas-grade-short = { $category }{ $grade }
rank-value-cas-grade-long = 中科院期刊分区表——{ $category }{ $grade }
rank-value-category-grade-short = { $category }{ $grade }
rank-value-category-grade-long = { $category }{ $grade }
rank-value-class = { $grade }类
rank-value-core-collection = 核心库
rank-value-china-st-core = 中国科技核心期刊
rank-value-national-tier-one = 国内一级学术期刊
rank-value-first-class-discipline = 学科群一流期刊
rank-value-premier-journal = 超一流期刊
rank-value-top-journal = 顶尖期刊
rank-menu-refresh =
    .label = 刷新所选条目的期刊数据

# ---- view groups ----
views-menu = Zest 视图
views-empty = 还没有保存的视图
views-add = 把当前列布局保存为视图…
views-add-label = 为这套列布局起个名字
views-update = 用当前布局更新某个视图
views-delete = 删除视图
views-delete-confirm = 删除视图「{ $name }」？当前的列布局不会改变。
views-restore = 恢复切换前的列布局
views-untitled = 新视图
views-previous = 上一次的布局

# ---- settings pane (rendered from JS) ----
pref-key-save = 保存
pref-rank-clear = 清空分级缓存
pref-dataset-import = 导入数据集…
pref-config-export = 导出配置…
pref-config-import = 导入配置…
pref-key-plaintext = 以明文存储：无法使用登录管理器
pref-key-saved = 密钥已存入登录管理器
pref-key-stored = 已保存一个密钥（存在系统登录管理器里，这里不回显）。点进输入框直接输入即可替换；清空后保存即删除。
pref-key-none = 还没有保存密钥
pref-key-testing = 正在检查…
pref-key-valid = 密钥有效（{ $detail }）
pref-key-invalid = 服务拒绝了这个密钥——填错或已过期
pref-key-rate = 服务正在限流，密钥不一定有问题——过一分钟再试
pref-key-network = 连不上服务（离线、代理或被拦截）
pref-datasets-empty = 还没有导入本地数据集
pref-dataset-remove = 移除
pref-dataset-empty = 该文件中没有可用的数据行
pref-dataset-import-done = 已导入「{ $name }」：{ $rows } 本期刊、{ $fields } 个字段
pref-views-empty = 还没有保存的列视图
pref-view-rename = 重命名
pref-view-remove = 删除
pref-config-export-done = 已导出 { $prefs } 项设置、{ $views } 个视图、{ $rules } 条标签规则
pref-config-import-done = 已导入 { $prefs } 项设置 · { $views } 个视图 · { $rules } 条标签规则 · 跳过 { $skipped } 项
pref-rank-cleared = 已清空期刊缓存

# ---- author columns ----
column-authors = 作者
column-first-author = 第一作者
column-last-author = 末位作者
authors-cell-tip = 共 { $count } 位作者
authors-import-done = 已从 better-authors 导入：{ $applied }；未能对应：{ $skipped }
menu-authors-import =
    .label = 导入 better-authors 设置

# ---- citation counts ----
column-citations = 被引数
citations-cell-tip = 被引 { $count } 次 · 来源 { $source } · { $date }
menu-citations-update =
    .label = 更新被引数
menu-citations-update-stale =
    .label = 更新过期的被引数
citations-done = 已更新 { $updated } 条 · 未变 { $unchanged } 条 · 无标识符 { $missing } 条 · 失败 { $failed } 条
citations-none = 所选条目都没有 DOI 或 PMID

# ---- remark ----
column-remark = 简记
remark-tip = 双击编辑这条一行简记（存在 Extra 字段里）
remark-prompt = 一句话记下这篇的要点

# ---- literature info panel ----
info-section-header =
    .label = Zest
info-section-sidenav =
    .tooltiptext = Zest——阅读、分区、被引
info-authors = 作者
info-authors-all = 全部 { $count } 位
info-author-first = 一作
info-author-corresponding = 通讯
info-author-last = 末位
info-author-last-tip = 没有明确通讯标记，按条目作者列表中的最后一位展示
info-affiliation-first = 第一作者
info-affiliation-corresponding = 通讯作者
info-affiliation-last = 末位作者
info-authorships-fetch = 补全作者信息
info-affiliations-all = 全部 { $count } 家
info-rating-set = 设为 { $rating } 星
info-rating-save-failed = 评级未保存成功，请稍后重试。
info-remark-save-failed = 简记未保存成功，输入已保留；编辑后可再次保存。
info-title = 标题
info-abstract = 摘要
info-workspace = 阅读与简记
info-collapse = 收起
info-abstract-fetch = 获取摘要
info-abstract-read-all = 阅读完整摘要
info-abstract-complete = 查找完整摘要
info-abstract-fetch-tip = 按 DOI / PMID 查找 Europe PMC、PubMed 或 Crossref 摘要
info-abstract-loading = 正在获取…
info-abstract-source-link = 查看来源
info-abstract-missing = 暂未找到摘要。
info-abstract-throttled = 来源请求过于频繁，请稍后重试。
info-abstract-offline = 暂时无法连接摘要来源，请检查网络后重试。
info-abstract-error = 未能核验或读取来源摘要，请稍后重试。
info-abstract-translate = 翻译
info-abstract-translating = 翻译中…
info-abstract-original = 原文
info-abstract-translation-source = 译文 · { $source }
info-abstract-translate-tip = 翻译为中文 · { $source }
info-abstract-translation-throttled = 翻译请求过于频繁，请稍后重试。
info-abstract-translation-error = 翻译暂不可用，请重试。
info-affiliations = 机构
info-affiliations-fetch = 获取机构信息
info-affiliations-fetch-tip = 将此条目的 DOI 发送到 OpenAlex，查询作者机构
info-affiliations-loading = 正在获取…
info-affiliations-unavailable = 暂未获取到机构信息，可稍后重试。
info-venue = 期刊 / 来源
info-citations = 被引数
info-citations-none = 尚未获取
info-refresh = 刷新
info-reading = 阅读
info-reading-value = { $time } · 已看 { $pages } / { $total } 页
info-reading-none = 还没有阅读记录
info-status = 状态
info-status-none = 未设置
info-open = 在其它平台打开
info-heat-tip = 跳到第 { $page } 页

# ---- reading statistics ----
menu-stats =
    .label = 阅读统计…
stats-title = 阅读统计
stats-total = 累计时长
stats-days = 有阅读的天数
stats-streak = 当前连续天数
stats-longest = 最长连续天数
stats-items = 读过的条目
stats-best = 单日最多
stats-top = 读得最多
stats-pages = { $pages } 页
stats-nothing = 没有阅读
stats-source-note = 数据来自 Zotero 数据目录下的 zest.sqlite——与「设置 → Zest → 阅读数据」里可导出的是同一份记录。

# ---- annotation matrix ----
menu-matrix =
    .label = 标注矩阵…
matrix-title = 标注矩阵
matrix-search-placeholder = 搜索正文、批注、标签——空格为「且」，| 为「或」，-词 为排除
matrix-all-colors = 全部颜色
matrix-all-tags = 全部标签
matrix-count = 显示 { $shown } / { $total }
matrix-export-csv = 导出 CSV
matrix-export-md = 导出 Markdown
matrix-col-item = 条目
matrix-col-page = 页
matrix-col-text = 标注
matrix-col-tags = 标签
matrix-truncated = 仅显示前 { $shown } 条（共 { $total } 条）——请缩小搜索范围

# ---- vertical tabs ----
menu-tabs =
    .label = 垂直标签页
tabs-search = 筛选标签页
tabs-menu = 会话与选项
tabs-empty = 没有打开的标签页
tabs-untitled = 未命名
tabs-close = 关闭
tabs-close-others = 关闭其它标签页
tabs-close-right = 关闭右侧标签页
tabs-show-in-library = 在文库中显示
tabs-move-to-group = 移入分组
tabs-new-group = 新建分组…
tabs-group-default = 分组
tabs-group-name = 分组名称
tabs-ungroup = 移出分组
tabs-group-rename = 重命名分组…
tabs-group-delete = 删除分组
tabs-save-session = 保存当前标签页集合…
tabs-session-name = 为这组标签页起个名字
tabs-restore-session = 重新打开已保存的集合
tabs-session-delete = 删除
tabs-hide-native = 隐藏 Zotero 自带的标签栏
tabs-close-sidebar = 关闭侧栏
tabs-restore-confirm = 重新打开 { $count } 个文档？每个都会打开一个阅读器标签页。

# Accent presets (settings pane swatches)
pref-accent-preset-green = GitHub 绿
pref-accent-preset-teal = 青
pref-accent-preset-violet = 紫
pref-accent-preset-wood = 陶土
pref-accent-preset-grey = 石墨
config-damaged = 无法读取 zest-config.json——视图组、标签规则与数据集暂不可用，Zest 不会覆盖该文件。请修复或移除它后重启 Zotero。
tags-tree-label = 嵌套标签树
views-recommended = Zest 布局
menu-layout =
    .label = 套用 Zest 推荐列布局
menu-rank-fetch =
    .label = 联网获取期刊数据（分区 / 影响因子）
rank-offline-tip = 「期刊标签」和「影响因子」需要联网查询期刊数据。点工具栏的 Zest 按钮 ▸「联网获取期刊数据」开启；查询按期刊进行，只发送期刊名、ISSN 或 DOI，结果缓存在本地。中科院分区、北大核心等中文体系还需要在设置里填 easyScholar 密钥。
rank-empty-tip = 尚未查到这本期刊的分级数据。右键该单元格可单独重新查询；中科院分区、北大核心等中文体系需要 easyScholar 密钥。

# ---- author menu ----
author-click-tip = 点击：在文库中筛选，或在线搜索
author-menu-filter = 在文库中筛选其文章
author-menu-clear = 清除作者筛选
author-menu-scholar = 在 Google Scholar 搜索
author-menu-pubmed = 在 PubMed 搜索
author-menu-openalex = 在 OpenAlex 打开
author-menu-s2 = 在 Semantic Scholar 搜索
author-filter-toast = 已筛选：{ $name } 共 { $count } 篇（切换分类即恢复）
author-filter-none = 未能在文库中定位 { $name }

# ---- graph author roles ----
graph-empty = 当前范围没有可显示的关联
graph-empty-hint = 可切换关联方式、降低共享阈值，或显示更多文献。
graph-canvas-help = 拖动节点或空白处 · Ctrl/⌘ + 滚轮缩放
graph-filter-modes = 关联方式
graph-filter-roles = 作者范围
graph-filter-shared = 共享条目阈值
graph-roles-firstlast = 一作+通讯
graph-roles-firstlast-tip = 只看第一作者与末位作者（通讯位惯例）——中间作者不进入图谱
graph-roles-all = 全部作者
graph-roles-all-tip = 所有署名作者都进入图谱
graph-min-tip = 至少 { $count } 篇条目共享的作者 / 标签 / 分类才显示
config-damaged-backup = 配置文件损坏，已备份为 { $name }；本次从空白配置开始，新的修改会正常保存
migrate-idmatch-confirm = 有 { $count } 条旧记录按本机数据库编号匹配条目——仅在同一台机器、同一配置下可靠；换过机器或重建过数据库会把阅读时长算到无关条目上。仍要导入这些记录吗？（取消则跳过它们，其余照常导入）
tags-rename-skipped = { $count } 个标签的显示名无法对应回原始标签，已跳过
