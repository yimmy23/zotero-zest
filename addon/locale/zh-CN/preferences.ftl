pref-title = Zest 设置

pref-group-columns = 条目列表列
pref-column-reading =
    .label = 阅读——阅读时长 + 每页热力条
pref-column-status =
    .label = 状态——阅读状态（与 Zotero Reading List 兼容）
pref-column-rating =
    .label = 评级——1～5（存于 Extra；单击即评级，再点当前分值可降一级）
pref-column-tags =
    .label = 标签——彩色 / emoji 标签独立成列
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
pref-statusauto-enable =
    .label = 自动更新阅读状态（开始阅读→在读；看过足够页数→已读）
pref-statusauto-markempty =
    .label = …对还没有状态的条目也生效（会往其 Extra 字段写入 Read_Status）
pref-statusauto-threshold = 看过页数达到 % 时标为已读
pref-statusauto-minminutes = 且至少阅读了 分钟
pref-tracker-storage-hint = 阅读记录保存在 Zotero 数据目录下的 zest.sqlite（不写入文库、不参与同步）。可在下方导出 / 导入。

pref-group-data = 阅读数据
pref-btn-migrate =
    .label = 导入旧版 zotero-style 数据…
pref-btn-export-json =
    .label = 导出 JSON…
pref-btn-export-csv =
    .label = 导出 CSV…
pref-btn-import =
    .label = 导入…

pref-group-about = 关于
pref-about-text = Zest 是对 zotero-style 的从零重写（开源，AGPL-3.0），支持 Zotero 9～10。评级与阅读状态存于条目 Extra 字段；阅读记录存于插件自己的数据库。

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
pref-nested-showall =
    .label = 显示全部标签，包括 Zotero 默认隐藏的标签
pref-nested-childtags =
    .label = 同时匹配附件、笔记与批注上的标签
pref-nested-hint = 该标签树与上方「#标签」列使用相同的匹配规则。

pref-group-rank = 期刊分级
pref-column-pubtags =
    .label = 分级标签——期刊分区 / 分级徽章独立成列
pref-column-if =
    .label = IF——影响因子进度条独立成列
pref-column-venue =
    .label = 期刊——发表期刊名独立成列
pref-rank-fields = 字段
pref-rank-fields-hint = 逗号分隔，如 sciUp, sciif, sci；未配置 easyScholar 密钥时回退为 OpenAlex 的两年平均被引率
pref-rank-sortby = 排序依据
pref-rank-sortby-hint = 如 sci, -sciif；前缀「-」表示降序；缺失该字段的条目始终排在最后
pref-rank-map = 字段映射
pref-rank-map-hint = 每行一条规则，或用逗号分隔，如 sciif=IF、/^Q([1-4])$/=Q$1；右侧留空则隐藏该值
pref-rank-colors = 分级颜色
pref-rank-colors-hint = 5 个逗号分隔的十六进制颜色，从最高分级到最低，默认 #EE0000, #2F998C, #D2A500, #DA6D00, #007BF6
pref-rank-defaultcolor = 默认颜色（未匹配到分级时使用）
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
pref-if-max = 进度条上限
pref-if-progress =
    .label = 以进度条显示 IF
pref-if-info =
    .label = 以文字显示 IF 数值
pref-if-color = 进度条颜色

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
pref-annots-color = 颜色
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

pref-group-reader = 阅读器
pref-reader-schemes =
    .label = 启用 Zest 阅读器配色方案
pref-themes-install =
    .label = 安装主题
pref-themes-remove =
    .label = 移除主题
pref-reader-hint = 三套预设主题会写入 Zotero 自带的阅读器主题列表，可在阅读器「外观」菜单中选用。

pref-group-config = 配置
pref-config-export =
    .label = 导出配置…
pref-config-import =
    .label = 导入配置…
pref-config-hint = 配置包包含偏好设置、视图、标签规则与数据集元数据，但绝不含 API 密钥。

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
