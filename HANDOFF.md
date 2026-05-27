# 图片处理功能 — 交接文档

> 接手人：Codex  
> 日期：2026-05-27  
> 分支：`feature/image-handling`（位于 `.worktrees/image-handling/`）

---

## 1. 已完成

### 分支状态
- 分支：`feature/image-handling`
- 最新提交：`615a3d2` — `feat: add image attachment download support`
- 工作树：`.worktrees/image-handling/`（`.gitignore` 已包含 `.worktrees/`）
- Build：通过 | 测试：298 通过

### 实现内容（3 个文件）

#### `src/types.ts`
```typescript
// Attachment 接口新增 image 类型，duration 改为可选
interface Attachment {
  type: 'audio' | 'image' | (string & {});
  url: string;
  title: string;
  duration?: number;  // 仅 audio 有
}

// GetNoteNote 新增 assetPaths 字段
interface GetNoteNote {
  ...
  assetPaths?: string[];  // 所有已下载附件的完整路径
}
```

#### `src/sync.ts`
1. **`downloadImageAsset()`**（新增）— 下载图片到 `{categoryDir}/asset/{noteName}_image.{ext}`
   - URL 安全校验：仅允许 `https:`
   - Path Traversal 防护：`split('/').pop().split('\\').pop()` 去除路径段
   - 扩展名从 URL 自动提取（png/jpg/jpeg/gif/webp/bmp/svg，默认 png）
   - 已存在则跳过

2. **`enrichAudioNote()` 修改** — 在音频逻辑后，下载所有 `type === 'image'` 的附件到 `assetPaths`

3. **`preCheckNote()` 修改** — 若笔记含图片但图片文件不存在，触发重新下载

4. **辅助函数**（新增）
   - `extractImageExtension(url)` — 从 URL 提取扩展名
   - `isImageAttachment(attachment)` — 判断是否图片附件

#### `src/note-parser.ts`
**`buildImageBlock()`**（新增）— 将已下载图片嵌入 markdown
- 过滤所有带 URL scheme 的路径（http/https/data/javascript 等）
- 过滤控制字符 / `<>{}|\\` 等危险字符
- 只允许 vault 相对路径：`asset/xxx.png`
- 输出格式：
  ```markdown
  > 📷 图片
  ![](asset/xxx.png)
  ```

---

## 2. 安全修复

| 文件 | 问题 | 修复 |
|------|------|------|
| `note-parser.ts` | XSS — 直接嵌入路径到 markdown | 拒绝任何 URL scheme，只允许 vault 相对路径 |
| `sync.ts` | Path Traversal — `getFileName()` 可能含 `/` | `split('/').pop().split('\\').pop()` 取最后段 |

---

## 3. 未完成（建议后续）

### 3.1 图片预检查（当前已部分实现）
`preCheckNote()` 只检查 `{baseName}_image.png` 是否存在，但图片扩展名可能变化（如 `.jpg`）。建议改为检查 `{baseName}_image.*` 任意扩展名。

### 3.2 上传方向（Obsidian → GetNote）
`reverse-sync.ts` 完全没有图片处理：
- 只扫描 `.md` 文件
- 提取 `note.body`（纯文本），`![alt](path)` 引用被忽略
- GetNote API 是否支持图片上传需要确认

如需实现，步骤：
1. 确认 GetNote API 图片上传端点（查看 openapi-client.ts / webapi-client.ts 的 createNote）
2. 解析 markdown 中的 `![]()` 语法提取本地图片路径
3. 上传图片并获取 URL
4. 替换 markdown 中的本地路径为远程 URL

### 3.3 UI 展示
同步历史 / 同步结果中目前没有图片相关的统计展示（新增/失败数）。

---

## 4. 测试建议

1. 用一条含图片附件的笔记（note_type 为 `plain_text` 或其他非音频类型）做全量同步验证
2. 验证图片文件下载到 `Get笔记/{categoryDir}/asset/` 目录
3. 验证笔记内容底部有 `![](asset/xxx.png)` 嵌入
4. 验证重复同步时图片被跳过（不重复下载）
5. 验证预检查：删除图片文件后重新同步，笔记被更新（图片重新下载）

---

## 5. 部署

```bash
# 在 worktree 中
cd .worktrees/image-handling
npm run build
cp main.js manifest.json styles.css "/Users/zhengyan/Downloads/同步空间/9_个人笔记/郑大师的笔记本/.obsidian/plugins/obsidian-getnote-importer/"
```

如需合并到主分支：
```bash
git checkout main
git merge feature/image-handling
# 处理冲突（如有）
git push origin main
git tag x.y.z && git push origin x.y.z  # 触发 Release
```

---

## 6. 关键代码位置

| 功能 | 文件 | 行数 |
|------|------|------|
| Attachment 类型 | `src/types.ts` | 191-197 |
| assetPaths 字段 | `src/types.ts` | 19-20 |
| 图片下载 | `src/sync.ts` | 212-244 |
| 音频下载 | `src/sync.ts` | 186-197 |
| 图片嵌入 | `src/note-parser.ts` | 131-145 |
| 预检查图片 | `src/sync.ts` | 313-322 |
| enrichAudioNote 整合 | `src/sync.ts` | 496-520 |