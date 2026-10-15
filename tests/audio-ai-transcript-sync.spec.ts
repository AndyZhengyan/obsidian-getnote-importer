import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { SyncEngine, SyncCancelledError } from '../src/sync';
import { DEFAULT_SETTINGS, type GetNoteNote, type Settings } from '../src/types';
import { renderNote } from '../src/note-parser';
import { parseSourceBody } from '../src/source-body';

const note: GetNoteNote = {
  id: '1924098217785612376', note_id: '1924098217785612376',
  title: '面试录音', content: '云端 AI 总结', note_type: 'local_audio', source: 'app', tags: [],
  created_at: '2026-10-14 13:35:06', updated_at: '2026-10-14 13:35:06',
};
const mainPath = 'Sync/录音笔记/面试录音.md';
const aiPath = 'Sync/录音笔记/asset/面试录音_1924098217785612376_transcript_ai.md';
const rawPath = 'Sync/录音笔记/asset/面试录音_1924098217785612376_transcript.md';

function fixture(options: { enabled?: boolean; webToken?: string; existing?: string; ai?: string } = {}) {
  const files = new Map<string, { file: TFile; content: string }>();
  const folders = new Set<string>();
  const add = (path: string, content: string) => {
    const file = new TFile(path);
    files.set(path, { file, content });
    return file;
  };
  if (options.existing) add(mainPath, options.existing);
  if (options.ai) add(aiPath, `---\ndedao_generated_asset: transcript\ndedao_transcript_variant: ai\ndedao_parent_uid: "${note.note_id}"\n---\n${options.ai}`);
  const app = {
    vault: {
      getAllFolders: () => [...folders].map(path => ({ path })),
      getMarkdownFiles: () => [...files.values()].map(entry => entry.file),
      getAbstractFileByPath: (path: string) => files.get(path)?.file ?? (folders.has(path) ? { path } : null),
      createFolder: async (path: string) => { folders.add(path); },
      read: async (file: TFile) => files.get(file.path)!.content,
      create: async (path: string, content: string) => {
        if (files.has(path) || folders.has(path)) throw new Error('already exists');
        return add(path, content);
      },
      process: async (file: TFile, update: (content: string) => string) => {
        const content = update(files.get(file.path)!.content);
        files.get(file.path)!.content = content;
        return content;
      },
    },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
  const settings: Settings = {
    ...DEFAULT_SETTINGS, authMode: 'openapi', openApiToken: 'open-token', openApiClientId: 'client',
    webApiToken: options.webToken ?? 'web-token', folderName: 'Sync', maxDays: 0, syncStartDate: '',
    attachmentImport: {
      image: false, audio: false, audioTranscript: true, video: false, document: false,
      ...{ audioAiTranscript: options.enabled ?? true },
    },
  };
  return { files, settings, app, engine: new SyncEngine(app, settings) };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function remote(options: { available?: boolean; fail?: boolean } = {}) {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (url.includes('/resource/note/list')) return response({ success: true, data: { notes: [note], has_more: false } });
    if (url.includes('/resource/note/detail')) return response({ success: true, data: { note: { ...note, audio: { original: '未经优化的口水稿' } } } });
    if (url.includes('/original')) {
      expect((init?.headers as Record<string, string>).Authorization).toContain('web-token');
      if (options.fail) return new Response(JSON.stringify({ message: 'LoginRequired' }), { status: 403 });
      return url.includes('show_opt_asr=true')
        ? response({ c: { content: '这是 AI 优化稿，不是原文，也不是摘要。', optimized_asr_version: 2 } })
        : response({ c: { has_optimized_asr: options.available !== false, content: '不能冒充优化稿的原文' } });
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  return requests;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('audio AI transcript sync', () => {
  it('saves original and AI transcripts separately with distinct references outside the source body', async () => {
    remote();
    const f = fixture();
    const result = await f.engine.sync();
    expect(result).toMatchObject({ created: 1, failed: 0 });
    expect(f.files.get(rawPath)?.content).toContain('未经优化的口水稿');
    expect(f.files.get(aiPath)?.content).toContain('这是 AI 优化稿，不是原文，也不是摘要。');
    expect(f.files.get(aiPath)?.content).toContain('dedao_generated_asset: transcript');
    const body = f.files.get(mainPath)!.content;
    expect(body).toContain('_transcript.md');
    expect(body).toContain('_transcript_ai.md');
    expect(parseSourceBody(body)).toMatchObject({ kind: 'valid', body: '云端 AI 总结' });
  });

  it('does not request Web content or create an AI asset when the opt-in setting is off', async () => {
    const requests = remote();
    const f = fixture({ enabled: false });
    await f.engine.sync();
    expect(f.files.has(aiPath)).toBe(false);
    expect(requests.some(url => url.includes('/original'))).toBe(false);
  });

  it('downloads AI independently when the raw transcript option is off', async () => {
    remote();
    const f = fixture();
    f.settings.attachmentImport!.audioTranscript = false;
    await f.engine.sync();
    expect(f.files.has(rawPath)).toBe(false);
    expect(f.files.get(aiPath)?.content).toContain('这是 AI 优化稿');
    expect(f.files.get(mainPath)?.content).toContain('_transcript_ai.md');
  });

  it('keeps the optimized reference when the unrelated detail request fails', async () => {
    remote();
    const fetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/resource/note/detail')) return new Response('{}', { status: 500 });
      return fetch(url, init);
    }));
    const f = fixture();
    await f.engine.sync();
    expect(f.files.get(aiPath)?.content).toContain('这是 AI 优化稿');
    expect(f.files.get(mainPath)?.content).toContain('_transcript_ai.md');
  });

  it('does not overwrite or link a colliding user-authored file', async () => {
    remote();
    const f = fixture();
    await f.app.vault.create(aiPath, '用户自己的文件');
    const result = await f.engine.sync();
    expect(f.files.get(aiPath)?.content).toBe('用户自己的文件');
    expect(f.files.get(mainPath)?.content).not.toContain('](' + aiPath);
    expect(f.files.get(mainPath)?.content).toContain('⚠');
    expect(result.items?.[0].error).toBeTruthy();
  });

  it.each(['list', 'selected'] as const)('backfills an existing note during %s sync without replacing user text or duplicating the link', async mode => {
    const requests = remote();
    const existing = renderNote(note) + '\n用户自己的补充内容\n';
    const f = fixture({ existing });
    const sync = () => mode === 'list' ? f.engine.sync() : f.engine.syncNoteIds([note.note_id]);
    await sync();
    expect(f.files.get(aiPath)?.content).toContain('这是 AI 优化稿');
    const updated = f.files.get(mainPath)!.content;
    expect(updated).toContain(existing);
    expect(updated.match(/_transcript_ai\.md/g)).toHaveLength(1);
    const firstRequests = requests.filter(url => url.includes('/original')).length;
    const process = vi.spyOn(f.app.vault, 'process');
    await sync();
    expect(f.files.get(mainPath)!.content).toBe(updated);
    expect(process).not.toHaveBeenCalled();
    expect(requests.filter(url => url.includes('/original'))).toHaveLength(firstRequests);
  });

  it('preserves an existing optimized transcript and restores its missing parent reference without a Web request', async () => {
    const requests = remote();
    const f = fixture({ existing: renderNote(note), ai: '用户整理过的优化稿' });
    await f.engine.sync();
    expect(f.files.get(aiPath)?.content).toContain('用户整理过的优化稿');
    expect(f.files.get(mainPath)?.content).toContain('_transcript_ai.md');
    expect(requests.some(url => url.includes('/original'))).toBe(false);
  });

  it('accepts legal frontmatter whitespace around the existing UID key', async () => {
    remote();
    const f = fixture({ existing: renderNote(note).replace('uid:', 'uid :') });
    const result = await f.engine.sync();
    expect(f.files.get(mainPath)?.content).toContain('_transcript_ai.md');
    expect(result.items?.[0].error).toBeUndefined();
  });

  it('does not add references if the parent is archived while downloading', async () => {
    remote();
    const f = fixture({ existing: renderNote(note) });
    const fetch = globalThis.fetch;
    let archived = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('show_opt_asr=true')) {
        archived = f.files.get(mainPath)!.content.replace('---\n', '---\ndedao_sync_archived: true\n');
        f.files.get(mainPath)!.content = archived;
      }
      return fetch(url, init);
    }));
    const result = await f.engine.sync();
    expect(f.files.get(mainPath)?.content).toBe(archived);
    expect(result.items?.[0].error).toBeTruthy();
  });

  it('backfills an existing audio child reached through its parent while preserving its edits', async () => {
    remote();
    const fetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/resource/note/list')) return response({ data: { notes: [{
        ...note, note_id: 'parent', note_type: 'plain_text', children_count: 1, children_ids: [note.note_id],
      }], has_more: false } });
      return fetch(url, init);
    }));
    const existing = renderNote(note) + '\n我的批注\n';
    const f = fixture({ existing });
    await f.engine.sync();
    expect(f.files.get(aiPath)?.content).toContain('这是 AI 优化稿');
    expect(f.files.get(mainPath)?.content).toContain(existing);
    expect(f.files.get(mainPath)?.content).toContain('_transcript_ai.md');
  });

  it.each(['missing-login', 'no-version', 'expired-login'] as const)('keeps summary and raw transcript but reports %s instead of fabricating an AI asset', async reason => {
    remote({ available: reason !== 'no-version', fail: reason === 'expired-login' });
    const f = fixture({ webToken: reason === 'missing-login' ? '' : 'web-token' });
    const result = await f.engine.sync();
    expect(f.files.get(mainPath)?.content).toContain('云端 AI 总结');
    expect(f.files.get(rawPath)?.content).toContain('未经优化的口水稿');
    expect(f.files.has(aiPath)).toBe(false);
    expect(result.items?.[0].error).toBeTruthy();
    expect(f.files.get(mainPath)?.content).toContain('⚠');
  });

  it('does not turn a cancelled optimized-transcript request into a warning or write a note', async () => {
    remote();
    const f = fixture();
    const fetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/original')) {
        f.engine.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }
      return fetch(url, init);
    }));
    await expect(f.engine.sync()).rejects.toBeInstanceOf(SyncCancelledError);
    expect(f.files.has(mainPath)).toBe(false);
    expect(f.files.has(aiPath)).toBe(false);
  });

  it('does not create an AI asset if cancelled while its folder is being created', async () => {
    remote();
    const f = fixture();
    const createFolder = f.app.vault.createFolder;
    vi.spyOn(f.app.vault, 'createFolder').mockImplementation(async path => {
      const result = await createFolder(path);
      if (path.endsWith('/asset')) f.engine.cancel();
      return result;
    });
    await expect(f.engine.sync()).rejects.toBeInstanceOf(SyncCancelledError);
    expect(f.files.has(aiPath)).toBe(false);
    expect(f.files.has(mainPath)).toBe(false);
  });
});
