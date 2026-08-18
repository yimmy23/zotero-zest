pref-title = Zest 设置

pref-group-columns = 条目列表列
pref-column-reading =
    .label = 阅读——阅读时长 + 每页热力条
pref-column-status =
    .label = 状态——阅读状态（与 Zotero Reading List 兼容）
pref-column-rating =
    .label = 评级——1～5 星（存于 Extra）
pref-column-tags =
    .label = 标签——彩色 / emoji 标签独立成列
pref-tags-hide-in-title =
    .label = 隐藏标题列里的标签色点
pref-column-texttags =
    .label = #标签——按规则匹配的标签以文字徽章显示
pref-texttags-match = 匹配规则
pref-texttags-match-hint = “#” = 以 # 开头的标签，显示时去掉 # · “~~/” = 不以 / 开头的全部标签 · “/^#(.+)/” = 正则，显示捕获组
pref-texttags-color = 默认徽章颜色（标签已设 Zotero 颜色时优先用它）

pref-group-heat = 阅读热力
pref-titledecor-heat =
    .label = 同时把阅读热力画在标题底纹
pref-titledecor-unread =
    .label = 未读条目标题加粗（无状态 / 未读 / 待读）
pref-heat-color = 颜色
pref-heat-opacity = 不透明度（0.1～1）

pref-group-tracker = 阅读记录
pref-tracker-enable =
    .label = PDF/EPUB 打开且处于前台时按页记录阅读时长
pref-tracker-idle = 无键鼠输入超过多少秒后停止计时
pref-statusauto-enable =
    .label = 自动更新阅读状态（开始阅读→在读；看过足够页数→已读）
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
