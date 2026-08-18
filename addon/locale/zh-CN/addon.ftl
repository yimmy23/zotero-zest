startup-begin = Zest 正在加载
startup-finish = Zest 已就绪

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
status-click-tip = 点击设为：{ $next }

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
    .label = 导入旧版 zotero-style 阅读记录…
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
import-done = 已导入 { $count } 个条目 · 共 { $hours } 小时

migrate-title = 导入旧版 zotero-style 数据
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
graph-reanalyse-tip = 用当前列表里的条目重建图谱
graph-close = 关闭图谱
graph-building = 正在构建…
graph-failed = 图谱构建失败——详见错误控制台
graph-status = { $items } 个条目 · { $nodes } 个节点 · { $edges } 条连线
graph-status-truncated = { $items } 个条目 · { $nodes } 个节点 · { $edges } 条连线（已保留连接最多的部分）
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
tags-switch-tip = 切回 Zotero 原生标签选择器
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
rank-menu-refresh =
    .label = 刷新所选条目的期刊数据
rank-refresh-done = 已更新 { $count } 本期刊
rank-no-key = 未填写 easyScholar 密钥——只使用本地数据集与 OpenAlex

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

# ---- type filter / collection counts ----
menu-typefilter =
    .label = 按条目类型筛选
typefilter-clear =
    .label = 显示全部类型
typefilter-active = 仅显示：{ $types }
typefilter-unavailable =
    .label = 当前 Zotero 版本不支持

# ---- reader themes / colour schemes ----
reader-theme-original = Zotero 原始
reader-theme-sepia = Zest 米黄
reader-theme-eyecare = Zest 护眼绿
reader-theme-graphite = Zest 石墨灰
reader-scheme-menu = Zest 配色方案
reader-scheme-classic = 经典（黄 · 红 · 绿）
reader-scheme-warm = 暖色（橙 · 红 · 洋红）
reader-scheme-cool = 冷色（蓝 · 绿 · 紫）
reader-themes-installed = 已添加 { $count } 个阅读器主题，可在阅读器「外观」菜单中选择
reader-themes-removed = 已移除 { $count } 个 Zest 阅读器主题

# ---- settings pane (rendered from JS) ----
pref-key-save = 保存
pref-rank-clear = 清空分级缓存
pref-dataset-import = 导入数据集…
pref-themes-install = 安装主题
pref-config-export = 导出配置…
pref-config-import = 导入配置…
pref-key-plaintext = 以明文存储：无法使用登录管理器
pref-key-saved = 密钥已存入登录管理器
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
remark-prompt = 一行文字，保存在条目的 Extra 字段

# ---- literature info panel ----
info-section-header =
    .label = Zest
info-section-sidenav =
    .tooltiptext = Zest——阅读、分区、被引
info-authors = 作者
info-venue = 期刊 / 来源
info-citations = 被引数
info-citations-none = 尚未获取
info-refresh = 刷新
info-reading = 阅读
info-reading-value = { $time } · 已看 { $pages } / { $total } 页
info-reading-none = 还没有阅读记录
info-status = 状态
info-status-none = 未设置
info-abstract = 摘要
info-open = 在其它平台打开
info-heat-tip = 跳到第 { $page } 页
