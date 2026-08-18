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
