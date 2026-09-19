# ⭐ Officially Recommended | Dedao Brain / GetNote 🔄 Obsidian Sync

[中文](./README.md) | [English](./README_EN.md)

[![Community Plugin](https://img.shields.io/badge/Obsidian-Community%20Plugin-7c3aed?style=flat-square&logo=obsidian)](https://community.obsidian.md/plugins/dedao-brain-sync)
[![Latest Release](https://img.shields.io/github/v/release/AndyZhengyan/obsidian-dedao-brain-sync?style=flat-square)](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24.dedao-brain-sync.downloads&style=flat-square&label=downloads)](https://community.obsidian.md/plugins/dedao-brain-sync)
[![CI](https://img.shields.io/github/actions/workflow/status/AndyZhengyan/obsidian-dedao-brain-sync/ci.yml?branch=main&style=flat-square)](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync/actions)
[![License](https://img.shields.io/github/license/AndyZhengyan/obsidian-dedao-brain-sync?style=flat-square)](LICENSE)

Sync your notes, highlights, links, recordings, and AI summaries between **Dedao Brain (得到大脑, formerly GetNote / Get笔记)** and Obsidian, turning them into local Markdown you can organize, search, link, and keep for the long term.

For the story behind the project, see this Chinese article: [我做的得到大脑OB插件，上架官网了😃](https://mp.weixin.qq.com/s/0-d_jLOGr3OhanruPR52vg).

* * *

## 🎉 1.6.1 — Latest Update

- **🚦 Auto-sync no longer exhausts the upstream rate limit**: fixed a bug where every synced file triggered a `fetchNoteDetail` call on every cycle — now only files whose local mtime has advanced are re-fetched. Interrupted syncs also resume from the last checkpoint instead of restarting from scratch.
- **📝 Highlights sync with their content**: ref/highlight notes no longer arrive as an empty body with a `(无标题)` filename — the original highlight text and title are preserved.

A stability fix; recommended for everyone running automatic sync.

The README keeps only the current release highlights. See [GitHub Releases](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync/releases) for the complete version history.

* * *

## ✨ Why use it

- 🔄 **True two-way workflow**: continuously sync Dedao Brain → Obsidian; automatically create or update text notes in the sync folder, or manually create selected Markdown notes in Dedao Brain.
- 🧠 **More than a one-shot export**: each note becomes a local Markdown file that stays part of your long-term knowledge base.
- ⚡ **Stable, resumable sync**: supports incremental sync, checkpoints, last-N-days scopes, start dates, selected notes, and knowledge-base scopes.
- 🔎 **Search Dedao Brain inside Obsidian**: full-text search from the sidebar, with one-click open for local hits or sync for remote-only hits.
- 🖱️ **Search from selected text**: select text in the editor and launch a Dedao Brain search directly from the context menu.
- 📚 **Better knowledge-base sync**: sync a specific knowledge base, or run a command to sync all subscribed knowledge bases.
- 🗂️ **Control your local structure**: type-based folders, filename prefixes, created-date paths, plus migration and rollback for existing notes.
- 🏷️ **Richer filters**: scope sync by updated time, start date, note type, tags, or knowledge base.
- ⏱️ **Automatic sync**: scheduled and startup sync can download only or also upload local changes from the sync folder.
- 📜 **Traceable history**: keeps the most recent 30 days of sync history, including scope, duration, status, and per-note results.
- 📱 **Desktop + mobile**: the plugin is not desktop-only; OpenAPI mode works well across desktop and mobile Obsidian.

## 🧰 Feature overview

| Feature | Description |
| --- | --- |
| 🔄 Incremental sync | Detect remote additions and updates without re-downloading everything |
| 🔎 Search sidebar | Full-text search of Dedao Brain from inside Obsidian |
| 🖱️ Search selected text | Select text in the editor and search Dedao Brain from the context menu |
| ⏳ Sync by date | Sync from a start date or within the last N days |
| ☑️ Sync by note | Pick specific remote notes to sync |
| 📚 Sync by knowledge base | Sync a selected knowledge base |
| 🌐 Sync all subscriptions | Run a command to sync all subscribed knowledge bases |
| 🕒 Scheduled sync | Download on an interval and optionally upload local text notes from the sync folder |
| 🚀 Startup sync | Run a sync when Obsidian starts, when scheduled sync is enabled |
| ⬆️ Local upload | Automatically upload text notes from the sync folder or manually create selected Markdown files |
| 🏷️ Tag filters | Restrict sync using a tag whitelist |
| 📎 Attachment downloads | Independently control image / audio / video / document downloads |
| 🗂️ Date-based paths | Organize by created date and migrate / roll back existing files |
| 📜 Sync history | Keep the most recent 30 days of run history and per-note results |
| 🎛️ Ribbon shortcuts | Show or hide sync and search Ribbon actions |

## 🖼️ Screenshots

### ⚙️ Settings

Configure authentication, target folders, sync behavior, attachments, scheduled sync, and sync history from one place.

<img src="docs/screenshots/settings-overview.png" alt="Settings overview" width="720">

### 🔎 Search sidebar

Search Dedao Brain from Obsidian, then open a local hit or sync a remote hit with one click.

<img src="docs/screenshots/search-sidebar.png" alt="Dedao Brain search sidebar" width="720">

## 📦 Installation

### 💜 Install from Obsidian Community Plugins

[![Available on Obsidian](https://img.shields.io/badge/Obsidian-Community%20Plugin-7c3aed?style=flat-square&logo=obsidian)](https://community.obsidian.md/plugins/dedao-brain-sync)

1. Open `Settings → Community plugins → Browse`.
2. Search for `Dedao Brain Sync`, `得到大脑`, `GetNote`, or `Get笔记`.
3. Install and enable the plugin.

### 🛠️ Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync/releases/latest).
2. Put them in:

```text
<your-vault>/.obsidian/plugins/getnote-importer/
```

3. Restart Obsidian and enable `Dedao Brain Sync`.

> The plugin ID remains `getnote-importer` for compatibility with the existing Obsidian Community listing and legacy data. The display name is `Dedao Brain Sync`.

## 🔑 Authentication

> ⚠️ Dedao Brain OpenAPI currently requires a **Dedao Brain PRO** membership. Free-tier users cannot retrieve full data through OpenAPI and can try Web mode on desktop instead.

Credentials are stored only in your local Obsidian plugin data.

### 🟢 OpenAPI mode — recommended for long-term use

1. Open Dedao Brain.
2. Go to `Settings → Open Platform`.
3. Create an application and obtain the `Token` and `Client ID`.
4. In `Settings → Dedao Brain Sync`, choose OpenAPI authentication and enter both values.
5. Test the connection.

### 🟡 Web mode — quick desktop setup

On desktop Obsidian, the plugin can use its built-in Web login flow to capture a session token and attempt automatic refresh when the session expires. Manual token entry is still supported as a fallback.

See the step-by-step guide: [Web Mode Manual Token Guide](docs/web-mode-manual-token.md).

> Web tokens are browser-session credentials and can expire. If you see `401`, `403`, or a session-expired message, sign in again or refresh the token. Automatic Web login / token renewal depends on the desktop environment; mobile users should prefer OpenAPI.

## 🔄 Usage

### ⬇️ Sync from Dedao Brain to Obsidian

Start a sync from the settings page, or run:

```text
Dedao Brain Sync: Sync notes
```

You can then choose a date-based, note-based, or knowledge-base sync scope.

### 🌐 Sync all subscribed knowledge bases

A dedicated command syncs all subscribed knowledge bases in one run. Subscription lists are paginated so the plugin does not stop at the first page of results.

### 🔎 Search Dedao Brain

- Click the search Ribbon action to open the sidebar search.
- If a result already exists locally, open it directly.
- If it is remote-only, sync it to the vault with one click.
- Select text in the editor and use the context menu to search that phrase.

### 🕒 Scheduled sync

When automatic sync is enabled, the plugin pulls remote changes at the configured interval and can also sync on startup. Turn on “Auto-upload local changes” to process new or edited text notes in the sync folder and its subfolders during the same run.

Automatic upload is off by default and requires OpenAPI. Deletions never propagate. When local and remote content both changed, the plugin preserves both copies and asks you to choose a version during manual sync.

### ⬆️ Create Dedao Brain notes from Obsidian

Open local upload from the settings page or command palette and select one or more Markdown files.

Manual upload is **selection-based and create-only**, separate from automatic updates inside the sync folder:

- It mainly supports `plain_text` and `link` note types.
- Notes with a `uid` that are confirmed to still exist remotely are skipped to avoid duplicates.
- Existing Dedao Brain notes are not automatically overwritten.
- Linked text-note edits inside the sync folder can be handled by “Auto-upload local changes.”
- Uploaded tags are deduplicated and capped.

## 📁 Output layout

The default target folder is `得到大脑`. The actual layout depends on note type, knowledge base, and date-path settings.

```text
vault/
└── 得到大脑/
    ├── 2026/
    │   └── 08/
    │       ├── 纯文本/
    │       │   └── Meeting Notes.md
    │       ├── 链接笔记/
    │       │   └── Article.md
    │       └── 知识库/
    │           └── My Knowledge Base/
    │               └── Topic Note.md
    └── ...
```

Each synced Markdown file contains frontmatter used to identify the corresponding remote note on later runs.

```yaml
---
uid: "1908723638246504120"
title: "Meeting Notes"
created: 2026-04-30 12:45:24
modified: 2026-04-30 13:00:07
source: Dedao Brain
note_type: recorder_audio
tags: ["work"]
---
```

## 🏷️ Filenames and created-date paths

### ✏️ Filename prefixes

Supported date/time placeholders:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `YYYY` | Year | `2026` |
| `MM` | Month | `08` |
| `DD` | Day | `30` |
| `HH` | Hour | `14` |
| `mm` | Minute | `30` |
| `ss` | Second | `05` |

Example: `YYYY-MM-DD` → `2026-08-30_Meeting Notes.md`

### 📅 Organize paths by created date

Enable a rule such as `YYYY/MM` to produce paths like:

```text
得到大脑/2026/08/纯文本/Meeting Notes.md
```

The folder date comes from the note's creation time, not its update time. When you change or disable the date-path setting, the plugin runs a preflight before migrating or rolling back historical files and their related attachments.

Migration is safe to re-run. When there is a target conflict, invalid metadata, shared attachment, or a move that could break path-qualified links, the plugin prefers to skip the affected note rather than overwrite files.

## ⚙️ Main settings

| Setting | Default / behavior |
| --- | --- |
| 🔐 Authentication | OpenAPI |
| 📁 Target folder | `得到大脑` |
| 🏷️ Filename prefix | Empty |
| 📅 Date-based paths | Off, default format `YYYY/MM` |
| ⏳ Manual sync range | Last 30 days |
| 🕒 Scheduled sync | Off |
| ⏱️ Sync interval | 30 minutes |
| 🚀 Startup sync | On by default once scheduled sync is enabled |
| 📎 Download attachments | On |
| 🖼️ Image / 🎵 audio / 🎬 video / 📄 document | All enabled by default |
| 🔎 Search Ribbon | Visible |
| 🔄 Sync Ribbon | Visible |
| 📜 Sync history | Keeps the most recent 30 days |

## 🔒 Privacy

- 🔐 API credentials stay in local Obsidian plugin data.
- 🏠 The plugin does not depend on an extra third-party relay backend.
- ⬇️ Downloaded content goes directly from Dedao Brain into your vault.
- ⬆️ Manual upload sends only the Markdown files you explicitly select. When “Auto-upload local changes” is enabled, eligible new or edited text notes in the sync folder and its subfolders are sent automatically.
- 📎 Attachments are downloaded only from URLs returned by Dedao Brain APIs.
- 🛡️ Local path migration prefers skipping unsafe conflicts rather than overwriting files.

## ⚠️ Known limitations

- OpenAPI depends on Dedao Brain's Open Platform and requires PRO access.
- Web mode depends on Dedao Brain's web APIs and browser session; API changes or expired tokens can break it.
- Automatic Web login / token refresh is primarily a desktop feature.
- Manual upload is create-only. Automatic upload can send title, body, and tag edits from linked plain-text notes in the sync folder.
- Manual upload mainly supports plain-text and link notes; automatic upload supports plain-text notes through OpenAPI only.
- Some attachment features depend on the detail API returning a valid attachment URL.
- If Dedao Brain changes its response fields, some note types may require plugin updates.

## 👨‍💻 Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Release validation checks types, lint, tests, build output, and version consistency.

Release artifacts:

- `main.js`
- `manifest.json`
- `styles.css`

## 💬 Support & feedback

- 🐛 Bugs: [GitHub Issues](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync/issues)
- 💡 Feature requests: [GitHub Issues](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync/issues/new/choose)
- 📝 User feedback form: [Dedao Brain Sync feedback form](https://ku3yh6njf4.feishu.cn/share/base/form/shrcnShw4NxSTbVx7P7bjTxqvPe)

<img src="docs/screenshots/feedback-qr.png" alt="Feedback form QR code" width="180">

If this plugin helps you, a ⭐ Star is always appreciated.

## 👋 About the author

Enterprise AI practitioner, independent AI blogger, AGI believer, and longtime AI enthusiast.

Feel free to reach out through GitHub Issues, the feedback form, or the author's public account.

<img src="docs/screenshots/wechat-qr.jpg" alt="WeChat public account QR code" width="160">

## 📄 License

[MIT](LICENSE)
