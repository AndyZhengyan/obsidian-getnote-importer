# GetNote Importer

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square)](https://obsidian.md)
[![Latest Release](https://img.shields.io/github/v/release/AndyZhengyan/obsidian-getnote-importer?style=flat-square)](https://github.com/AndyZhengyan/obsidian-getnote-importer/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/AndyZhengyan/obsidian-getnote-importer/ci.yml?branch=main&style=flat-square)](https://github.com/AndyZhengyan/obsidian-getnote-importer/actions)
[![License](https://img.shields.io/github/license/AndyZhengyan/obsidian-getnote-importer?style=flat-square)](LICENSE)

Bring your GetNote ideas, highlights, links, recordings, and AI summaries into Obsidian as clean, searchable Markdown.

中文：把 Get笔记里的灵感、摘录、链接、录音和 AI 总结同步进 Obsidian，变成可长期整理、搜索和链接的本地 Markdown 知识库。

GetNote Importer is an Obsidian plugin for people who capture in GetNote but think, connect, and build in Obsidian. It keeps imports readable from day one: title-based filenames, type-based folders, source metadata in frontmatter, incremental updates, selective sync, scheduled sync, and detailed sync history.

中文：GetNote Importer 适合把 Get笔记作为快速捕捉入口、把 Obsidian 作为长期知识库的人。插件会用可读文件名、分类目录、frontmatter、增量更新、选择性同步和同步历史，尽量让导入内容从第一天就能融入你的 vault。

## Why It Feels Good

- **Readable files, not dumped data**: notes are named from their titles and organized by note type.  
  中文：导入后不是一堆难认的数据文件，而是按标题命名、按类型归档的 Markdown。
- **Incremental by default**: unchanged notes are skipped; updated notes are refreshed.  
  中文：默认增量同步，没变的不重复写，变了的才更新。
- **Selective when you need control**: pick exactly which notes to bring into Obsidian.  
  中文：需要精细整理时，可以只勾选指定笔记同步。
- **Scheduled when you want peace of mind**: keep the vault fresh in the background.  
  中文：支持定时同步，也可以在 Obsidian 启动时自动同步。
- **Audio-aware**: recording notes can include downloaded audio assets and transcript content when the GetNote API provides them.  
  中文：当 Get笔记 API 返回录音附件和转写时，插件会尝试保存音频并写入转写内容。
- **Mobile-friendly networking**: API calls use Obsidian `requestUrl`, keeping the plugin suitable for desktop and mobile Obsidian.  
  中文：网络请求使用 Obsidian `requestUrl`，保留桌面端和移动端兼容性。

## Features

| Feature | Description | 中文 |
| --- | --- | --- |
| Incremental sync | Create new notes, update changed notes, skip unchanged notes | 增量同步新增、更新和跳过未变化内容 |
| Selective sync | Choose notes from a picker before importing | 从列表中选择指定笔记同步 |
| Scheduled sync | Sync in the background on an interval | 按间隔自动后台同步 |
| Startup sync | Optionally sync once when Obsidian starts | Obsidian 启动时可自动同步一次 |
| Type-based folders | Plain text, links, recordings, local audio, and unknown types are grouped separately | 按纯文本、链接、录音、本地音频等分类 |
| Title-based filenames | Uses note titles first, then content previews as fallback | 优先使用标题，没有标题则从正文生成 |
| Date prefixes | Supports patterns like `YYYY-MM-DD` and `YYYYMMDD_HHmm` | 支持日期时间前缀 |
| Conflict protection | Avoids overwriting different notes with the same title | 同名不同笔记自动加后缀 |
| Sync history | Shows per-note created, updated, skipped, and failed results | 同步历史展示逐条笔记结果 |

## Installation

### From Obsidian Community Plugins

GetNote Importer is being prepared for Obsidian's official community plugin directory. After it is listed:

中文：插件正在准备提交 Obsidian 官方社区插件市场。上架后可以这样安装：

1. Open `Settings -> Community plugins -> Browse`.
2. Search for `GetNote Importer`.
3. Install and enable the plugin.

### Via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. Open `Settings -> Community plugins -> BRAT -> Add a beta plugin`.
3. Enter this repository URL:

```text
https://github.com/AndyZhengyan/obsidian-getnote-importer
```

4. Enable `GetNote Importer`.

中文：如果插件尚未上架官方市场，可以用 BRAT 添加上面的仓库地址进行安装。

### Manual Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/AndyZhengyan/obsidian-getnote-importer/releases/latest).
2. Put them into:

```text
<your-vault>/.obsidian/plugins/getnote-importer/
```

3. Reload Obsidian and enable `GetNote Importer`.

中文：手动安装时请注意插件目录名是 `getnote-importer`，需要和 `manifest.json` 里的 `id` 一致。

## Get API Credentials

Your GetNote API credentials are stored in Obsidian plugin settings and are used only to call the GetNote Open API.

中文：API 凭证保存在 Obsidian 插件设置中，仅用于访问 Get笔记开放平台 API。

1. Open the GetNote app.
2. Go to `Settings -> Open Platform`.
3. Create an app and copy the `Token` and `Client ID`.
4. Paste them into `Settings -> GetNote Importer`.

You can also use the OAuth button in the plugin settings when available.

中文：如果设置页中提供 OAuth 按钮，也可以通过 OAuth 自动获取凭证。

## Usage

### Sync Everything

Open the plugin settings and click `Sync now`, or run this command from the command palette:

```text
Get笔记: 同步笔记
```

中文：在设置页点击“立即同步”，或在命令面板运行上面的命令。

### Pick Notes to Sync

Click `Selective sync`, choose the notes you want, then start syncing. This is useful for project cleanup, topic-based imports, and one-off migrations.

中文：点击“选择性同步”，勾选需要导入的笔记后再同步，适合专题整理或一次性迁移。

### Keep It Fresh

Enable scheduled sync, choose an interval, and optionally sync once when Obsidian starts.

中文：开启定时同步后，插件会按设定间隔后台同步，也可以在启动时自动同步一次。

## Output Structure

By default, notes are written under `Get笔记/`.

中文：默认情况下，笔记会写入 vault 内的 `Get笔记/` 目录。

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

Each Markdown note includes frontmatter so future syncs can identify and update the same GetNote item.

中文：每个 Markdown 文件都会写入 frontmatter，后续同步会用其中的 `uid` 识别同一条 Get笔记。

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

## Filename Rules

| Scenario | Example | 中文 |
| --- | --- | --- |
| Note has a title | `会议记录.md` | 使用标题 |
| Note has no title | `这是笔记的第一段文字.md` | 从正文生成标题 |
| Prefix is `YYYY-MM-DD` | `2026-04-30_会议记录.md` | 加日期前缀 |
| Same title, different note | `会议记录-2.md` | 自动加冲突后缀 |

Invalid filename characters such as `\ / : * ? " < > |` are removed automatically.

中文：文件名中的非法字符会自动移除。

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| API Token | GetNote Open API token | empty |
| Client ID | GetNote Open API client ID | empty |
| Target folder | Destination folder inside your vault | `Get笔记` |
| Max sync days | Only sync notes updated in the last N days. `0` means no limit | `30` |
| Sync start date | Optional absolute start date for manual sync | empty |
| Filename prefix | Date/time prefix format, such as `YYYY-MM-DD` | empty |
| Scheduled sync | Run sync automatically in the background | off |
| Sync interval | Scheduled sync interval in minutes | `30` |
| Sync on start | Run once when Obsidian starts | on |

中文：以上设置都可以在 Obsidian 的 `Settings -> GetNote Importer` 中配置。

## Sync Model

GetNote Importer treats GetNote as the source of truth for imported note content.

中文：对已导入内容来说，插件默认把 Get笔记视为同步来源。

1. Scan the target folder and build a `uid -> file` index from frontmatter.
2. Fetch notes from the GetNote Open API.
3. Filter notes by your sync range.
4. Create files for new notes.
5. Update files when `updated_at` changes.
6. Rename files when the display title changes.
7. Record per-note results in sync history.

中文：同步时会扫描目标目录、获取 API 数据、按时间范围过滤、创建或更新文件，并记录逐条结果。

## Privacy

- No external backend is involved.  
  中文：插件不依赖额外后端服务。
- API credentials stay in local Obsidian plugin data.  
  中文：API 凭证保存在本地 Obsidian 插件数据中。
- Note data is requested from GetNote and written directly into your vault.  
  中文：笔记数据从 Get笔记获取后直接写入你的 vault。
- Audio attachments are downloaded only from HTTPS URLs returned by the GetNote API.  
  中文：音频附件只会从 Get笔记 API 返回的 HTTPS 地址下载。

## Known Limitations

- The plugin depends on the availability and response shape of the GetNote Open API.  
  中文：插件依赖 Get笔记开放平台 API 的可用性和响应格式。
- Audio download works only when the detail API returns a valid HTTPS audio attachment.  
  中文：只有详情接口返回有效 HTTPS 音频附件时，音频下载才会生效。
- Imported Markdown content may be updated by future syncs. Keep personal edits in separate notes or backlinks if you need full manual control.  
  中文：后续同步可能更新已导入文件；如果你要大量手动编辑，建议把个人补充写到独立笔记或反向链接中。

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Release assets are generated from the repository root:

- `main.js`
- `manifest.json`
- `styles.css`

The GitHub release workflow verifies typecheck, lint, tests, build, and version/tag consistency before uploading those files.

中文：发布 workflow 会在上传 release 产物前检查类型、lint、测试、构建以及 tag 和 manifest 版本一致性。

## Obsidian Community Plugin Submission

Suggested entry for `obsidianmd/obsidian-releases`:

```json
{
  "id": "getnote-importer",
  "name": "GetNote Importer",
  "author": "Zheng Yan",
  "description": "Sync notes, links, recordings, and AI summaries from GetNote into your Obsidian vault.",
  "repo": "AndyZhengyan/obsidian-getnote-importer"
}
```

中文：提交 Obsidian 官方社区插件市场时，可以使用上面的 `community-plugins.json` 条目。

## Support

- Report bugs in [GitHub Issues](https://github.com/AndyZhengyan/obsidian-getnote-importer/issues).
- Share ideas in [GitHub Discussions](https://github.com/AndyZhengyan/obsidian-getnote-importer/discussions).
- Star the repository if it saves you time.

中文：Bug 请提交 Issue，功能建议可以发 Discussion。如果这个插件帮你省了时间，欢迎给项目一个 star。

## License

[MIT](LICENSE)
