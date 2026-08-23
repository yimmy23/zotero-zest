pref-group-columns = 条目列表列
pref-column-reading =
    .label = 阅读——阅读时长 + 每页热力条
pref-column-status =
    .label = 状态——阅读状态：实心点是你设置的，空心圈是按阅读记录判定的（点圆点可修改）
pref-column-rating =
    .label = 评级——1～5（存于 Extra；单击即评级，再点当前分值可降一级）
pref-column-tags =
    .label = 标签——彩色 / emoji 标签独立成列、可排序（Zotero 本身已在标题列显示色点；此列用于排序和把色点从标题里移走）
pref-tags-hide-in-title =
    .label = 隐藏标题列里的标签色点
pref-column-texttags =
    .label = #标签——按规则匹配的标签以文字徽章显示
pref-texttags-match = 匹配规则
pref-texttags-match-hint = “#” = 以 # 开头的标签，显示时去掉 # · “~~/” = 不以 / 开头的全部标签（多个字符 = 都不以其开头）· “/^#(.+)/” = 正则；有捕获组显示捕获组，没有则显示整个标签
pref-texttags-color = 默认徽章颜色（标签已设 Zotero 颜色时优先用它）
pref-texttags-textcolor = 文字颜色（auto = 由徽章色自动取可读深浅，或填 CSS 颜色）
pref-rating-mark = 评级符号
pref-rating-option = 空位符号
pref-rating-color = 颜色（留空 = 主题强调色）
pref-rating-key = Extra 键名
pref-extra-strip =
    .label = 导出文献（BibTeX、RIS 等）时不带 Read_Status / 评级行

pref-group-heat = 阅读热力
pref-titledecor-heat =
    .label = 同时把阅读热力画在标题底纹
pref-titledecor-unread =
    .label = 未读条目标题加粗（状态为「未读」或「待读」）
pref-titledecor-unread-empty =
    .label = …没有任何状态的条目也算未读
pref-heat-color = 颜色
pref-heat-opacity = 不透明度（0.1～1）

pref-group-tracker = 阅读记录
pref-tracker-enable =
    .label = PDF/EPUB 打开且处于前台时按页记录阅读时长
pref-tracker-idle = 无键鼠输入超过多少秒后停止计时
pref-status-derive =
    .label = 未设置状态时自动判定：按阅读记录与 Zotero 自己的最近阅读标记得出 未读 / 在读 / 已读（不写入任何字段；手动设置的状态永远优先）
pref-statusauto-enable =
    .label = 同时写入 Extra（开始阅读→在读；看过足够页数→已读）——随同步走，Zotero Reading List 也能看到
pref-statusauto-markempty =
    .label = …对还没有状态的条目也生效（会往其 Extra 字段写入 Read_Status）
pref-statusauto-threshold = 看过页数达到 % 时标为已读
pref-statusauto-minminutes = 且至少阅读了 分钟
pref-tracker-storage-hint = 阅读记录保存在 Zotero 数据目录下的 zest.sqlite（不写入文库、不参与同步）。可在下方导出 / 导入。

pref-group-data = 阅读数据
pref-btn-migrate =
    .label = 导入旧插件的阅读数据…
pref-btn-export-json =
    .label = 导出 JSON…
pref-btn-export-csv =
    .label = 导出 CSV…
pref-btn-import =
    .label = 导入…

pref-group-about = 关于
pref-about-text = Zest 把「阅读」放进条目列表：阅读时长、看过哪些页、状态、评级与期刊分区。评级与阅读状态存在条目的 Extra 字段（随 Zotero 同步，卸载后仍在）；阅读记录存在 Zotero 数据目录下插件自己的数据库中。开源，AGPL-3.0-or-later。

pref-group-tags = 嵌套标签树
pref-nested-show =
    .label = 显示嵌套标签树，取代 Zotero 自带的标签选择器（也可从「工具 ▸ Zest」切换）
pref-nested-link = 嵌套分隔符
pref-nested-sort = 排序方式
pref-nested-sort-az =
    .label = A → Z
pref-nested-sort-za =
    .label = Z → A
pref-nested-sort-freq-desc =
    .label = 使用频次（高到低）
pref-nested-sort-freq-asc =
    .label = 使用频次（低到高）
pref-nested-childtags =
    .label = 同时匹配附件、笔记与批注上的标签
pref-nested-hint = 该标签树与上方「#标签」列使用相同的匹配规则；是否显示本文库全部标签，跟随 Zotero 标签选择器菜单里自带的「显示此文库中的所有标签」开关。

pref-group-rank = 期刊分级
pref-column-pubtags =
    .label = 分级标签——期刊分区 / 分级徽章独立成列
pref-column-if =
    .label = IF——影响因子独立成列
pref-column-venue =
    .label = 期刊 / 来源——一列显示期刊名 / 会议名 / 书名 / 出版者，按条目类型取（Zotero 自带的「出版物」列只有期刊名）
pref-rank-fields = 字段
pref-rank-fields-hint = 逗号分隔，如 sciUp, sciif, sci；未配置 easyScholar 密钥时回退为 OpenAlex 的两年平均被引率
pref-rank-sortby = 排序依据
pref-rank-sortby-hint = 如 sci, -sciif；前缀「-」表示降序；缺失该字段的条目始终排在最后
pref-rank-map = 字段映射
pref-rank-map-hint = 每行一条规则，或用逗号分隔，如 sciif=IF、/^Q([1-4])$/=Q$1；右侧留空则隐藏该值
pref-rank-colors = 分级颜色
pref-rank-colors-hint = 5 个逗号分隔的十六进制颜色，从最高分级到最低，默认 #EE0000, #2F998C, #D2A500, #DA6D00, #007BF6
pref-rank-defaultcolor = 默认颜色（未匹配到分级时使用；自动 = 内置青色）
pref-rank-textcolor = 文字颜色（auto 或 CSS 颜色）
pref-rank-opacity = 不透明度
pref-rank-ttl = 缓存天数
pref-rank-easyscholar =
    .label = 从 easyScholar 获取分级数据
pref-rank-openalex =
    .label = 从 OpenAlex 获取分级数据
pref-rank-autofetch =
    .label = 显示条目时自动抓取（关闭则仅按需抓取）
pref-key-label = easyScholar 密钥
pref-key-save =
    .label = 保存
pref-key-hint = 密钥保存在系统登录管理器中，不随偏好设置同步。可在 easyscholar.cc 免费申请密钥。
pref-rank-clear =
    .label = 清空分级缓存
pref-if-field = IF 字段
pref-if-max = 刻度上限（热力最深一档 / 进度条满格）
pref-if-style = 显示方式
pref-if-style-heat =
    .label = 热力——数字底下一层色块，IF 越高越深（分档：上限的 1/15、1/5、1/2、上限）
pref-if-style-bar =
    .label = 进度条——按刻度上限线性显示
pref-if-style-none =
    .label = 只显示数字
pref-if-info =
    .label = 以文字显示 IF 数值
pref-if-color = 颜色（自动 = 主色）

pref-group-datasets = 本地期刊数据集
pref-dataset-import =
    .label = 导入数据集…
pref-datasets-hint = CSV / JSON 文件，至少包含 name 列或 issn 列之一，其余每一列都会作为字段导入；本地数据集优先于在线数据源。

pref-group-annots = 标注
pref-column-annots =
    .label = 标注——批注数量独立成列
pref-annots-style = 样式
pref-annots-style-bar =
    .label = 条形
pref-annots-style-stack =
    .label = 堆叠
pref-annots-style-circle =
    .label = 圆形
pref-annots-color = 颜色（自动 = 主色；堆叠样式保留各高亮自己的颜色）
pref-color-auto =
    .label = 恢复自动
pref-annots-hint = 默认关闭——开启后首次排序会扫描每一个附件，较耗时。

pref-group-views = 视图组
pref-views-hint = 视图的保存与应用均在列表头右键菜单的「Zest views」中进行。

pref-group-graph = 图谱
pref-graph-visible =
    .label = 在条目列表下方显示图谱面板
pref-graph-mode = 模式
pref-graph-mode-related =
    .label = 相关条目
pref-graph-mode-author =
    .label = 作者
pref-graph-mode-tag =
    .label = 标签
pref-graph-mode-collection =
    .label = 分类
pref-graph-height = 面板高度（像素）
pref-graph-maxnodes = 最大节点数

pref-group-collections = 分类计数
pref-collections-enable =
    .label = 在分类旁显示条目数量
pref-collections-mode = 计数方式
pref-collections-mode-0 =
    .label = 本分类下的条目
pref-collections-mode-1 =
    .label = 含子分类
pref-collections-mode-2 =
    .label = 两者都显示

pref-group-config = 配置
pref-config-export =
    .label = 导出配置…
pref-config-import =
    .label = 导入配置…
pref-config-hint = 配置包包含偏好设置、视图、标签规则与数据集元数据，但绝不含 API 密钥。


pref-group-authors = 作者列
pref-column-authors =
    .label = 作者——格式化后的作者列（Zotero 原生 Creator 列保持不变）
pref-column-first-author =
    .label = 第一作者
pref-column-last-author =
    .label = 末位作者
pref-authors-preset = 显示方式
pref-authors-preset-all =
    .label = 全部作者
pref-authors-preset-first =
    .label = 仅第一作者
pref-authors-preset-last =
    .label = 仅末位作者
pref-authors-preset-firstlast =
    .label = 前 N 位 … 末位
pref-authors-preset-first3 =
    .label = 前 N 位后加 et al.
pref-authors-preset-advisor =
    .label = 学位论文导师
pref-authors-count = N
pref-authors-order = 姓名顺序
pref-authors-order-auto =
    .label = 自动（中日韩姓在前，拉丁名在前）
pref-authors-order-given =
    .label = 名在前
pref-authors-order-family =
    .label = 姓在前
pref-authors-given = 名
pref-authors-given-full =
    .label = 全名
pref-authors-given-initials =
    .label = 首字母
pref-authors-given-none =
    .label = 不显示
pref-authors-marklast =
    .label = 标记末位作者（通常是通讯作者）
pref-authors-separator = 分隔符
pref-authors-etal = 「等」文案
pref-authors-omitted = 省略标记
pref-authors-self = 高亮我的名字
pref-authors-hint = 标记与正文分开渲染，不会影响排序。分隔符留空 = 按相邻两名的文字系统自动决定（王小明、李雷，但 王小明, John Smith）；「等」文案留空 = 用 Zotero 自身语言；省略标记用在「前 N 位 … 末位」预设的中间。

pref-group-citations = 被引数
pref-column-citations =
    .label = 被引数——数值保存在条目的 Extra 字段
pref-cite-crossref =
    .label = Crossref（免密钥，需要 DOI）
pref-cite-openalex =
    .label = OpenAlex（免密钥）
pref-cite-s2 =
    .label = Semantic Scholar（有密钥更稳定）
pref-s2key-label = Semantic Scholar 密钥
pref-s2key-hint = 可留空：不带密钥也能查，只是共享限流（约每秒 1 次），批量更新容易被拒。密钥在 semanticscholar.org/product/api 免费申请，和 easyScholar 密钥一样存在系统登录管理器里，不进偏好设置、不随同步走。
pref-cite-stale = 超过多少天视为过期
pref-cite-hint = 只有你主动触发时才会联网获取（条目右键 → Zest ▸ 更新被引数）。其它插件写下的 GSCC / ZSCC / openalex 行会被读取并替换，不会重复堆积。

pref-group-panel = 条目面板
pref-info-enable =
    .label = 显示 Zest 面板（全部作者一行、期刊与分区、被引、阅读、状态、评级、简记、外部链接）
pref-column-remark =
    .label = 简记列——一行备注，保存在 Extra 字段
pref-panel-hint = 面板里的阅读热力条可以点击：点哪一段就在阅读器里打开对应页码。

pref-group-tabs = 垂直标签页
pref-tabs-sidebar =
    .label = 显示垂直标签页侧栏
pref-tabs-hidenative =
    .label = 显示侧栏时隐藏 Zotero 自带的标签栏
pref-tabs-width = 侧栏宽度
pref-tabs-hint = 标签分组按条目记忆，重启后仍在。若将来 Zotero 改动标签内部实现，侧栏会自动停用并恢复原生标签栏。

pref-group-appearance = 外观
pref-accent-color = 主色
pref-accent-hint = 一个颜色决定 Zest 的全部界面——阅读热力图、徽章、状态圆点、标签树与标签页侧栏。默认避开蓝色：Zotero 选中行用的就是系统选区蓝。
pref-accent-apply =
    .label = 同时用于热力图与徽章
pref-accent-reset =
    .label = 恢复默认绿色
pref-accent-apply-hint = 下面的热力图与 #标签 徽章各自保留独立颜色；这个按钮把主色一并套用到两者。
