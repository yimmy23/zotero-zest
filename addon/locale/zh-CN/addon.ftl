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
