# GetNote Importer（Get笔记导入器）

[![Obsidian 插件](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square)](https://obsidian.md)
[![最新版本](https://img.shields.io/github/v/release/AndyZhengyan/obsidian-getnote-importer?style=flat-square)](https://github.com/AndyZhengyan/obsidian-getnote-importer/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/AndyZhengyan/obsidian-getnote-importer/ci.yml?branch=main&style=flat-square)](https://github.com/AndyZhengyan/obsidian-getnote-importer/actions)
[![许可证](https://img.shields.io/github/license/AndyZhengyan/obsidian-getnote-importer?style=flat-square)](LICENSE)

把 Get笔记里的灵感、摘录、链接、录音和 AI 总结同步进 Obsidian，变成可长期整理、搜索和链接的本地 Markdown 知识库。

GetNote Importer 适合把 Get笔记作为快速捕捉入口、把 Obsidian 作为长期知识库的人。插件会用可读文件名、分类目录、frontmatter、增量更新、选择性同步和同步历史，尽量让导入内容从第一天就能融入你的 vault。

[English version](./README.md)

## 为什么好用

- **文件可读，不是数据堆**：笔记按标题命名、按类型归档。
- **默认增量同步**：没变的不重复写，变了的才更新。
- **同步断点续传**：定时同步自动记录位置，下次从断点继续，不重复处理同一条笔记。
- **需要精细控制时可选**：按需勾选要导入的笔记。
- **后台定时同步**：省心省力。
- **支持录音附件**：API 返回音频和转写时会一并保存。
- **移动端兼容**：使用 Obsidian `requestUrl`，桌面端和移动端都能用。

## Get笔记官方导出有什么问题

Get笔记官方只支持导出为**离线 HTML 文件**：

| Get笔记官方导出 | GetNote Importer |
| --- | --- |
| 导出为离线 HTML（一个大文件） | 同步为独立的 Markdown 文件 |
| 每次最多 10,000 条笔记 | 无硬性上限，增量同步处理任意数量 |
| 手动一次性导出 | 定时自动同步，vault 保持最新 |
| 全量导出，无法选择 | 选择性同步，勾选需要的笔记再导入 |
| 无法增量更新 | 只有变化的笔记才会重新下载 |
| 音频文件需单独处理 | 音频附件自动下载并关联 |

试过在 10,000 条笔记的 HTML 文件里找一个笔记吗？这就是为什么需要这个插件。

## 截图

插件设置页面 — 凭证配置、文件名格式、定时同步开关和间隔设置。

![设置页面](docs/screenshots/settings.png)

同步日志弹窗 — 显示每次同步的过滤条件、参数和逐条笔记的处理结果（新增/更新/跳过/失败）。

![同步历史](docs/screenshots/sync-history.png)

手动同步弹窗 — 填写起始日期后按时间同步，笔记详情以折叠组展示。

![手动同步](docs/screenshots/manual-sync.png)

同步后的录音笔记 — 包含音频文件、转写文本和 AI 总结，元数据（uid、标签、来源）记录在 frontmatter 中。

![录音笔记](docs/screenshots/synced-recording.png)

## 功能

| 功能 | 说明 |
| --- | --- |
| 增量同步 | 新增笔记、更新已有笔记、跳过未变化内容 |
| 选择性同步 | 从列表中勾选要导入的笔记 |
| 定时同步 | 按设定间隔在后台自动同步 |
| 启动时同步 | Obsidian 启动时自动同步一次 |
| 按类型分类 | 纯文本、链接、录音、本地音频、其他分别归档 |
| 按标题命名 | 优先用标题，没有标题则从正文生成 |
| 日期前缀 | 支持 `YYYY-MM-DD`、`YYYYMMDD_HHmm` 等格式 |
| 冲突保护 | 同名不同笔记自动加后缀区分 |
| 同步历史 | 展示逐条笔记的同步结果 |
| 同步断点 | 自动记录已同步到哪条笔记，下次定时同步从断点继续 |

## 安装

### 通过 Obsidian 社区插件（待上线）

插件正在准备提交 Obsidian 官方社区插件市场。上架后可以这样安装：

1. 打开 `设置 -> 社区插件 -> 浏览`.
2. 搜索 `GetNote Importer`.
3. 安装并启用插件。

### 通过 BRAT 安装

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 社区插件。
2. 打开 `设置 -> 社区插件 -> BRAT -> 添加测试版插件`.
3. 输入仓库地址：

```text
https://github.com/AndyZhengyan/obsidian-getnote-importer
```

4. 启用 `GetNote Importer`。

### 手动安装

1. 从 [最新版本](https://github.com/AndyZhengyan/obsidian-getnote-importer/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放入：

```text
<your-vault>/.obsidian/plugins/getnote-importer/
```

3. 重启 Obsidian 并启用 `GetNote Importer`。

> 注意：插件目录名是 `getnote-importer`，需与 `manifest.json` 中的 `id` 一致。

## 获取 API 凭证

API 凭证保存在 Obsidian 插件设置中，仅用于访问 Get笔记开放平台 API。

1. 打开 GetNote 应用。
2. 进入 `设置 -> 开放平台`.
3. 创建应用，复制 `Token` 和 `Client ID`。
4. 粘贴到 `设置 -> GetNote Importer` 中。

如果设置页提供 OAuth 按钮，也可以通过 OAuth 自动获取凭证。

## 使用

### 同步全部

在设置页点击"立即同步"，或在命令面板运行：

```text
Get笔记: 同步笔记
```

### 选择性同步

点击"选择性同步"，勾选需要的笔记后再同步。适合专题整理或一次性迁移。

### 保持最新

开启定时同步，选择间隔，可选"启动时自动同步一次"。

## 输出结构

默认情况下，笔记写入目标文件夹。

```text
vault/
└── Get笔记/
    ├── 纯文本/
    │   └── 会议记录.md
    ├── 链接笔记/
    │   └── 2026-04-30_文章摘录.md
    ├── 录音长录/
    │   ├── 录音摘要.md
    │   └── asset/
    │       ├── 录音摘要.mp3
    │       └── 录音摘要.md
    └── 其他/
        └── 未识别类型.md
```

每个 Markdown 文件都会写入 frontmatter，后续同步会用其中的 `uid` 识别同一条 Get笔记。

```yaml
---
uid: "1908723638246504120"
title: "会议记录"
created: 2026-04-30 12:45:24
modified: 2026-04-30 13:00:07
source: Get笔记
note_type: recorder_audio
tags: ["work"]
---
```

## 文件命名规则

| 情况 | 示例 |
| --- | --- |
| 有标题 | `会议记录.md` |
| 无标题 | `这是笔记的第一段文字.md` |
| 加日期前缀 | `2026-04-30_会议记录.md` |
| 同名不同笔记 | `会议记录-2.md` |

非法字符（`\ / : * ? " < > |`）会自动移除。

## 文件名前缀

在文件名开头追加日期/时间模式。可用占位符：

| 占位符 | 含义 | 示例 |
| --- | --- | --- |
| `YYYY` | 4位年份 | `2026` |
| `MM` | 2位月份 | `04` |
| `DD` | 2位日期 | `30` |
| `HH` | 2位小时（24小时制） | `14` |
| `mm` | 2位分钟 | `30` |
| `ss` | 2位秒 | `05` |

**使用示例：**

| 前缀 | 生成的文件名 |
| --- | --- |
| `YYYY-MM-DD` | `2026-04-30_会议记录.md` |
| `YYYYMMDD_HHmm` | `20260430_1430_会议记录.md` |
| `YYYY-MM-DD` | `2026-04-30_.md`（无标题时用正文前文） |

插件会用笔记 `created_at` 时间戳的对应值替换每个占位符。注意大小写敏感：`mm` 表示分钟，`MM` 表示月份。

## 设置项

| 设置项 | 说明 | 默认值 |
| --- | --- | --- |
| API Token | Get笔记开放平台 Token | 空 |
| Client ID | Get笔记开放平台 Client ID | 空 |
| 目标文件夹 | vault 内同步目标目录 | `Get笔记` |
| 最大同步天数 | 只同步最近 N 天更新的笔记，`0` 表示不限 | `30` |
| 同步开始日期 | 手动同步的绝对起始日期 | 空 |
| 文件名前缀 | 日期时间前缀格式，如 `YYYY-MM-DD` | 空 |
| 定时同步 | 后台自动同步开关 | 关闭 |
| 同步间隔 | 定时同步间隔（分钟） | `30` |
| 启动时同步 | Obsidian 启动时自动同步一次 | 开启 |

## 同步模型

对已导入内容来说，插件默认把 Get笔记视为同步来源。

1. 扫描目标目录，从 frontmatter 构建 `uid -> file` 索引。
2. 从 Get笔记开放平台 API 获取笔记列表。
3. 按同步范围过滤笔记。
4. 为新笔记创建文件。
5. 当 `updated_at` 变化时更新文件。
6. 当显示标题变化时重命名文件。
7. 在同步历史中记录每条笔记的结果。

## 隐私

- 插件不依赖额外后端服务。
- API 凭证保存在本地 Obsidian 插件数据中。
- 笔记数据从 Get笔记获取后直接写入你的 vault。
- 音频附件只会从 Get笔记 API 返回的 HTTPS 地址下载。

## 已知限制

- 插件依赖 Get笔记开放平台 API 的可用性和响应格式。
- 只有详情接口返回有效 HTTPS 音频附件时，音频下载才会生效。
- 后续同步可能更新已导入文件；如果你要大量手动编辑，建议把个人补充写到独立笔记或反向链接中。

## 开发

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

发布产物从仓库根目录生成：

- `main.js`
- `manifest.json`
- `styles.css`

GitHub release workflow 会在上传产物前验证：类型检查、lint、测试、构建，以及 tag 和 manifest 版本一致性。

## 提交到 Obsidian 社区插件市场

提交 `obsidianmd/obsidian-releases` 时可使用以下条目：

```json
{
  "id": "getnote-importer",
  "name": "GetNote Importer",
  "author": "Zheng Yan",
  "description": "Sync notes, links, recordings, and AI summaries from GetNote into your Obsidian vault.",
  "repo": "AndyZhengyan/obsidian-getnote-importer"
}
```

## 支持

- Bug 反馈：[GitHub Issues](https://github.com/AndyZhengyan/obsidian-getnote-importer/issues)
- 功能建议：[GitHub Discussions](https://github.com/AndyZhengyan/obsidian-getnote-importer/discussions)
- 如果插件帮到了你，欢迎给项目一个 star

## 许可证

[MIT](LICENSE)