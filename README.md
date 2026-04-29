# Get笔记 Importer

将 Get笔记 App 的笔记同步到 Obsidian 本地 vault，支持增量同步。

## 功能

- 增量同步 — 只拉取新增或修改的笔记，不重复写入
- 按笔记类型分类 — 自动按纯文本/链接笔记/录音等分类存放
- note_id 文件名去重 — 精确判断，避免覆盖用户编辑过的文件
- 可配置同步范围 — 支持限制最大同步天数

## 安装

1. 从 GitHub Releases 下载 `manifest.json` 和 `main.js`
2. 放入 `.obsidian/plugins/obsidian-getnote-importer/` 目录
3. 在 Obsidian 设置 → 第三方插件中启用

## 获取 API 凭证

1. 打开 Get笔记 App → 设置 → 开放平台
2. 创建应用，获取 Token 和 Client ID
3. 在插件设置中填入

## 使用

1. 填写 API Token 和 Client ID
2. 点击"立即同步"或使用命令面板（Ctrl/Cmd+P → Get笔记: 同步笔记）
3. 同步完成后，笔记将出现在 vault 的 Get笔记/ 目录下

## 目录结构

```
Get笔记/
├── 纯文本/       # 纯文本笔记
├── 链接笔记/     # 链接笔记
├── 即时录音/     # 即时录音笔记
├── 录音长录/     # 长录音笔记
├── 本地音频/     # 本地音频笔记
└── 其他/         # 其他类型
```

## 已知限制

- Detail API 返回 404，不支持附件下载
- 录音笔记只有 AI 生成的文字摘要，无原始音频
- 链接笔记无法获取原始网页内容

## License

MIT
