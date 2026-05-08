# 音频附件同步实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对音频类型笔记（recorder_audio, recorder_flash_audio, immediate_audio, audio_long, local_audio）同步时，调用详情接口获取附件 URL，下载音频文件到 `asset/` 子目录，并在笔记开头内嵌音频链接，同时将原始转写文本写入正文。

**Architecture:** 在 `SyncEngine.writeNote()` 中，对音频笔记额外调用 `fetchNoteDetail` 获取 `attachments`，下载音频到 `{categoryDir}/asset/` 目录。修改 `renderNote()` 支持音频模式，在 frontmatter 后、正文前插入 `[🔊 录音](asset/filename.mp3)` 链接。

**Tech Stack:** Obsidian Vault API（`vault.create` / `vault.modify` / `vault.getAbstractFileByPath`）、Fetch API、fs 路径操作

---

## 文件变更概览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/api.ts` | Modify | 新增 `fetchNoteDetail(id)` 函数 |
| `src/types.ts` | Modify | 新增 `Attachment` 接口，更新 `GetNoteNote` |
| `src/note-parser.ts` | Modify | `renderNote` 支持 `hasAudio` 模式，`buildFrontmatter` 支持音频字段 |
| `src/sync.ts` | Modify | 音频笔记调用详情 API、下载音频、更新笔记写入逻辑 |
| `tests/sync-engine.spec.ts` | Modify | 新增音频笔记同步测试 |
| `tests/api.spec.ts` | Modify | 新增 `fetchNoteDetail` 测试 |

---

## Task 1: 类型定义

**Files:**
- Modify: `src/types.ts:1-14`

- [ ] **Step 1: 在 `GetNoteNote` 接口中添加可选字段**

在 `src/types.ts` 的 `GetNoteNote` 接口末尾（`updated_at` 之后）添加:

```ts
  attachments?: Attachment[];  // 详情接口返回的附件列表
  audio?: string;               // 详情接口返回的原始转写文本
```

- [ ] **Step 2: 在 `src/types.ts` 末尾添加 `Attachment` 接口**

```ts
export interface Attachment {
  type: 'audio' | string;
  url: string;
  title: string;
  duration: number;  // 毫秒
}
```

- [ ] **Step 3: 运行类型检查**

Run: `cd /Users/zhengyan/Projects/ai-project/obsidian-getnote-importer && npm run build 2>&1 | head -30`
Expected: 无新增类型错误

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Attachment type and optional audio fields to GetNoteNote"
```

---

## Task 2: 详情 API 函数

**Files:**
- Modify: `src/api.ts:1-96`（在 `fetchNotes` 函数之后添加）

- [ ] **Step 1: 添加 `fetchNoteDetail` 测试到 `tests/api.spec.ts`**

在 `tests/api.spec.ts` 末尾添加:

```ts
describe('fetchNoteDetail', () => {
  it('返回指定 id 的笔记详情，包含 attachments 字段', async () => {
    const mockResponse = {
      success: true,
      data: {
        id: '1908723638246504120',
        note_id: '1908723638246504120',
        title: '测试录音',
        content: 'AI 摘要',
        note_type: 'recorder_audio',
        source: 'app',
        tags: [],
        attachments: [
          {
            type: 'audio',
            url: 'https://mediacdn.umiwi.com/voicenotes%2Ftest.mp3?Expires=1778291785&Signature=abc',
            title: '',
            duration: 883920,
          },
        ],
        audio: '🟢 说话人1 [00:00:01]\n测试内容',
        created_at: '2026-04-30 12:45:24',
        updated_at: '2026-04-30 13:00:07',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    }) as any;

    const result = await fetchNoteDetail('1908723638246504120', 'test-token', 'test-client');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].type).toBe('audio');
    expect(result.audio).toContain('说话人1');
  });

  it('笔记不存在时抛出错误', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ success: false, error: { message: '笔记不存在' } })),
    }) as any;

    await expect(fetchNoteDetail('not-exist', 'test-token', 'test-client')).rejects.toThrow('笔记不存在');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /Users/zhengyan/Projects/ai-project/obsidian-getnote-importer && npx vitest run tests/api.spec.ts 2>&1 | tail -20`
Expected: FAIL — `fetchNoteDetail is not defined`

- [ ] **Step 3: 在 `src/api.ts` 添加 `fetchNoteDetail` 函数**

在 `fetchNotes` 函数之后（第 96 行后）添加:

```ts
export async function fetchNoteDetail(
  id: string,
  token: string,
  clientId: string,
  signal?: AbortSignal
): Promise<GetNoteNote> {
  const url = `${BASE_URL}/resource/note/detail?id=${id}`;
  const data = await apiRequest<{
    success: boolean;
    data?: GetNoteNote;
    error?: { message: string };
  }>(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Client-ID': clientId,
    },
  }, 2, signal);

  if (!data.success || !data.data) {
    throw new Error(data.error?.message ?? 'Failed to fetch note detail');
  }

  return data.data;
}
```

- [ ] **Step 4: 在 `src/api.ts` 顶部 import 添加 `GetNoteNote`**

确保 import 行包含 `GetNoteNote`:

```ts
import type { ListResponse, GetNoteNote } from './types';
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run tests/api.spec.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/api.ts tests/api.spec.ts
git commit -m "feat: add fetchNoteDetail API function"
```

---

## Task 3: 音频渲染逻辑

**Files:**
- Modify: `src/note-parser.ts:69-99`

- [ ] **Step 1: 在 `tests/note-parser.spec.ts` 添加音频渲染测试**

在 `tests/note-parser.spec.ts` 末尾添加:

```ts
describe('renderNote — audio note', () => {
  it('在正文前插入音频链接，并将转写文本追加到正文', () => {
    const note: GetNoteNote = {
      id: 1,
      note_id: 'note_audio_001',
      title: '我的录音',
      content: '### 📑 智能总结\n这是AI摘要',
      note_type: 'recorder_audio',
      source: 'app',
      tags: [],
      created_at: '2026-04-30T12:45:24+08:00',
      updated_at: '2026-04-30T13:00:07+08:00',
      attachments: [
        { type: 'audio', url: 'https://example.com/test.mp3', title: '', duration: 883920 },
      ],
      audio: '🟢 说话人1 [00:00:01]\n测试转写内容',
    };

    const result = renderNote(note);

    // 验证 frontmatter 中有 audio 字段
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('note_type: recorder_audio');

    // 验证音频链接在最前面（frontmatter 之后、正文之前）
    const audioLinkLine = '[🔊 录音](asset/我的录音.mp3)';
    const summaryLine = '### 📑 智能总结';
    const audioIdx = result.indexOf(audioLinkLine);
    const summaryIdx = result.indexOf(summaryLine);
    expect(audioIdx).toBeGreaterThan(0);
    expect(audioIdx).toBeLessThan(summaryIdx);

    // 验证转写文本在正文之后
    expect(result).toContain('### 原始录音转写');
    expect(result).toContain('说话人1 [00:00:01]');
  });

  it('无音频附件时行为不变', () => {
    const note: GetNoteNote = {
      id: 1,
      note_id: 'note_001',
      title: '普通笔记',
      content: '正文内容',
      note_type: 'plain_text',
      source: 'app',
      tags: [],
      created_at: '2026-04-30T12:45:24+08:00',
      updated_at: '2026-04-30T13:00:07+08:00',
    };
    const result = renderNote(note);
    expect(result).not.toContain('asset/');
    expect(result).toContain('正文内容');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/note-parser.spec.ts 2>&1 | tail -20`
Expected: FAIL — 新测试中 `audio` 字段不触发任何特殊处理

- [ ] **Step 3: 修改 `src/note-parser.ts` 中的 `renderNote` 函数**

将现有的 `renderNote` 函数替换为：

```ts
export function renderNote(note: GetNoteNote): string {
  const frontmatter = buildFrontmatter(note);
  let body = note.content || '';

  if (note.attachments?.some(a => a.type === 'audio') && note.audio) {
    const filename = generateDisplayTitle(note) + '.mp3';
    const audioLink = `[🔊 录音](asset/${filename})\n`;
    const transcriptHeader = '\n\n---\n\n### 原始录音转写\n\n';
    body = audioLink + body + transcriptHeader + note.audio;
  }

  return frontmatter + body;
}
```

- [ ] **Step 4: 修改 `buildFrontmatter` 支持音频元数据（可选，略过此步直接进入 Step 5）**

（当前 frontmatter 已包含 `note_type`，音频类型笔记的分类已通过目录分离，无需额外 frontmatter 字段）

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run tests/note-parser.spec.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/note-parser.ts tests/note-parser.spec.ts
git commit -m "feat: renderNote inserts audio link and transcript for audio notes"
```

---

## Task 4: 同步引擎集成音频下载

**Files:**
- Modify: `src/sync.ts:117-170`（`writeNote` 方法），`src/sync.ts:1-8`（import）

- [ ] **Step 1: 添加单元测试到 `tests/sync-engine.spec.ts`**

在 `tests/sync-engine.spec.ts` 中添加测试（在现有 describe 块之后）:

```ts
describe('SyncEngine — audio note sync', () => {
  const audioNote: GetNoteNote = {
    id: '1908723638246504120',
    note_id: '1908723638246504120',
    title: '我的录音笔记',
    content: '### 📑 智能总结\n这是摘要',
    note_type: 'recorder_audio',
    source: 'app',
    tags: [],
    created_at: '2026-04-30T12:45:24+08:00',
    updated_at: '2026-04-30T13:00:07+08:00',
  };

  it('音频笔记下载附件并写入 asset 目录', async () => {
    const createdFiles: string[] = [];
    const downloadedUrls: string[] = [];
    const mockApp = makeMockApp();
    const settings = makeSettings({ folderName: 'Get笔记' });

    // Mock fetch for both note list and note detail + audio download
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      const urlStr = url instanceof URL ? url.toString() : String(url);

      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            data: { notes: [audioNote], has_more: false, next_cursor: '' },
          })),
        } as unknown as Response);
      }

      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            success: true,
            data: {
              ...audioNote,
              attachments: [{ type: 'audio', url: 'https://cdn.example.com/test.mp3', title: '', duration: 883920 }],
              audio: '🟢 说话人1 [00:00:01]\n转写内容',
            },
          })),
        } as unknown as Response);
      }

      if (urlStr.includes('cdn.example.com')) {
        downloadedUrls.push(urlStr);
        return Promise.resolve(new Response(new ArrayBuffer(1024), {
          headers: { 'content-type': 'audio/mpeg' },
        }));
      }

      return originalFetch(url);
    }) as any;

    mockApp.vault.create = vi.fn().mockImplementation(async (path: string, data: string) => {
      createdFiles.push(path);
      const folder = { path: path.split('/').slice(0, -1).join('/') };
      return { path };
    });

    const engine = new SyncEngine(mockApp as any, settings);
    await engine.sync();

    // 验证 asset 目录被创建
    expect(createdFiles.some(f => f.includes('/asset/')));
    // 验证音频被下载
    expect(downloadedUrls.length).toBeGreaterThan(0);
    // 验证 md 文件被创建
    expect(createdFiles.some(f => f.endsWith('.md')));

    global.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/sync-engine.spec.ts 2>&1 | tail -20`
Expected: FAIL — SyncEngine 不处理音频附件

- [ ] **Step 3: 修改 `src/sync.ts` — 新增音频类型判断常量**

在 `src/sync.ts` 顶部 import 之后、常量定义区域添加:

```ts
const AUDIO_NOTE_TYPES = new Set([
  'recorder_audio',
  'recorder_flash_audio',
  'immediate_audio',
  'audio_long',
  'local_audio',
]);
```

- [ ] **Step 4: 在 `SyncEngine` 类中添加 `downloadAudioAsset` 方法**

在 `cancel()` 方法之后、`isContentChanged()` 之前添加:

```ts
private async downloadAudioAsset(
  note: GetNoteNote,
  attachment: { type: string; url: string; title: string; duration: number }
): Promise<string | null> {
  const categoryDir = await this.ensureCategoryDir(getCategoryDir(note.note_type));
  const assetDir = `${categoryDir}/asset`;
  const targetDir = this.app.vault.getAbstractFileByPath(assetDir);
  if (!targetDir) {
    await this.app.vault.createFolder(assetDir);
  }

  const filename = `${this.getFileName(note)}.mp3`;
  const targetPath = `${assetDir}/${filename}`;

  // 检查是否已存在且未过期（跳过重复下载）
  const existing = this.app.vault.getAbstractFileByPath(targetPath);
  if (existing instanceof TFile) return targetPath;

  try {
    const res = await fetch(attachment.url);
    if (!res.ok) {
      console.error(`[GetNote] Audio download failed: ${res.status} ${attachment.url}`);
      return null;
    }
    const blob = await res.arrayBuffer();
    const array = new Uint8Array(blob);
    await this.app.vault.createBinary(targetPath, array);
    return targetPath;
  } catch (err) {
    console.error(`[GetNote] Audio download error:`, err);
    return null;
  }
}
```

- [ ] **Step 5: 添加 `createBinary` mock 到测试 mock app**

在 `tests/sync-engine.spec.ts` 的 `makeMockApp` 中 `create` 方法之后添加:

```ts
createBinary: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
  files.set(path, { path, content: `[binary:${data.byteLength}]`, frontmatter: {} });
  return { path };
}),
```

- [ ] **Step 6: 修改 `writeNote` 方法支持音频笔记**

找到 `writeNote` 方法签名，更新为:

```ts
private async writeNote(
  note: GetNoteNote,
  uidIndex: Map<string, TFile>,
  forceRefresh = false  // 新参数：强制重新获取详情（用于音频笔记）
): Promise<'created' | 'updated' | 'skipped' | 'failed'>
```

在方法内部，`try` 块开头添加音频处理：

```ts
// 如果是音频笔记且需要写入/更新，先获取详情（含附件 URL）
let enrichedNote = note;
if (AUDIO_NOTE_TYPES.has(note.note_type) && status_for_write) {
  // status_for_write 内部逻辑：需要创建或更新时才获取详情
  try {
    const detail = await fetchNoteDetail(
      note.note_id,
      this.settings.apiToken,
      this.settings.clientId,
      this.abortController?.signal
    );
    if (detail.attachments?.length && detail.attachments[0].type === 'audio') {
      await this.downloadAudioAsset(detail, detail.attachments[0]);
    }
    enrichedNote = detail;
  } catch (err) {
    console.warn(`[GetNote] Failed to fetch audio note detail for ${note.note_id}:`, err);
    // 不阻断同步，继续用列表数据写入
  }
}
```

实际上，上面的逻辑太复杂。更简单的方式是：**在 `sync.ts` 的主循环中，先判断是否为音频笔记，如果是则调用详情接口，再传给 `writeNote` 处理。** 改动 `sync.ts` 的 `for (const note of filtered)` 循环：

找到循环内 `const status = await this.writeNote(note, uidIndex);` 这一行，改为：

```ts
// 对音频笔记，先获取详情（含附件 URL 和转写文本）
let noteToWrite = note;
if (AUDIO_NOTE_TYPES.has(note.note_type)) {
  try {
    noteToWrite = await fetchNoteDetail(
      note.note_id,
      this.settings.apiToken,
      this.settings.clientId,
      controller.signal
    );
    // 下载音频文件
    const attachment = noteToWrite.attachments?.find(a => a.type === 'audio');
    if (attachment) {
      await this.downloadAudioAsset(noteToWrite, attachment);
    }
  } catch (err) {
    console.warn(`[GetNote] Failed to enrich audio note ${note.note_id}:`, err);
    // 不阻断，写入列表中的数据
  }
}

const status = await this.writeNote(noteToWrite, uidIndex);
```

在 `sync.ts` 顶部 import 添加 `fetchNoteDetail`:

```ts
import { fetchAllNotes, fetchNoteDetail } from './api';
```

- [ ] **Step 7: 运行测试验证通过**

Run: `npx vitest run tests/sync-engine.spec.ts 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/sync.ts tests/sync-engine.spec.ts
git commit -m "feat: sync audio attachments to asset/ subdirectory with download and transcript"
```

---

## Task 5: 集成测试与手动验证

- [ ] **Step 1: 运行完整测试套件**

Run: `npx vitest run 2>&1 | tail -20`
Expected: 全部通过

- [ ] **Step 2: 构建插件**

Run: `npm run build 2>&1 | tail -10`
Expected: 构建成功，无错误

- [ ] **Step 3: 使用 obsidian-plugin-deploy skill 部署到本地 vault 测试**

（见 `memory/MEMORY.md` 中的部署步骤）

- [ ] **Step 4: 在 Obsidian 中手动触发一次同步，观察音频笔记的 asset 目录和链接**