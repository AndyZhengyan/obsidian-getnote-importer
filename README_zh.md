# 得到大脑（原Get笔记）Sync

【中文主文档 | English summary below】

[![Community Plugin](https://img.shields.io/badge/Obsidian-Community%20Plugin-7c3aed?style=flat-square&logo=obsidian)](https://community.obsidian.md/plugins/getnote-importer)
[![Latest Release](https://img.shields.io/github/v/release/AndyZhengyan/obsidian-getnote-importer?style=flat-square)](https://github.com/AndyZhengyan/obsidian-getnote-importer/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24.getnote-importer.downloads&style=flat-square&label=downloads)](https://community.obsidian.md/plugins/getnote-importer)
[![CI](https://img.shields.io/github/actions/workflow/status/AndyZhengyan/obsidian-getnote-importer/ci.yml?branch=main&style=flat-square)](https://github.com/AndyZhengyan/obsidian-getnote-importer/actions)
[![License](https://img.shields.io/github/license/AndyZhengyan/obsidian-getnote-importer?style=flat-square)](LICENSE)

把得到大脑（原Get笔记）里的灵感、摘录、链接、录音和 AI 总结与 Obsidian 双向同步，变成可长期整理、搜索和链接的本地 Markdown 知识库。

> Obsidian 社区插件目录要求 `manifest.name` 优先使用英文 Basic Latin 字符，所以插件市场显示名为 `Dedao Brain Sync`；插件设置页、README 和中文文案使用主品牌 `得到大脑（原Get笔记）Sync`。

## 为什么好用

- **不是一次性导出**：官方导出是离线 HTML；本插件把笔记同步成独立 Markdown 文件。
- **下载同步稳定可续传**：支持增量同步、定时同步、启动时同步和同步断点。
- **可以精确选择**：可按时间范围同步，也可从笔记列表中勾选指定笔记。
- **支持本地上传**：可以从 Obsidian 选择一篇或多篇 Markdown 上传到得到大脑，不会随定时同步自动上传。
- **文件可读**：按笔记类型归档，优先使用标题命名，支持日期时间前缀。
- **录音友好**：API 返回音频和转写时，会保存音频附件和转写内容。
- **移动端兼容**：网络请求使用 Obsidian `requestUrl`，适合桌面端和移动端 Obsidian。

## 功能

| 功能 | 说明 |
| --- | --- |
| 增量同步 | 新增笔记、更新已有笔记、跳过未变化内容 |
| 按时间同步 | 按起始日期或最近 N 天拉取得到大脑笔记 |
| 按笔记同步 | 从远端列表中勾选要同步的笔记 |
| 定时同步 | 按设定间隔从得到大脑同步到 Obsidian |
| 启动时同步 | Obsidian 启动时自动执行一次下载同步 |
| 本地上传 | 从 Obsidian 选择目录和 Markdown 文件，创建到得到大脑 |
| 类型归档 | 纯文本、链接、录音、本地音频、其他分别归档 |
| 同步历史 | 展示逐条笔记的新增、更新、跳过、失败结果 |

## 截图

设置页面：API 凭证、目标文件夹、文件名前缀、定时同步和上传入口。

![设置页面](docs/screenshots/settings.png)

手动同步弹窗：按日期或天数范围同步笔记。

![手动同步](docs/screenshots/manual-sync.png)

同步历史弹窗：查看每次同步的逐条处理结果。

![同步历史](docs/screenshots/sync-history.png)

同步后的录音笔记：包含音频文件、转写文本、AI 总结和 frontmatter 元数据。

![录音笔记](docs/screenshots/synced-recording.png)

## 安装

### 通过 Obsidian 社区插件

[![Available on Obsidian](https://img.shields.io/badge/Obsidian-Community%20Plugin-7c3aed?style=flat-square&logo=obsidian)](https://community.obsidian.md/plugins/getnote-importer)

1. 打开 `设置 -> 第三方插件 -> 浏览`。
2. 搜索 `Dedao Brain Sync`、`得到大脑` 或原名 `GetNote` / `Get笔记`。
3. 安装并启用插件。

### 手动安装

1. 从 [最新版本](https://github.com/AndyZhengyan/obsidian-getnote-importer/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放入：

```text
<your-vault>/.obsidian/plugins/getnote-importer/
```

3. 重启 Obsidian 并启用 `Dedao Brain Sync`。

> 插件目录名仍然是 `getnote-importer`，需与 `manifest.json` 中的 `id` 一致；这是兼容性标识，不随显示名称变化。

## 获取 API 凭证

> **注意**：得到大脑（原Get笔记）OpenAPI 需要 **得到大脑PRO** 会员。我们与 得到大脑团队确认过，OpenAPI 运营成本较高，目前仅对付费会员开放。如果你是免费用户，OpenAPI 接口不会返回数据。

凭证只保存在本地 Obsidian 插件数据中，用于访问你选择的接口模式。

### OpenAPI 模式（推荐长期使用）

1. 打开得到大脑应用。
2. 进入 `设置 -> 开放平台`。
3. 创建应用，复制 `Token` 和 `Client ID`。
4. 在 `设置 -> 得到大脑（原Get笔记）Sync` 中选择 `OpenAPI鉴权（会员）`，粘贴两个值。
5. 也可以使用设置页的 OAuth 按钮自动获取凭证。

### Web 模式（手动 Token）

如果你的账号无法使用 OpenAPI，可以选择 `临时鉴权`。这个模式复用浏览器里已经登录的得到大脑网页版会话，不需要 `Client ID`。

独立图文步骤见：[Web 模式手动 Token 指南](docs/web-mode-manual-token_zh.md)。

复制 Token 的步骤：

1. 用 Chrome 或 Edge 打开 `https://www.biji.com/note` 并登录。
2. 打开浏览器开发者工具：Windows/Linux 按 `F12` 或 `Ctrl + Shift + I`；Mac 按 `Command + Option + I`。
3. 切到 `Network` 面板，并选择 `Fetch/XHR` 过滤。
4. 刷新网页版，或打开笔记列表 / 任意一篇笔记，让页面发起接口请求。
5. 在请求列表里点开名称类似 `notes?...` 或 `list?...` 的请求；右侧 Headers 里的 `Host` 通常是 `get-notes.luojilab.com`。
6. 在 `Request Headers` 下复制完整的 `Authorization` 值。
7. 粘贴到 `设置 -> 得到大脑（原Get笔记）Sync -> 临时鉴权` 的 Token 输入框。
8. 点击 `测试连接`，成功后再执行 `按时间同步` 或 `按笔记同步`。

这个值通常以 `Bearer eyJ...` 开头；插件支持粘贴完整 `Bearer ...`，也支持只粘贴 JWT token。不要把 OpenAPI 的 `gk_...` Token 粘贴到临时鉴权里。Web Token 是浏览器会话凭证，可能过期；如果返回 `401`、`403` 或 `Web Token 已过期`，请刷新网页版并重新复制 `Authorization` header。

## 使用

### 从得到大脑同步到 Obsidian

在设置页点击 `按时间同步`，或在命令面板运行：

```text
Dedao Brain Sync: 同步笔记
```

### 选择远端笔记同步

点击 `按笔记同步`，从远端列表中勾选需要同步的笔记。适合专题整理、项目清理或一次性补同步。

### 定时同步

开启定时同步后，插件会按设定间隔从得到大脑同步到 Obsidian。定时同步只下载远端变化，不会上传本地笔记。

### 从 Obsidian 上传到得到大脑

在设置页点击 `从 Obsidian 上传到得到大脑` 区域里的 `按笔记上传`，选择本地目录和一篇或多篇 Markdown 文件后上传。

上传是**创建型同步**：

- 没有正文的笔记会跳过。
- 已有 `uid` 且能确认远端存在的笔记会跳过，避免重复创建。
- 不会覆盖得到大脑里的已有内容。
- 不会被定时同步自动触发。

## 输出结构

默认情况下，笔记写入目标文件夹。

```text
vault/
└── 得到大脑/
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

每个 Markdown 文件都会写入 frontmatter，后续同步会用其中的 `uid` 识别同一条远端笔记。

```yaml
---
uid: "1908723638246504120"
title: "会议记录"
created: 2026-04-30 12:45:24
modified: 2026-04-30 13:00:07
source: 得到大脑
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

可以在文件名开头追加日期/时间模式。可用占位符：

| 占位符 | 含义 | 示例 |
| --- | --- | --- |
| `YYYY` | 4 位年份 | `2026` |
| `MM` | 2 位月份 | `04` |
| `DD` | 2 位日期 | `30` |
| `HH` | 2 位小时（24 小时制） | `14` |
| `mm` | 2 位分钟 | `30` |
| `ss` | 2 位秒 | `05` |

示例：

| 前缀 | 生成的文件名 |
| --- | --- |
| `YYYY-MM-DD` | `2026-04-30_会议记录.md` |
| `YYYYMMDD_HHmm` | `20260430_1430_会议记录.md` |
| `YYYY-MM-DD` | `2026-04-30_.md`（无标题时用正文前文） |

插件会用笔记 `created_at` 时间戳替换占位符。占位符大小写敏感：`mm` 表示分钟，`MM` 表示月份。

## 设置项

| 设置项 | 说明 | 默认值 |
| --- | --- | --- |
| API Token | 得到大脑开放平台 Token | 空 |
| Client ID | 得到大脑开放平台 Client ID | 空 |
| 目标文件夹 | vault 内同步目标目录 | `得到大脑` |
| 文件名前缀 | 日期时间前缀格式，如 `YYYY-MM-DD` | 空 |
| 自动同步范围 | 定时同步只拉最近 N 天内更新的笔记，`0` 表示不限 | `30` |
| 同步起始日期 | 手动同步的绝对起始日期 | 空 |
| 定时同步 | 后台自动同步开关 | 关闭 |
| 同步间隔 | 定时同步间隔（分钟） | `30` |
| 启动时同步 | Obsidian 启动时自动同步一次 | 开启 |
| 同步笔记类型 | 限制本同步方式处理的笔记类型 | 全部类型 |

## 同步模型

下载方向默认把得到大脑视为远端来源：

1. 扫描目标目录，从 frontmatter 构建 `uid -> file` 索引。
2. 从 OpenAPI 或 Web API 获取笔记列表。
3. 按同步范围和笔记类型过滤。
4. 为新笔记创建文件。
5. 当 `updated_at` 变化时更新文件。
6. 当显示标题变化时重命名文件。
7. 在同步历史中记录每条笔记的结果。
8. 定时同步保存最后处理笔记的时间作为下次断点。

上传方向是手动、选择型、创建型同步：

1. 用户选择本地目录和 Markdown 文件。
2. 插件解析标题、正文和 frontmatter。
3. 空正文、已确认存在的远端笔记、不支持的类型会跳过。
4. 可上传内容会在得到大脑创建为新笔记。
5. 上传结果会进入同步历史。

## 隐私

- 插件不依赖额外后端服务。
- API 凭证保存在本地 Obsidian 插件数据中。
- 下载同步时，笔记数据从得到大脑获取后直接写入你的 vault。
- 手动上传时，只有你选择的本地 Markdown 会发送到得到大脑。
- 音频附件只会从 API 返回的 HTTPS 地址下载。

## 已知限制

- 插件依赖得到大脑 OpenAPI / Web API 的可用性和响应格式。
- OpenAPI 需要 PRO 会员；临时鉴权依赖浏览器会话，可能过期。
- 音频下载只有在详情接口返回有效 HTTPS 音频附件时才会生效。
- 下载同步可能更新已同步文件；如果要大量手动编辑，建议把个人补充写到独立笔记或反向链接中。
- 上传同步当前是创建型，不覆盖远端已有内容，也不会自动上传。

## English Summary

`Dedao Brain Sync` is an Obsidian plugin for bidirectional sync with Dedao Brain / 得到大脑（原Get笔记）. It syncs remote notes into local Markdown files, supports selective and scheduled sync, downloads audio assets when available, and can manually upload selected local Markdown notes back to Dedao Brain. The plugin id remains `getnote-importer` for compatibility.

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

## 支持

- Bug 反馈：[GitHub Issues](https://github.com/AndyZhengyan/obsidian-getnote-importer/issues)
- 功能建议：[GitHub Discussions](https://github.com/AndyZhengyan/obsidian-getnote-importer/discussions)
- 如果插件帮到了你，欢迎给项目一个 star

## 关于作者

企业 AI 从业者，野生 AI 博主，AGI 信徒，AI 发烧友。欢迎扫码关注微信公众号，一起交流讨论。

![微信公众号](docs/screenshots/wechat-qr.jpg)

## 许可证

[MIT](LICENSE)
