import { describe, it, expect, vi, afterEach } from 'vitest';
import { App, TFile } from 'obsidian';
import { BidirectionalSyncEngine, syncDirection, insideSyncFolder, isGeneratedAssetPath, readSyncNote, replaceSyncContent } from '../src/bidirectional-sync';
import { addNotesToKnowledgeBase, createNote, fetchNoteDetail } from '../src/api';
import { updateNote } from '../src/api-clients/openapi-client';
import { renderNote } from '../src/note-parser';
import { parseJsonPreservingIds } from '../src/api-clients/api-client-utils';
import { DEFAULT_SETTINGS, type GetNoteNote } from '../src/types';

vi.mock('../src/api', () => ({ fetchNoteDetail: vi.fn(), createNote: vi.fn(), addNotesToKnowledgeBase: vi.fn() }));
vi.mock('../src/api-clients/openapi-client', () => ({ updateNote: vi.fn() }));
vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(),
  // Fixtures use the importer's flow-style YAML (JSON strings and arrays).
  parseYaml: (text: string) => Object.fromEntries(text.split('\n').map(line => {
    const index = line.indexOf(':');
    const value = line.slice(index + 1).trim();
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* YAML plain scalar */ }
    return [line.slice(0, index), parsed];
  })),
}));
const remote: GetNoteNote = { id: '90071992547409999', note_id: '90071992547409999', title: '标题',
  content: '原文', tags: [{ name: '工作' }], note_type: 'plain_text', source: 'app', created_at: '', updated_at: '' };
function fixture(body = renderNote(remote)) {
  const app = new App();
  const file = new TFile('Sync/纯文本/笔记.md');
  // Default mtime of 0 mirrors a freshly imported legacy file — older than
  // any reverse-sync timestamp set during the test, so the early-exit would
  // skip it once `lastReverseFullSyncAt` is set.
  file.stat = { ctime: 0, mtime: 0, size: 0 };
  const contents = new Map([[file.path, body]]);
  app.vault.getMarkdownFiles = () => [file];
  app.vault.getAbstractFileByPath = path => path === file.path ? file : null;
  app.vault.read = vi.fn(async f => contents.get(f.path)!);
  app.vault.process = vi.fn(async (f, transform) => {
    const next = transform(contents.get(f.path)!); contents.set(f.path, next); return next;
  });
  app.vault.createFolder = vi.fn(async () => undefined);
  app.fileManager = { renameFile: vi.fn(async (f: TFile, path: string) => {
    const oldPath = f.path; contents.set(path, contents.get(oldPath)!); contents.delete(oldPath); f.path = path;
  }) } as never;
  const settings = { ...DEFAULT_SETTINGS, folderName: 'Sync', authMode: 'openapi' as const,
    openApiToken: 'test', openApiClientId: 'test', reverseSync: { enabled: true } };
  vi.mocked(fetchNoteDetail).mockResolvedValue(remote);
  return { app, file, contents, settings };
}
afterEach(() => vi.resetAllMocks());
describe('bidirectional content decisions', () => {
  it('distinguishes local, remote and simultaneous changes without timestamps', () => {
    expect(syncDirection('a', 'a')).toBe('equal');
    expect(syncDirection('b', 'a', 'a')).toBe('upload');
    expect(syncDirection('a', 'b', 'a')).toBe('download');
    expect(syncDirection('b', 'c', 'a')).toBe('conflict');
    expect(syncDirection('b', 'c')).toBe('conflict');
  });
  it('uses a path boundary and supports the vault root', () => {
    expect(insideSyncFolder('Sync2/a.md', 'Sync')).toBe(false);
    expect(insideSyncFolder('Sync/sub/a.md', '/Sync/')).toBe(true);
    expect(insideSyncFolder('a.md', '')).toBe(true);
  });
  it('recognizes generated asset folders and filenames', () => {
    expect(isGeneratedAssetPath('Sync/录音笔记/asset/note_transcript.md')).toBe(true);
    expect(isGeneratedAssetPath('Sync/纯文本/note_transcript.md')).toBe(false);
    expect(isGeneratedAssetPath('Sync/纯文本/note_original.md')).toBe(false);
    expect(isGeneratedAssetPath('Sync/纯文本/my transcript.md')).toBe(false);
  });
  it('preserves local frontmatter and appendix while changing only source content', () => {
    const raw = renderNote(remote).replace('uid:', 'custom: "keep"\nuid:') + '\n我的附注 [[链接]]';
    const parsed = readSyncNote(raw)!;
    const updated = replaceSyncContent(parsed, { title: '标题', tags: [], body: '新内容 $&' });
    expect(updated).toContain('custom: "keep"');
    expect(updated).toContain('我的附注 [[链接]]');
    expect(readSyncNote(updated)?.body).toBe('新内容 $&');
    expect(readSyncNote(updated)?.tags).toEqual([]);
  });
});
describe('bidirectional engine', () => {
  it('preserves an unquoted unsafe UID through selected sync without creating a note', async () => {
    const f = fixture(renderNote(remote).replace(`uid: "${remote.note_id}"`, `uid: ${remote.note_id}`));
    expect(readSyncNote(f.contents.get(f.file.path)!)?.uid).toBe(remote.note_id);
    await new BidirectionalSyncEngine(f.app, f.settings).sync([remote.note_id], { direction: 'download' });
    expect(fetchNoteDetail).toHaveBeenCalledWith(remote.note_id, expect.anything(), expect.anything(), expect.anything(), 'openapi');
    expect(createNote).not.toHaveBeenCalled();
  });
  it.each(['9007199254740993', '1900000000000000016', '1900000000000000100'])('round-trips numeric API identity %s through rendering and legacy YAML without rounding or trimming zeros', async uid => {
    const parsed = parseJsonPreservingIds(`{"note_id":${uid}}`) as { note_id: string };
    const note = { ...remote, id: parsed.note_id, note_id: parsed.note_id };
    const rendered = renderNote(note);
    expect(rendered).toContain(`uid: "${uid}"`);
    for (const raw of [rendered, rendered.replace(`uid: "${uid}"`, `uid: ${uid}`)]) {
      const f = fixture(raw);
      vi.mocked(fetchNoteDetail).mockResolvedValue(note);
      expect(readSyncNote(raw)?.uid).toBe(uid);
      await new BidirectionalSyncEngine(f.app, f.settings).sync([uid], { direction: 'download' });
      expect(fetchNoteDetail).toHaveBeenLastCalledWith(uid, expect.anything(), expect.anything(), expect.anything(), 'openapi');
      expect(readSyncNote(f.contents.get(f.file.path)!)?.uid).toBe(uid);
    }
    expect(createNote).not.toHaveBeenCalled();
  });

  it('never reconciles or explicitly uploads an archived identity copy', async () => {
    const raw = renderNote(remote).replace('uid:', 'dedao_sync_archived: true\nuid:');
    const f = fixture(raw);
    const engine = new BidirectionalSyncEngine(f.app, f.settings);
    expect((await engine.sync([remote.note_id])).total).toBe(0);
    await expect(engine.uploadNewFile(f.file)).rejects.toThrow('归档');
    expect(fetchNoteDetail).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(f.contents.get(f.file.path)).toBe(raw);
  });

  it('does not hide missing baseline errors behind a previous full-sync timestamp', async () => {
    const raw = `---\nuid: "${remote.note_id}"\ntitle: "标题"\ntags: ["工作"]\n---\n本地修改`;
    const f = fixture(raw);
    f.settings.reverseSync.lastReverseFullSyncAt = Date.now();
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { changedOnly: true });
    expect(result.items?.[0].error).toContain('同步基线');
    f.settings.syncHistory = [{ id: 'previous', startedAt: 1, finishedAt: 2, durationMs: 1, timestamp: 2, type: 'auto', status: 'partial', result }];
    vi.mocked(fetchNoteDetail).mockClear();
    const repeat = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { changedOnly: true });
    expect(repeat.items?.[0].error).toBe(result.items?.[0].error);
    expect(fetchNoteDetail).not.toHaveBeenCalled();
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'download' });
    expect(fetchNoteDetail).toHaveBeenCalled();
    expect(f.contents.get(f.file.path)).toBe(raw);
    expect(updateNote).not.toHaveBeenCalled();
  });

  it('rechecks a transient error rather than carrying it forward forever', async () => {
    const f = fixture();
    f.settings.reverseSync.lastReverseFullSyncAt = Date.now();
    f.settings.syncHistory = [{ id: 'previous', startedAt: 1, finishedAt: 2, durationMs: 1, timestamp: 2, type: 'auto', status: 'partial', result: {
      created: 0, updated: 0, skipped: 1, failed: 0, total: 1,
      items: [{ noteId: remote.note_id, title: remote.title, noteType: '', updatedAt: '', status: 'skipped', error: 'temporary network error' }],
    } }];
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { changedOnly: true });
    expect(result.items?.[0].error).toBeUndefined();
    expect(fetchNoteDetail).toHaveBeenCalledOnce();
  });

  it('reports local scanning and upload progress before the remote request completes', async () => {
    const f = fixture('new draft');
    const progress = vi.fn();
    vi.mocked(createNote).mockImplementation(async () => {
      expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
        message: '正在上传本地内容', count: expect.stringContaining('1'), percent: undefined, phase: 'active',
      }));
      return { noteId: remote.note_id };
    });
    await new BidirectionalSyncEngine(f.app, f.settings, undefined, progress).sync();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ message: '正在检查本地修改', percent: undefined }));
    expect(createNote).toHaveBeenCalledOnce();
  });
  it('reports remote comparison before waiting for a detail response', async () => {
    const f = fixture();
    const progress = vi.fn();
    vi.mocked(fetchNoteDetail).mockImplementation(async () => {
      expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ message: '正在核对远端笔记', percent: undefined }));
      return remote;
    });
    await new BidirectionalSyncEngine(f.app, f.settings, undefined, progress).sync();
    expect(fetchNoteDetail).toHaveBeenCalled();
  });

  it.each(['', '   ', '---\nuid: 123\n---\ntext', '---\nnote_type: "link"\n---\ntext'])('does not create invalid drafts (%s)', async raw => {
    const f = fixture(raw);
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(createNote).not.toHaveBeenCalled();
  });
  it('does not upload unselected new notes', async () => {
    const f = fixture('new note');
    await new BidirectionalSyncEngine(f.app, f.settings).sync([remote.note_id]);
    expect(createNote).not.toHaveBeenCalled();
  });
  it.each([
    'Sync/录音笔记/asset/note.md',
    'Sync/录音笔记/assets/note.md',
    'Sync/_original/note.md',
  ])('does not upload generated asset %s', async path => {
    const f = fixture('generated content');
    f.file.path = path;
    f.contents.clear(); f.contents.set(path, 'generated content');
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(createNote).not.toHaveBeenCalled();
  });
  it('uploads a user-authored draft whose filename ends in transcript', async () => {
    const f = fixture('user transcript');
    f.file.path = 'Sync/纯文本/interview_transcript.md';
    f.contents.clear(); f.contents.set(f.file.path, 'user transcript');
    vi.mocked(createNote).mockResolvedValue({ noteId: remote.note_id });
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).created).toBe(1);
  });
  it('does not upload a generated asset marked in frontmatter outside an asset folder', async () => {
    const f = fixture('---\ndedao_generated_asset: transcript\ndedao_parent_uid: "parent"\n---\ngenerated');
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).total).toBe(0);
    expect(createNote).not.toHaveBeenCalled();
  });
  it('stops the draft batch after the first rate limit and preserves the previous checkpoint', async () => {
    const f = fixture('first draft');
    const second = new TFile('Sync/Inbox/second.md');
    f.contents.set(second.path, 'second draft');
    f.app.vault.getMarkdownFiles = () => [f.file, second];
    f.app.vault.getAbstractFileByPath = path => path === f.file.path ? f.file : path === second.path ? second : null;
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: 123 };
    vi.mocked(createNote).mockRejectedValue(new Error('API 调用频率过高，请稍后再试'));
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.failed).toBe(1);
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(f.settings.reverseSync.lastReverseFullSyncAt).toBe(123);
  });
  it('also stops a draft batch when the daily quota is exhausted', async () => {
    const f = fixture('first draft');
    const second = new TFile('Sync/Inbox/second.md');
    f.contents.set(second.path, 'second draft');
    f.app.vault.getMarkdownFiles = () => [f.file, second];
    f.app.vault.getAbstractFileByPath = path => path === f.file.path ? f.file : path === second.path ? second : null;
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: 123 };
    vi.mocked(createNote).mockRejectedValue(new Error('API 配额已用完，请明天再试'));
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(1);
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(f.settings.reverseSync.lastReverseFullSyncAt).toBe(123);
  });
  it('blocks a second POST after an uncertain network outcome across engine instances', async () => {
    const f = fixture('new note');
    vi.mocked(createNote).mockRejectedValue(new Error('Connection lost'));
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(1);
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(f.contents.get(f.file.path)).toContain('dedao_upload_state: "pending"');
  });
  it('saves returned identity even when cancelled and preserves edits during creation', async () => {
    const f = fixture('new note');
    const engine = new BidirectionalSyncEngine(f.app, f.settings);
    vi.mocked(createNote).mockImplementation(async () => {
      f.contents.set(f.file.path, f.contents.get(f.file.path)!.replace('new note', 'newer local edit'));
      engine.cancel();
      return { noteId: remote.note_id };
    });
    await expect(engine.sync()).rejects.toThrow('Aborted');
    expect(f.contents.get(f.file.path)).toContain(`uid: "${remote.note_id}"`);
    expect(f.contents.get(f.file.path)).toContain('newer local edit');
    expect(f.contents.get(f.file.path)).toContain('dedao_upload_state: "archive"');
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(f.contents.get(f.file.path)).toContain('dedao_upload_state: "complete"');
  });
  it('blocks creation when the archive target already exists', async () => {
    const f = fixture('new note');
    f.app.vault.getAbstractFileByPath = () => new TFile('Sync/纯文本/笔记.md');
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(1);
    expect(createNote).not.toHaveBeenCalled();
  });
  it('keeps the UID and retries only archiving after a move failure', async () => {
    const f = fixture('new note');
    f.settings.filenamePrefix = 'archived';
    vi.mocked(createNote).mockResolvedValue({ noteId: remote.note_id });
    vi.mocked(f.app.fileManager.renameFile).mockRejectedValueOnce(new Error('Move failed'));
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(1);
    expect(f.contents.get(f.file.path)).toContain(`uid: "${remote.note_id}"`);
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(f.file.path).toBe('Sync/纯文本/archived_笔记.md');
  });
  it('keeps pending state if saving the returned ID fails and reports the ID', async () => {
    const f = fixture('new note');
    vi.mocked(createNote).mockImplementation(async () => {
      vi.mocked(f.app.vault.process).mockRejectedValueOnce(new Error('Disk full'));
      return { noteId: remote.note_id };
    });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.items?.[0].error).toContain(remote.note_id);
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(createNote).toHaveBeenCalledTimes(1);
  });
  it('creates a local draft remotely, records its uid and archives it', async () => {
    const f = fixture('本地新笔记');
    f.contents.set('Sync/Inbox/本地新笔记.md', f.contents.get(f.file.path)!);
    f.contents.delete(f.file.path);
    f.file.path = 'Sync/Inbox/本地新笔记.md';
    vi.mocked(createNote).mockResolvedValue({ noteId: '12345678901234567890' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.created).toBe(1);
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ title: '笔记', content: '本地新笔记', noteType: 'plain_text' }));
    expect(f.file.path).toMatch(/^Sync\/纯文本\/笔记\.md$/);
    expect(f.contents.get(f.file.path)).toContain('uid: "12345678901234567890"');
    expect(fetchNoteDetail).not.toHaveBeenCalled();
  });
  it('skips unchanged UID notes during changed-only reconciliation', async () => {
    const f = fixture();
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'both', changedOnly: true });
    expect(result.total).toBe(0);
    expect(fetchNoteDetail).not.toHaveBeenCalled();
  });
  it('reconciles locally changed UID notes during changed-only reconciliation', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    vi.mocked(fetchNoteDetail).mockResolvedValueOnce(remote).mockResolvedValueOnce(remote)
      .mockResolvedValueOnce({ ...remote, content: '本地修改' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'both', changedOnly: true });
    expect(result.updated).toBe(1);
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ id: remote.note_id, content: '本地修改' }));
  });
  it('still uploads UID-less drafts during changed-only reconciliation', async () => {
    const f = fixture('本地新笔记');
    vi.mocked(createNote).mockResolvedValue({ noteId: '12345678901234567890' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'both', changedOnly: true });
    expect(result.created).toBe(1);
    expect(createNote).toHaveBeenCalledTimes(1);
  });
  it('creates a local draft in its knowledge base and keeps the local knowledge-base path', async () => {
    const f = fixture('本地知识库笔记');
    f.file.path = 'Sync/知识库/我的知识库/本地知识库笔记.md';
    f.file.basename = '本地知识库笔记';
    f.contents.clear(); f.contents.set(f.file.path, '本地知识库笔记');
    f.settings.knowledgeBaseCache = { entries: [{ topicId: 'kb-1', name: '我的知识库', source: 'created' }], updatedAt: Date.now() };
    vi.mocked(createNote).mockResolvedValue({ noteId: 'kb-note-1' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.created).toBe(1);
    expect(addNotesToKnowledgeBase).toHaveBeenCalledWith(expect.objectContaining({ topicId: 'kb-1', noteIds: ['kb-note-1'] }));
    expect(f.file.path).toBe('Sync/知识库/我的知识库/本地知识库笔记.md');
  });
  it('uploads to the original string ID and verifies the result', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    vi.mocked(fetchNoteDetail).mockResolvedValueOnce(remote).mockResolvedValueOnce(remote)
      .mockResolvedValueOnce({ ...remote, content: '本地修改' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.updated).toBe(1);
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ id: remote.note_id, content: '本地修改' }));
    expect(updateNote).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.anything() }));
  });
  it('downloads remote changes into the same file without touching the appendix', async () => {
    const f = fixture(renderNote(remote) + '\n本地附注');
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: '远端修改' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.updated).toBe(1);
    expect(f.contents.get(f.file.path)).toContain('远端修改');
    expect(f.contents.get(f.file.path)).toContain('本地附注');
    expect(updateNote).not.toHaveBeenCalled();
  });
  it('retains both copies on automatic conflicts', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: '远端修改' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.failed).toBe(1); expect(updateNote).not.toHaveBeenCalled();
    expect(f.app.vault.process).not.toHaveBeenCalled();
  });
  it('allows an explicit manual choice after showing both versions', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: '远端修改' });
    const choose = vi.fn().mockResolvedValue('download');
    const result = await new BidirectionalSyncEngine(f.app, f.settings, choose).sync();
    expect(result.updated).toBe(1);
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ path: f.file.path,
      local: expect.objectContaining({ body: '本地修改' }), remote: expect.objectContaining({ body: '远端修改' }) }));
  });
  it('stops when the remote changes while a conflict is being reviewed', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    vi.mocked(fetchNoteDetail).mockResolvedValueOnce({ ...remote, content: '第一次修改' })
      .mockResolvedValueOnce({ ...remote, content: '第二次修改' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings, async () => 'upload').sync();
    expect(result.failed).toBe(1); expect(updateNote).not.toHaveBeenCalled();
  });
  it('stops when local content changes during a remote request', async () => {
    const f = fixture();
    vi.mocked(fetchNoteDetail).mockImplementation(async () => {
      f.contents.set(f.file.path, '正在编辑'); return { ...remote, content: '远端修改' };
    });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.failed).toBe(1); expect(f.contents.get(f.file.path)).toBe('正在编辑');
  });
  it('does not create a replacement when the remote note was deleted', async () => {
    const f = fixture(); vi.mocked(fetchNoteDetail).mockRejectedValue(new Error('404'));
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).skipped).toBe(1);
    expect(updateNote).not.toHaveBeenCalled(); expect(f.app.vault.process).not.toHaveBeenCalled();
  });
  it('never requests remote deletion for a missing local note', async () => {
    const f = fixture(); f.app.vault.getMarkdownFiles = () => [];
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).total).toBe(0);
    expect(fetchNoteDetail).not.toHaveBeenCalled();
  });
  it('ignores independent upload folders and unselected IDs', async () => {
    const f = fixture(); f.file.path = 'Inbox/upload.md';
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    f.file.path = 'Sync/纯文本/笔记.md';
    await new BidirectionalSyncEngine(f.app, f.settings).sync(['different-id']);
    expect(fetchNoteDetail).not.toHaveBeenCalled();
  });
  it('refuses duplicate identities', async () => {
    const f = fixture(); f.app.vault.getMarkdownFiles = () => [f.file, f.file];
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(2);
    expect(fetchNoteDetail).not.toHaveBeenCalled();
  });
  it('retains the old baseline when the server does not confirm an update', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    const original = f.contents.get(f.file.path);
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(1);
    expect(f.contents.get(f.file.path)).toBe(original);
  });
  it('handles an uploaded local note without importer markers after manual reconciliation', async () => {
    const f = fixture('---\nuid: "90071992547409999"\ntitle: "标题"\ntags: ["工作"]\n---\n本地新笔记');
    const result = await new BidirectionalSyncEngine(f.app, f.settings, async () => 'download').sync();
    expect(result.updated).toBe(1);
    expect(readSyncNote(f.contents.get(f.file.path)!)?.body).toBe('原文');
    expect(readSyncNote(f.contents.get(f.file.path)!)?.baseline).toBeTruthy();
  });
  it('bootstraps an unchanged legacy body without uploading its generated relation links', async () => {
    const f = fixture(`---\nuid: "${remote.note_id}"\ntitle: "标题"\ntags: ["工作"]\nsource: 得到大脑\ncreated: 2026-01-01\n---\n原文\n\n> ⬆️ 主笔记: [[主笔记]]\n`);
    const engine = new BidirectionalSyncEngine(f.app, f.settings);
    expect((await engine.sync()).failed).toBe(0);
    expect(readSyncNote(f.contents.get(f.file.path)!)?.body).toBe('原文');
    expect(f.contents.get(f.file.path)).toContain('> ⬆️ 主笔记: [[主笔记]]');
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(0);
    expect(updateNote).not.toHaveBeenCalled();
  });
  it.each(['Get笔记', '得到大脑'])('uses the remote title when a %s legacy note has the same body', async source => {
    const oldRemote = { ...remote, title: '远端标题', content: '0123456789 原始正文' };
    const raw = `---\nuid: "${remote.note_id}"\ntitle: "0123456789"\ntags: ["工作"]\nsource: ${source}\ncreated: 2026-01-01\n---\n${oldRemote.content}\n`;
    const f = fixture(raw);
    vi.mocked(fetchNoteDetail).mockResolvedValue(oldRemote);
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    const local = readSyncNote(f.contents.get(f.file.path)!)!;
    expect(result.items?.[0].error).toBeUndefined();
    expect(local.baseline).toBeTruthy();
    expect(local.title).toBe('远端标题');
    expect(local.body).toBe(oldRemote.content);
    expect(local.remoteBaseline).toBe(local.baseline);
    expect(updateNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it('treats refreshed signatures for the same imported image as equal and adopts the remote projection', async () => {
    const oldUrl = 'httpsget-notes.umiwi.com/get_notes_prod%2Fgetnotes_img_abc123.jpeg?Expires=1&OSSAccessKeyId=old&Signature=old';
    const newUrl = 'https://example.oss-accelerate.aliyuncs.com/get_notes_prod%2Fgetnotes_img_abc123.jpeg?Expires=2&OSSAccessKeyId=new&Signature=new';
    const body = (url: string) => `相同文字\n![图](${url})`;
    const f = fixture(`---\nuid: "${remote.note_id}"\ntitle: "本地标题"\ntags: ["旧标签"]\nsource: 得到大脑\ncreated: 2026-01-01\n---\n${body(oldUrl)}`);
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, title: '远端标题', tags: [{ name: '新标签' }], content: body(newUrl) });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    const local = readSyncNote(f.contents.get(f.file.path)!)!;
    expect(result.failed).toBe(0);
    expect(local.title).toBe('远端标题');
    expect(local.tags).toEqual(['新标签']);
    expect(local.body).toBe(body(newUrl));
    expect(local.baseline).toBe(local.remoteBaseline);
    expect(updateNote).not.toHaveBeenCalled();
  });

  it.each([
    ['different prose', '修改文字\n![图](https://example.oss-accelerate.aliyuncs.com/get_notes_prod%2Fgetnotes_img_abc123.jpeg?OSSAccessKeyId=new&Signature=new)'],
    ['different image', '相同文字\n![图](https://example.oss-accelerate.aliyuncs.com/get_notes_prod%2Fgetnotes_img_other.jpeg?OSSAccessKeyId=new&Signature=new)'],
  ])('keeps a missing baseline when a legacy note has %s', async (_case, remoteBody) => {
    const localBody = '相同文字\n![图](httpsget-notes.umiwi.com/get_notes_prod%2Fgetnotes_img_abc123.jpeg?OSSAccessKeyId=old&Signature=old)';
    const raw = `---\nuid: "${remote.note_id}"\ntitle: "本地标题"\ntags: ["工作"]\nsource: 得到大脑\ncreated: 2026-01-01\n---\n${localBody}`;
    const f = fixture(raw);
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: remoteBody });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.items?.[0].error).toContain('同步基线');
    expect(f.contents.get(f.file.path)).toBe(raw);
    expect(updateNote).not.toHaveBeenCalled();
  });

  it('does not bootstrap substantive legacy edits or report them as proven conflicts in automatic sync', async () => {
    const f = fixture(`---\nuid: "${remote.note_id}"\ntitle: "标题"\ntags: ["工作"]\n---\n本地修改`);
    const before = f.contents.get(f.file.path);
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(result.failed).toBe(0);
    expect(result.items?.[0].error).toContain('同步基线');
    expect(f.contents.get(f.file.path)).toBe(before);
    expect(updateNote).not.toHaveBeenCalled();
  });
  it('keeps separate local and remote baselines for upload transformations', async () => {
    const f = fixture('![image](https://example.com/a.png)');
    vi.mocked(createNote).mockResolvedValue({ noteId: remote.note_id });
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, title: '笔记', tags: [], content: '[image](https://example.com/a.png)' });
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(0);
    expect(updateNote).not.toHaveBeenCalled();
    expect(f.contents.get(f.file.path)).toContain('![image]');
  });
  it('does not upload if an edit occurs during the second remote check', async () => {
    const f = fixture(renderNote(remote).replace('\n原文\n', '\n本地修改\n'));
    vi.mocked(fetchNoteDetail).mockResolvedValueOnce(remote).mockImplementationOnce(async () => {
      f.contents.set(f.file.path, '编辑未停止'); return remote;
    });
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync()).failed).toBe(1);
    expect(updateNote).not.toHaveBeenCalled();
  });
  it('cancels without submitting a write', async () => {
    const f = fixture(); const engine = new BidirectionalSyncEngine(f.app, f.settings); engine.cancel();
    await expect(engine.sync()).rejects.toThrow('Aborted');
    expect(updateNote).not.toHaveBeenCalled();
  });
  it('rejects unverified Web API writes', async () => {
    const f = fixture();
    await expect(new BidirectionalSyncEngine(f.app, { ...f.settings, authMode: 'web' }).sync()).rejects.toThrow();
    expect(updateNote).not.toHaveBeenCalled();
  });
  it('skips fetchNoteDetail in both mode when file mtime is older than the last reverse sync', async () => {
    const f = fixture();
    // Pretend a previous reverse sync completed recently. The fixture file's
    // default mtime is 0, which is older than Date.now(), so the mtime-based
    // early-exit should fire and skip fetchNoteDetail.
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: Date.now() };
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(fetchNoteDetail).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });
  it('forces a fetch on the first run when lastReverseFullSyncAt is unset', async () => {
    const f = fixture();
    // Explicitly unset lastReverseFullSyncAt to simulate the very first run.
    // canSkipUnchangedEntry returns false (last=0), so every file is fetched
    // and the cached remote baselines are populated.
    f.settings.reverseSync = { ...f.settings.reverseSync };
    delete f.settings.reverseSync.lastReverseFullSyncAt;
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(fetchNoteDetail).toHaveBeenCalled();
    expect(f.settings.reverseSync.lastReverseFullSyncAt).toBeGreaterThan(0);
  });
  it('forces a fetch when the file was saved locally after the last reverse sync', async () => {
    const f = fixture();
    const lastSync = Date.now();
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: lastSync };
    // User edited the file locally after the last sync — mtime is now newer
    // than lastSync, so we must fetch to check the remote state and decide
    // between upload, download, or conflict.
    f.file.stat.mtime = lastSync + 1000;
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(fetchNoteDetail).toHaveBeenCalled();
  });
  it('does not skip in download direction even when mtime is older than the last sync', async () => {
    const f = fixture();
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: Date.now() };
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'download' });
    expect(fetchNoteDetail).toHaveBeenCalled();
  });
  it('updates lastReverseFullSyncAt after a successful sync run', async () => {
    const f = fixture();
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: 0 };
    const before = Date.now();
    await new BidirectionalSyncEngine(f.app, f.settings).sync();
    expect(f.settings.reverseSync.lastReverseFullSyncAt).toBeGreaterThanOrEqual(before);
  });
});

describe('independent sync directions', () => {
  it('explicit download bypasses the legacy toggle but never uploads local drafts or edits', async () => {
    for (const raw of ['new draft', renderNote(remote).replace('\n原文\n', '\n本地修改\n')]) {
      const f = fixture(raw);
      f.settings.reverseSync.enabled = false;
      await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'download' });
      expect(f.contents.get(f.file.path)).toBe(raw);
    }
    expect(createNote).not.toHaveBeenCalled(); expect(updateNote).not.toHaveBeenCalled();
  });
  it('download uses the Web API prime ID and preserves remote identity', async () => {
    const f = fixture(renderNote(remote).replace('uid:', 'prime_id: "detail-id"\nuid:'));
    f.settings = { ...f.settings, authMode: 'web' } as never;
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: '远端修改' });
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'download' });
    expect(result.updated).toBe(1);
    expect(fetchNoteDetail).toHaveBeenCalledWith('detail-id', expect.any(String), expect.any(String), expect.any(AbortSignal), 'web');
    expect(readSyncNote(f.contents.get(f.file.path)!)?.uid).toBe(remote.note_id);
  });
  it('upload does not fetch or download changes when local content is unchanged', async () => {
    const f = fixture();
    // Pretend a previous reverse sync already verified the remote state, so the
    // baseline-equals-local early-exit can trust the cached baselines and skip
    // fetchNoteDetail.
    f.settings.reverseSync = { ...f.settings.reverseSync, lastReverseFullSyncAt: Date.now() };
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: '远端修改' });
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload' });
    expect(fetchNoteDetail).not.toHaveBeenCalled(); expect(f.app.vault.process).not.toHaveBeenCalled();
  });
  it.each(['upload', 'download'] as const)('rejects a conflict choice in the opposite direction to %s', async mode => {
    const raw = renderNote(remote).replace('\n原文\n', '\n本地修改\n');
    const f = fixture(raw);
    vi.mocked(fetchNoteDetail).mockResolvedValue({ ...remote, content: '远端修改' });
    const resolve = vi.fn(async () => mode === 'upload' ? 'download' as const : 'upload' as const);
    await new BidirectionalSyncEngine(f.app, f.settings, resolve).sync(undefined, { direction: mode });
    expect(resolve).toHaveBeenCalled(); expect(updateNote).not.toHaveBeenCalled();
    expect(f.contents.get(f.file.path)).toBe(raw);
  });
  it('uploads new files from another selected folder in place and never repeats their POST', async () => {
    const f = fixture('draft');
    f.file.path = 'Work/new.md'; f.contents.set(f.file.path, 'draft');
    f.settings.reverseSync.enabled = false;
    vi.mocked(createNote).mockResolvedValue({ noteId: remote.note_id });
    const options = { direction: 'upload' as const, folder: 'Work', paths: ['Work/new.md'] };
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, options)).created).toBe(1);
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, options);
    expect(f.file.path).toBe('Work/new.md'); expect(f.app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(createNote).toHaveBeenCalledTimes(1); expect(fetchNoteDetail).not.toHaveBeenCalled();
  });
  it('ignores events outside the exact selected path list and folder boundary', async () => {
    const f = fixture('draft');
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload', folder: 'Sync', paths: ['Sync/other.md'] });
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload', folder: 'Syn' });
    expect(createNote).not.toHaveBeenCalled();
  });
  it.each(['unknown-id', 'ambiguous-name', 'read-only'])('blocks unsafe knowledge-base mapping: %s', async scenario => {
    const f = fixture(scenario === 'unknown-id' ? '---\ntopic_id: "unknown"\n---\ndraft' : 'draft');
    f.file.path = 'Sync/知识库/KB/new.md'; f.contents.set(f.file.path, f.contents.values().next().value!);
    f.settings.knowledgeBaseCache = { updatedAt: 1, entries: scenario === 'ambiguous-name'
      ? [{ topicId: 'a', name: 'KB', source: 'created' }, { topicId: 'b', name: 'KB', source: 'created' }]
      : [{ topicId: 'a', name: 'KB', source: scenario === 'read-only' ? 'subscribed' : 'created' }] };
    expect((await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload' })).failed).toBe(1);
    expect(createNote).not.toHaveBeenCalled();
  });
  it('download leaves pending attachment untouched; upload retries attachment without repeating creation', async () => {
    const f = fixture('draft');
    f.file.path = 'Sync/知识库/KB/new.md'; f.contents.set(f.file.path, 'draft');
    f.settings.knowledgeBaseCache = { updatedAt: 1, entries: [{ topicId: 'kb', name: 'KB', source: 'created' }] };
    vi.mocked(createNote).mockResolvedValue({ noteId: remote.note_id });
    vi.mocked(addNotesToKnowledgeBase).mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(undefined);
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload' });
    const pending = f.contents.get(f.file.path)!;
    expect(pending).toContain('dedao_upload_state: "attach"');
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'download' });
    expect(addNotesToKnowledgeBase).toHaveBeenCalledTimes(1);
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload' });
    expect(addNotesToKnowledgeBase).toHaveBeenCalledTimes(2); expect(createNote).toHaveBeenCalledTimes(1);
    expect(f.contents.get(f.file.path)).toContain('dedao_upload_state: "complete"');
  });
  it('stops and preserves the checkpoint when pending attachment recovery is rate limited', async () => {
    const f = fixture('draft');
    f.file.path = 'Sync/知识库/KB/new.md'; f.contents.set(f.file.path, 'draft');
    f.settings.knowledgeBaseCache = { updatedAt: 1, entries: [{ topicId: 'kb', name: 'KB', source: 'created' }] };
    vi.mocked(createNote).mockResolvedValue({ noteId: remote.note_id });
    vi.mocked(addNotesToKnowledgeBase).mockRejectedValueOnce(new Error('temporary failure'));
    await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload' });
    f.settings.reverseSync.lastReverseFullSyncAt = 123;
    vi.mocked(addNotesToKnowledgeBase).mockRejectedValueOnce(new Error('API 调用频率过高，请稍后再试'));
    const result = await new BidirectionalSyncEngine(f.app, f.settings).sync(undefined, { direction: 'upload' });
    expect(result.failed).toBe(1);
    expect(f.settings.reverseSync.lastReverseFullSyncAt).toBe(123);
  });
});
