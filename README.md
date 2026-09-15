# Zest

**简体中文** · [English](README.en.md)

把阅读记录、文献信息与整理工具带进 Zotero。

Zest 是面向 **Zotero 10** 的开源插件：在条目列表中显示阅读时长、状态、评级与期刊数据，
在侧边栏集中查看文献信息、引用键和摘要，并提供标注矩阵、文库关系图与阅读统计。

[下载插件](https://github.com/yimmy23/zotero-zest/releases/latest) ·
[使用教程](docs/guide.zh-CN.md) ·
[问题反馈](https://github.com/yimmy23/zotero-zest/issues)

## 界面预览

以下为项目已有界面截图，展示阅读列与文献整理布局；具体菜单与外观以当前版本为准。

![Zest 条目列表与阅读布局示例](https://github.com/user-attachments/assets/e0f74c95-d707-4da9-9e75-b18559bbd1ce)

## 主要功能

| 功能             | 用途                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| 阅读记录         | 记录前台阅读时长与每页停留情况，显示阅读热力条                                    |
| 状态、评级与简记 | 在列表或 Zest 面板中管理阅读状态、星级和一行备注                                  |
| 文献信息面板     | 集中展示作者、机构、期刊数据、引用键、摘要与外部链接                              |
| 期刊数据         | 支持本地数据集、easyScholar 与 OpenAlex；默认优先新锐分区，中科院历史分区作为备选 |
| 引用与标注       | 手动更新被引数，筛选、定位、复制和导出文献标注                                    |
| 阅读统计         | 查看目标进度、阅读趋势、年度热力图与成就                                          |
| 文库关系图       | 按条目关联、作者、标签或分类查看本地文献关系                                      |
| 标签与布局       | 嵌套标签树、可保存的列视图与可配置作者列                                          |
| 垂直标签页       | 固定文库入口、文档分组和已保存的标签页集合                                        |

功能可按需启用。嵌套标签树、垂直标签页及期刊自动联网默认关闭；
阅读记录与 Zest 条目信息面板默认开启。

## 环境要求

- **Zotero 10.x**；不支持 Zotero 7 或 8。
- 核心阅读与整理功能可在本地使用。
- 在线数据与翻译需要能访问相应服务；部分来源需要另行配置密钥。

## 安装

1. 从 [最新 Release](https://github.com/yimmy23/zotero-zest/releases/latest) 下载 `zest.xpi`。
2. 打开 Zotero 的 **工具 → 插件**，在齿轮菜单中选择 **Install Plugin From File…**，选中下载的文件。
3. 按提示重启 Zotero。
4. 点击条目列表工具栏的 **Z** 按钮，选择 **套用 Zest 推荐列布局**。

详细设置、数据来源与常见问题见[中文使用教程](docs/guide.zh-CN.md)。

## 文档

- [中文使用教程](docs/guide.zh-CN.md)：从首次布局到阅读、标注、期刊数据与备份。
- [English guide](docs/guide.en.md)：英文使用教程。
- [只读 API](src/api.ts)：供模板与脚本调用的 `Zotero.Zest.api`。
- [开发约定](AGENTS.md)：代码结构、数据边界与开发验证流程。
- [Releases](https://github.com/yimmy23/zotero-zest/releases)：版本更新记录与下载。

## 数据与联网

阅读时长保存在 Zotero 数据目录下的 `zest.sqlite`，**不会自动随 Zotero 同步**。
跨设备转移阅读记录需要手动导出与导入。

手动设置的状态、评级和简记保存在条目 `Extra` 中，可随 Zotero 条目同步。
引用键只读取已有值，Zest 不生成或改写引用键。

期刊自动查询和作者机构自动查询默认关闭；作者图谱恢复时使用本地数据与缓存，
需要联网补充身份时由你点击操作。摘要获取、翻译和被引数更新也有单独的手动入口。

[教程中的数据说明](docs/guide.zh-CN.md#data)列出了阅读记录、配置包和期刊数据集的备份方式。

## 从源码构建

需要 Node.js、npm 和 Git；依赖版本由 [package-lock.json](package-lock.json) 固定。

```bash
git clone https://github.com/yimmy23/zotero-zest.git
cd zotero-zest
npm ci
npm run build
```

构建产物位于 `.scaffold/build/zest.xpi`。

### 开发与检查

```bash
npm run test:unit
npm run lint:check
npm start
```

`test:unit` 运行隔离的源码回归测试，不启动 Zotero。
`npm start` 用于配置好的开发实例；开发和原生验证仅使用 `.scaffold/dev-profile`，
不要指向日常文库。具体环境配置与检查流程见[开发约定](AGENTS.md)。

## 反馈与贡献

欢迎通过 [Issues](https://github.com/yimmy23/zotero-zest/issues) 报告问题或提出建议。
请提供 Zotero 与 Zest 版本、操作系统、复现步骤、预期结果和实际结果；
界面问题可附截图，并注明明暗主题及字号。

涉及期刊数据时，可提供公开的刊名、ISSN、DOI 及已启用的数据来源。
请勿上传 API 密钥、私人文库或敏感文献内容。

提交代码前请阅读 [AGENTS.md](AGENTS.md)，保持改动聚焦，并说明相应检查方式。

## 许可

Copyright © 2026 the Zest authors.

本项目采用 **GNU Affero General Public License v3.0 or later**（AGPL-3.0-or-later）。
详见 [LICENSE](LICENSE)。软件按现状提供，不附带任何担保。
