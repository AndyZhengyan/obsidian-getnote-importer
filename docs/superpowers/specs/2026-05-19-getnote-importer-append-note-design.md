# GetNote「附加笔记」支持设计（Issue 草案）

## 背景

当前同步模型以「主笔记」为核心，一条 GetNote 记录对应一个 Obsidian 笔记文件。为了覆盖更完整的创作流，需要支持主笔记发布后的「附加笔记」（补充、更正、追记、评论总结等）。

目标：

1. 在 Obsidian 中可清晰区分主笔记与附加笔记。
2. 能从任意附加笔记快速回溯到主笔记。
3. 同步时避免文件命名冲突，且不破坏已有主笔记文件。

---

## 术语定义

- **主笔记（Primary Note）**：GetNote 原始主记录。
- **附加笔记（Append Note）**：基于某条主笔记新增的后续内容。

---

## 命名设计

### 1) 文件名策略（建议）

> 关键原则：稳定可追溯、排序友好、可读性优先。

#### 主笔记

保持现状（示例）：

```text
{prefix}_{original-note-name}.md
```

#### 附加笔记

建议追加后缀段：

```text
{prefix}_{original-note-name}__{appendId}.md
```

示例：

```text
getnote_如何学习AI__987654321098765.md
```

优势：

- 与主笔记天然聚类（同前缀）。
- 追加笔记只追加 `appendId`，规则简单，且便于幂等更新与冲突检测。
- 主笔记文件名不变，附加笔记文件只在末尾追加 ID，便于人工理解与检索。

### 2) 标题（H1）策略

附加笔记建议标题：

```markdown
# [附加] {appendTitle}
```

若无附加标题：

```markdown
# [附加] 更新于 {YYYY-MM-DD HH:mm}
```

### 3) Frontmatter 标识

附加笔记建议增加：

```yaml
type: getnote-append
getnote_primary_id: "123456789012345"
getnote_append_id: "987654321098765"
getnote_relation: "append_to_primary"
```

说明：ID 全部使用字符串，避免 JS number 精度风险。

---

## 与主笔记关联设计

### 方案 A（推荐）：双向链接 + 元数据

#### 主笔记内追加索引段

在主笔记尾部维护一个自动区块（例如 `## 附加笔记`），列出所有附加笔记：

```markdown
## 附加笔记
- [[getnote_如何学习AI__987654321098765]] · 2026-05-19 10:30
- [[getnote_如何学习AI__987654321099001]] · 2026-05-19 18:45
```

#### 附加笔记头部回链

在附加笔记中固定包含：

```markdown
> 关联主笔记：[[getnote_如何学习AI]]
```

#### 同步行为

- 新增附加笔记：创建附加文件 + 更新主笔记索引区。
- 更新附加笔记：按 `getnote_append_id` 定位并覆写附加文件内容；主笔记索引按 ID 去重。
- 删除/不可见附加笔记（若 API 提供状态）：在主笔记索引标记为已删除或移除链接（由设置决定）。

优点：

- 与 Obsidian 的链接视图、反向链接能力天然兼容。
- 即使 frontmatter 不被查询，用户也能直接从正文导航。

### 方案 B：仅靠 Frontmatter 关系（不推荐单独使用）

只在元数据中存关系，不写正文链接。虽然结构化程度高，但日常浏览路径差，不利于非 Dataview 用户。

---

## 建议 Issue 标题与内容

### 标题候选

1. `feat(sync): support append notes for GetNote primary notes`
2. `feat: import GetNote appended notes and link to primary notes`
3. `sync: add primary-append note relationship support`

推荐使用 **2**（突出“附加笔记 + 主笔记关联”的目标）。

### Issue 描述草案

```markdown
## Problem
Current importer maps one GetNote primary note to one Obsidian file.
It does not support appended notes created after the primary note is published.

## Goal
- Import appended notes as separate Obsidian files.
- Keep stable linkage between each append note and its primary note.
- Provide easy navigation both from primary -> append and append -> primary.

## Proposed Design
### Naming
- Primary: `{prefix}_{original-note-name}.md`
- Append: `{prefix}_{original-note-name}__{appendId}.md`

### Metadata (append note frontmatter)
- `type: getnote-append`
- `getnote_primary_id: "<string>"`
- `getnote_append_id: "<string>"`
- `getnote_relation: "append_to_primary"`

### Linking
- Primary note keeps an auto-managed `## 附加笔记` section listing append note wikilinks.
- Append note includes a backlink line to the primary note.

## Acceptance Criteria
- [ ] New append notes are imported as independent files.
- [ ] Re-sync updates existing append notes by `getnote_append_id` (idempotent).
- [ ] Primary note shows deduplicated append links.
- [ ] Append note includes a backlink to its primary note.
- [ ] All IDs are handled as strings to avoid numeric precision loss.

## Risks / Notes
- Avoid overwriting user-edited content outside managed sections.
- Clarify behavior when append note is deleted or hidden upstream.
```
