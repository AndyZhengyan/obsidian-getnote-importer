import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { SyncEngine } from '../src/sync';
import type { Settings, GetNoteNote } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const DEFAULT_SCHEDULED_SYNC = { ...DEFAULT_SETTINGS.scheduledSync };

type MockApp = App & {
  vault: App['vault'] & {
    _addFile: (path: string, content: string, frontmatter?: Record<string, string>) => void;
    _addFolder: (path: string) => void;
    _addFileAtPath: (path: string, kind: 'file' | 'folder') => void;
    createFolderSync: (path: string) => void;
  };
};

type StoredFile = TFile & { content: string; frontmatter: Record<string, string> };

function makeMockFile(path: string, content = '', frontmatter: Record<string, string> = {}): StoredFile {
  const file = Object.create(TFile.prototype) as StoredFile;
  Object.defineProperty(file, 'path', { value: path, writable: true, enumerable: true });
  Object.defineProperty(file, 'name', { value: path.split('/').pop() ?? '', writable: true, enumerable: true });
  Object.defineProperty(file, 'basename', {
    value: (path.split('/').pop() ?? '').replace(/\.md$/, ''),
    writable: true,
    enumerable: true,
  });
  Object.defineProperty(file, 'extension', { value: 'md', writable: true, enumerable: true });
  Object.defineProperty(file, 'stat', {
    value: { ctime: 0, mtime: 0, size: content.length },
    writable: true,
    enumerable: true,
  });
  Object.defineProperty(file, 'content', { value: content, writable: true, enumerable: true });
  Object.defineProperty(file, 'frontmatter', { value: frontmatter, writable: true, enumerable: true });
  return file;
}

function makeMockFolder(path: string): TFolder {
  const folder = Object.create(TFolder.prototype) as TFolder;
  Object.defineProperty(folder, 'path', { value: path, writable: true, enumerable: true });
  Object.defineProperty(folder, 'name', { value: path.split('/').pop() ?? '', writable: true, enumerable: true });
  Object.defineProperty(folder, 'children', { value: [], writable: true, enumerable: true });
  Object.defineProperty(folder, 'isRoot', { value: () => false, writable: true, enumerable: true });
  return folder;
}

// Minimal mock app for SyncEngine tests
function makeMockApp(): MockApp {
  const files = new Map<string, StoredFile>();
  const folders = new Map<string, TFolder>();

  return {
    vault: {
      getAllFolders: () =>
        [...folders.values()].map((f) => ({ path: f.path })),
      getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
      getMarkdownFiles: () =>
        [...files.values()]
          .filter((f) => f.path.endsWith('.md'))
          .map((f) => ({ path: f.path })),
      read: vi.fn().mockImplementation(async (file: { path: string }) => files.get(file.path)?.content ?? ''),
      createFolder: vi.fn().mockImplementation((path: string) => {
        if (!folders.has(path)) folders.set(path, makeMockFolder(path));
        return Promise.resolve(folders.get(path)!);
      }),
      create: vi.fn().mockImplementation((path: string, data: string) => {
        const file = makeMockFile(path, data, {});
        files.set(path, file);
        return file;
      }),
      createBinary: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
        const file = makeMockFile(path, `[binary:${data.byteLength}]`, {});
        files.set(path, file);
        return file;
      }),
      modify: vi.fn().mockImplementation((file: { path: string }, data: string) => {
        const existing = files.get(file.path);
        if (existing) {
          existing.content = data;
        }
        return Promise.resolve();
      }),
      rename: vi.fn().mockImplementation((file: { path: string }, newPath: string) => {
        const existing = files.get(file.path);
        if (existing) {
          if (folders.has(newPath)) folders.delete(newPath);
          Object.defineProperty(existing, 'path', { value: newPath, writable: true, enumerable: true });
          files.delete(file.path);
          files.set(newPath, existing);
        }
        return Promise.resolve();
      }),
      createFolderSync: (path: string) => {
        if (!folders.has(path)) folders.set(path, makeMockFolder(path));
      },
      _addFile: (path: string, content: string, frontmatter: Record<string, string> = {}) => {
        if (folders.has(path)) folders.delete(path);
        const storedContent = Object.keys(frontmatter).length && !content.startsWith('---')
          ? `---\n${Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${content}`
          : content;
        files.set(path, makeMockFile(path, storedContent, frontmatter));
      },
      _addFileAtPath: (path: string, kind: 'file' | 'folder') => {
        if (kind === 'file') {
          files.set(path, makeMockFile(path));
        } else {
          folders.set(path, makeMockFolder(path));
        }
      },
      _addFolder: (path: string) => {
        if (files.has(path)) files.delete(path);
        folders.set(path, makeMockFolder(path));
      },
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const f = files.get(file.path);
        return f ? { frontmatter: f.frontmatter } : null;
      },
    },
  } as unknown as MockApp;
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    authMode: 'openapi',
    openApiToken: '',
    openApiClientId: '',
    webApiToken: '',
    apiToken: 'test-token',
    clientId: 'test-client',
    webCsrfToken: '',
    folderName: '得到大脑',
    templateFilePath: '',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    filenamePrefix: '',
    datePathEnabled: false,
    datePathFormat: 'YYYY/MM',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
    syncHistory: [],
    ...overrides,
  };
}

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: 1,
    note_id: 'note_001',
    title: '测试笔记',
    content: '正文内容',
    note_type: 'plain_text',
    source: 'app',
    tags: [],
    created_at: '2026-04-27T22:26:17+08:00',
    updated_at: '2026-04-28T10:00:00+08:00',
    ...overrides,
  };
}

// Mock fetch for API responses
function mockFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

describe('SyncEngine progress reporting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not report a numeric percentage while fetching an unknown number of pages', async () => {
    const note = makeNote({
      note_id: 'progress-page',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
      data: { notes: [note], has_more: false, next_cursor: '' },
    }) as Response);
    const progress = vi.fn();
    const engine = new SyncEngine(makeMockApp(), makeSettings({ maxDays: 0 }), progress);

    await engine.sync();

    expect(progress).toHaveBeenCalledWith({ page: 1 });
  });
});

describe('SyncEngine — vault write ownership', () => {
  it.each([
    { label: 'has no uid', frontmatter: {} },
    { label: 'belongs to another uid', frontmatter: { uid: 'another-note' } },
  ])('preserves a colliding Markdown file that $label', async ({ frontmatter }) => {
    const app = makeMockApp();
    const targetPath = '得到大脑/纯文本/冲突标题.md';
    const originalGet = app.vault.getAbstractFileByPath.bind(app.vault);
    const existingFile = new TFile(targetPath);
    app.vault._addFile(targetPath, '用户原始内容', frontmatter);
    const originalContent = (originalGet(targetPath) as StoredFile).content;
    vi.spyOn(app.vault, 'getAbstractFileByPath').mockImplementation((path: string) => (
      path === targetPath ? existingFile : originalGet(path)
    ));

    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested through its real vault boundary
    await engine['writeNote'](
      makeNote({ note_id: 'remote-note', title: '冲突标题', content: '远端内容' }),
      new Map<string, TFile>(),
    );

    expect((originalGet(targetPath) as { content: string }).content).toBe(originalContent);
    expect(app.vault.create).toHaveBeenCalledWith(
      '得到大脑/纯文本/冲突标题-2.md',
      expect.stringContaining('远端内容'),
    );
  });

  it('does not overwrite an unrelated transcript artifact', async () => {
    const app = makeMockApp();
    const targetPath = '得到大脑/录音笔记/asset/录音_collision_audio_transcript.md';
    const originalGet = app.vault.getAbstractFileByPath.bind(app.vault);
    const existingFile = new TFile(targetPath);
    app.vault._addFile(targetPath, '用户自己的附件笔记');
    vi.spyOn(app.vault, 'getAbstractFileByPath').mockImplementation((path: string) => (
      path === targetPath ? existingFile : originalGet(path)
    ));

    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested through its real vault boundary
    await engine['writeAudioTranscriptAsset'](makeNote({
      note_id: 'collision_audio',
      title: '录音',
      note_type: 'recorder_audio',
      audio: '远端转写',
    }));

    expect((originalGet(targetPath) as { content: string }).content).toBe('用户自己的附件笔记');
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('does not overwrite an unrelated link-original artifact', async () => {
    const app = makeMockApp();
    const targetPath = '得到大脑/链接笔记/asset/链接_collision_link_original.md';
    const originalGet = app.vault.getAbstractFileByPath.bind(app.vault);
    const existingFile = new TFile(targetPath);
    app.vault._addFile(targetPath, '用户自己的链接笔记');
    vi.spyOn(app.vault, 'getAbstractFileByPath').mockImplementation((path: string) => (
      path === targetPath ? existingFile : originalGet(path)
    ));

    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested through its real vault boundary
    await engine['writeLinkOriginalAsset'](makeNote({
      note_id: 'collision_link',
      title: '链接',
      note_type: 'link',
      linkOriginal: { content: '远端原文' },
    }));

    expect((originalGet(targetPath) as { content: string }).content).toBe('用户自己的链接笔记');
    expect(app.vault.modify).not.toHaveBeenCalled();
  });
});

describe('SyncEngine — existing UID precheck before enrichment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      label: 'image',
      noteType: 'img_text',
      detail: { attachments: [{ type: 'image', url: 'https://mediacdn.umiwi.com/image.png', title: '图片' }] },
    },
    {
      label: 'audio',
      noteType: 'recorder_audio',
      detail: {
        audio: '转写',
        attachments: [{ type: 'audio', url: 'https://mediacdn.umiwi.com/audio.mp3', title: '录音' }],
      },
    },
    {
      label: 'link original',
      noteType: 'link',
      detail: {
        linkOriginal: { title: '原文', url: 'https://example.com/source', content: '原文内容' },
      },
    },
    {
      label: 'generic attachment',
      noteType: 'plain_text',
      detail: { attachments: [{ type: 'document', url: 'https://mediacdn.umiwi.com/file.pdf', title: '附件' }] },
    },
  ])('does not create orphan date-path assets for an existing $label note', async ({ noteType, detail }) => {
    const note = makeNote({
      note_id: `existing_${noteType}`,
      title: '历史笔记',
      note_type: noteType,
      ...detail,
    });
    const app = makeMockApp();
    app.vault._addFolder('得到大脑/纯文本');
    app.vault._addFile(
      '得到大脑/纯文本/历史笔记.md',
      '本地内容',
      { uid: note.note_id, modified: '2026-04-28 10:00:00' },
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlString = typeof url === 'string' ? url : (url as Request).url;
      if (urlString.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [note], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlString.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({ data: { note } }) as Response);
      }
      if (urlString.includes('/resource/note/original')) {
        return Promise.resolve(mockFetchResponse({ data: note.linkOriginal }) as Response);
      }
      return Promise.resolve(mockFetchResponse({}) as Response);
    });
    const engine = new SyncEngine(app, makeSettings({
      maxDays: 0,
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }));

    const result = await engine.sync();

    expect(result).toEqual(expect.objectContaining({ created: 0, updated: 0, skipped: 1 }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
    expect(app.vault.getAbstractFileByPath('得到大脑/纯文本/历史笔记.md')).toBeTruthy();
  });

  it('does not enrich an existing append child before skipping it', async () => {
    const parent = makeNote({
      note_id: 'existing_parent',
      title: '历史父笔记',
      children_count: 1,
      children_ids: ['existing_child'],
    });
    const child = makeNote({
      note_id: 'existing_child',
      title: '历史子笔记',
      note_type: 'img_text',
      parent_id: parent.note_id,
      is_child_note: true,
      attachments: [{ type: 'image', url: 'https://mediacdn.umiwi.com/child.png', title: '图片' }],
    });
    const app = makeMockApp();
    app.vault._addFile('得到大脑/纯文本/父.md', '父', { uid: parent.note_id });
    app.vault._addFile('得到大脑/图片笔记/子.md', '子', { uid: child.note_id });
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const value = String(url);
      if (value.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({ data: { notes: [parent], has_more: false } }) as Response);
      }
      if (value.includes(`id=${child.note_id}`)) {
        return Promise.resolve(mockFetchResponse({ data: { note: child } }) as Response);
      }
      return Promise.resolve(mockFetchResponse({}) as Response);
    });

    const result = await new SyncEngine(app, makeSettings({
      maxDays: 0,
      datePathEnabled: true,
    })).sync();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 2 }));
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('fetches only relationship detail for an existing parent and creates a missing child', async () => {
    const parent = makeNote({
      note_id: 'relation_parent',
      title: '关系父笔记',
      note_type: 'recorder_audio',
      children_count: 1,
      children_ids: undefined,
    });
    const child = makeNote({
      note_id: 'missing_child',
      title: '缺失子笔记',
      parent_id: parent.note_id,
      is_child_note: true,
    });
    const app = makeMockApp();
    app.vault._addFile('得到大脑/录音笔记/父.md', '本地父内容', { uid: parent.note_id });
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const value = String(url);
      if (value.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({ data: { notes: [parent], has_more: false } }) as Response);
      }
      if (value.includes(`id=${parent.note_id}`)) {
        return Promise.resolve(mockFetchResponse({
          data: {
            note: {
              ...parent,
              children_ids: [child.note_id],
              attachments: [{ type: 'audio', url: 'https://mediacdn.umiwi.com/parent.mp3', title: '父录音' }],
              audio: '父转写',
            },
          },
        }) as Response);
      }
      if (value.includes(`id=${child.note_id}`)) {
        return Promise.resolve(mockFetchResponse({ data: { note: child } }) as Response);
      }
      return Promise.resolve(mockFetchResponse({}) as Response);
    });

    const result = await new SyncEngine(app, makeSettings({
      maxDays: 0,
      datePathEnabled: true,
    })).sync();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 1 }));
    expect(app.vault.create).toHaveBeenCalledWith(
      '得到大脑/2026/04/纯文本/关系父笔记__缺失子笔记.md',
      expect.any(String),
    );
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
  });
});

describe('SyncEngine — TFile narrowing for vault writes (#220)', () => {
  const linkNote = makeNote({
    note_id: 'link_220',
    title: '链接标题',
    content: 'AI 摘要正文',
    note_type: 'link',
    created_at: '2026-05-09T10:00:00+08:00',
    updated_at: '2026-05-09T10:05:00+08:00',
  });

  function mockLinkOriginalFetch(linkNoteForFetch: GetNoteNote) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [linkNoteForFetch], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...linkNoteForFetch,
              web_page: {
                title: '原网页标题',
                url: 'https://example.com/source',
                content: '链接原文全文',
              },
            },
          },
        }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the note failed without writing when the link-original path is a folder', async () => {
    mockLinkOriginalFetch(linkNote);

    const app = makeMockApp();
    app.vault._addFolder('得到大脑/链接笔记/asset');
    app.vault._addFileAtPath('得到大脑/链接笔记/asset/链接标题_link_220_original.md', 'folder');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.created).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.items).toContainEqual(expect.objectContaining({
        noteId: 'link_220',
        status: 'failed',
        error: expect.stringContaining('folder'),
      }));
      const modifyCalls = vi.mocked(app.vault.modify).mock.calls
        .map(call => String((call[0] as { path: string }).path));
      expect(modifyCalls.some(p => p === '得到大脑/链接笔记/asset/链接标题_link_220_original.md')).toBe(false);
      const createCalls = vi.mocked(app.vault.create).mock.calls
        .map(call => String(call[0]));
      expect(createCalls.some(p => p === '得到大脑/链接笔记/asset/链接标题_link_220_original.md')).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('folder'));
    } finally {
      warn.mockRestore();
    }
  });

  it('writeLinkOriginalAsset preserves an existing TFile asset', async () => {
    mockLinkOriginalFetch(linkNote);

    const app = makeMockApp();
    app.vault._addFolder('得到大脑/链接笔记/asset');
    app.vault._addFile(
      '得到大脑/链接笔记/asset/链接标题_link_220_original.md',
      '# 原网页标题\n\n来源链接：https://example.com/source\n\n旧原文'
    );

    try {
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
      await engine.sync();

      expect(app.vault.modify).not.toHaveBeenCalled();
      expect(app.vault.create).not.toHaveBeenCalledWith(
        '得到大脑/链接笔记/asset/链接标题_link_220_original.md',
        expect.any(String),
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('marks the note failed without reading or falling back when the template path is a folder', async () => {
    mockLinkOriginalFetch(linkNote);

    const app = makeMockApp();
    app.vault._addFileAtPath('templates/note-template.md', 'folder');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const engine = new SyncEngine(app, makeSettings({
        maxDays: 0,
        templateFilePath: 'templates/note-template.md',
      }));
      const result = await engine.sync();

      expect(result.created).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.items).toContainEqual(expect.objectContaining({
        noteId: 'link_220',
        status: 'failed',
        error: expect.stringContaining('folder'),
      }));
      const readCalls = vi.mocked(app.vault.read).mock.calls
        .map(call => String((call[0] as { path: string }).path));
      expect(readCalls).not.toContain('templates/note-template.md');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('folder'));
    } finally {
      warn.mockRestore();
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});

describe('SyncEngine — filterRecentNotes', () => {
  it('disables maxDays when syncStartDate is set', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 30, syncStartDate: '2026-05-09' }));

    expect(engine['scopeOptions']).toEqual({
      maxDays: 0,
      syncStartDate: '2026-05-09',
    });
  });

  it('keeps only enabled note types when a type filter is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'plain', title: '纯文本', note_type: 'plain_text' }),
            makeNote({ note_id: 'link', title: '链接', note_type: 'link' }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }), undefined, { enabledNoteTypes: ['link'] });

      const result = await engine.sync();

      expect(result.total).toBe(1);
      expect(result.created).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'link',
          noteType: 'link',
          status: 'created',
        }),
      ]);
      expect(app.vault.create).toHaveBeenCalledTimes(1);
      expect(app.vault.create).toHaveBeenCalledWith(expect.stringContaining('/链接笔记/'), expect.any(String));
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('返回所有笔记当 maxDays <= 0', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
    const notes = [makeNote({ note_id: '1' }), makeNote({ note_id: '2' })];
    // @ts-expect-error accessing private via any
    expect(engine['filterRecentNotes'](notes)).toHaveLength(2);
  });

  it('过滤掉超过 maxDays 的笔记', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 7 }));
    const now = new Date();
    const oldNote = makeNote({
      note_id: 'old',
      updated_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recentNote = makeNote({
      note_id: 'recent',
      updated_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    // @ts-expect-error private helper is tested directly
    const result = engine['filterRecentNotes']([oldNote, recentNote]);
    expect(result).toHaveLength(1);
    expect(result[0].note_id).toBe('recent');
  });

  it('边界：刚好 maxDays 当天的笔记保留', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 5 }));
    const now = new Date();
    const at5days = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 1000).toISOString();
    const note = makeNote({ note_id: 'boundary', updated_at: at5days });
    // @ts-expect-error private helper is tested directly
    expect(engine['filterRecentNotes']([note])).toHaveLength(1);
  });
});

describe('SyncEngine — template file rendering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies a vault template to newly created notes and merges template tags', async () => {
    const note = makeNote({
      note_id: 'templated',
      title: '模板笔记',
      content: '远端正文',
      tags: [{ name: '远端' }],
    });
    const app = makeMockApp();
    app.vault._addFile(
      'Templates/dedao.md',
      [
        '---',
        'project: "{{title}}"',
        'uid: "template-uid-should-not-win"',
        'tags: ["模板", "远端"]',
        '---',
        '# {{title}}',
        '',
        '模板头',
        '',
        '{{content}}',
        '',
        '模板尾',
      ].join('\n')
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ data: { note } }) as Response
    );

    try {
      const engine = new SyncEngine(app, makeSettings({
        maxDays: 0,
        templateFilePath: 'Templates/dedao.md',
      }));

      await engine.syncNoteIds(['templated']);

      const created = vi.mocked(app.vault.create).mock.calls[0]?.[1] as string;
      expect(created).toContain('project: "模板笔记"');
      expect(created).toContain('uid: "templated"');
      expect(created).not.toContain('template-uid-should-not-win');
      expect(created).toContain('tags: ["远端", "模板"]');
      expect(created).toContain('# 模板笔记');
      expect(created).toContain(
        '模板头\n\n<!-- dedao-brain-sync:source-body:start -->\n远端正文\n<!-- dedao-brain-sync:source-body:end -->\n\n模板尾'
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('appends note content when the template omits the content placeholder', async () => {
    const note = makeNote({
      note_id: 'append_content',
      title: '追加正文',
      content: '得到正文',
    });
    const app = makeMockApp();
    app.vault._addFile('Templates/no-content.md', '固定模板块');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ data: { note } }) as Response
    );

    try {
      const engine = new SyncEngine(app, makeSettings({
        maxDays: 0,
        templateFilePath: 'Templates/no-content.md',
      }));

      await engine.syncNoteIds(['append_content']);

      const created = vi.mocked(app.vault.create).mock.calls[0]?.[1] as string;
      expect(created).toContain(
        '固定模板块\n\n<!-- dedao-brain-sync:source-body:start -->\n得到正文\n<!-- dedao-brain-sync:source-body:end -->'
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('does not reapply the template when an existing synced note is skipped', async () => {
    const note = makeNote({
      note_id: 'existing_template',
      title: '已有笔记',
      content: '新的远端正文',
      updated_at: '2026-04-29T10:00:00+08:00',
    });
    const app = makeMockApp();
    app.vault._addFile(
      '得到大脑/纯文本/已有笔记.md',
      '---\nuid: "existing_template"\nmodified: 2026-04-28 10:00:00\n---\n用户改过的旧内容',
      { uid: 'existing_template', modified: '2026-04-28 10:00:00' }
    );
    app.vault._addFile('Templates/dedao.md', '模板标记\n\n{{content}}');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ data: { notes: [note], has_more: false, next_cursor: '' } }) as Response
    );

    try {
      const engine = new SyncEngine(app, makeSettings({
        maxDays: 0,
        templateFilePath: 'Templates/dedao.md',
      }));

      const result = await engine.syncNoteIds(['existing_template']);

      expect(result.skipped).toBe(1);
      expect(app.vault.modify).not.toHaveBeenCalled();
      expect(app.vault.create).not.toHaveBeenCalled();
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});

describe('SyncEngine — page cutoff', () => {
  it('treats date-only syncStartDate as the local start of day', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(
      app,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: '2026-05-09', maxDays: 0 }
    );
    const localMidnight = new Date(2026, 4, 9, 0, 30, 0);
    const justAfterLocalMidnight = makeNote({
      note_id: 'local_midnight',
      updated_at: localMidnight.toISOString(),
    });

    // @ts-expect-error accessing private method for boundary regression coverage
    expect(engine['filterNotesByDateRange']([justAfterLocalMidnight])).toHaveLength(1);
  });

  it('uses chronological time instead of string order for last synced timestamp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'lexically_later',
              updated_at: '2026-05-09T09:30:00+08:00',
            }),
            makeNote({
              note_id: 'chronologically_later',
              updated_at: '2026-05-09T02:00:00Z',
            }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

      const result = await engine.sync();

      expect(result.lastNoteTimestamp).toBe('2026-05-09T02:00:00Z');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('processes recent notes on a page before stopping at an old tail note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00+08:00'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'today',
              title: '今天最新',
              updated_at: '2026-05-11T11:30:00+08:00',
            }),
            makeNote({
              note_id: 'old_tail',
              title: '旧尾巴',
              updated_at: '2026-05-09T11:30:00+08:00',
            }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 1 }));

      const result = await engine.sync();

      expect(result.created).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'today',
          status: 'created',
        }),
      ]);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops OpenAPI pagination when maxDays reaches a stale created_at tail page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00+08:00'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('since_id=old_tail')) {
        return mockFetchResponse({
          data: {
            notes: [
              makeNote({
                note_id: 'should_not_fetch_page_2',
                title: '不应该翻到第二页',
                created_at: '2026-05-11T10:00:00+08:00',
                updated_at: '2026-05-11T10:00:00+08:00',
              }),
            ],
            has_more: false,
            next_cursor: '',
          },
        }) as Response;
      }

      return mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'fresh',
              title: '一天内',
              created_at: '2026-05-11T11:30:00+08:00',
              updated_at: '2026-05-11T11:30:00+08:00',
            }),
            makeNote({
              note_id: 'old_created_recently_updated',
              title: '旧创建但刚更新',
              created_at: '2026-05-09T12:00:00+08:00',
              updated_at: '2026-05-11T11:00:00+08:00',
            }),
            makeNote({
              note_id: 'old_tail',
              title: '超过一天',
              created_at: '2026-05-09T11:30:00+08:00',
              updated_at: '2026-05-09T11:30:00+08:00',
            }),
          ],
          has_more: true,
          next_cursor: 'old_tail',
        },
      }) as Response;
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
        maxDays: 1,
      }));

      const result = await engine.sync();

      expect(result.items?.map(item => item.noteId)).toEqual(['fresh', 'old_created_recently_updated']);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(globalThis.fetch).mock.calls[0][0])).toBe(
        'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0'
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops Web API pagination when maxDays reaches a stale created_at tail page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00+08:00'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('since_id=old_tail')) {
        return mockFetchResponse({
          h: {},
          c: {
            list: [
              makeNote({
                note_id: 'should_not_fetch_page_2',
                title: '不应该翻到第二页',
                created_at: '2026-05-11T10:00:00+08:00',
                updated_at: '2026-05-11T10:00:00+08:00',
              }),
            ],
            has_more: false,
          },
        }) as Response;
      }

      return mockFetchResponse({
        h: {},
        c: {
          list: [
            makeNote({
              note_id: 'fresh',
              title: '一天内',
              created_at: '2026-05-11T11:30:00+08:00',
              updated_at: '2026-05-11T11:30:00+08:00',
            }),
            makeNote({
              note_id: 'old_created_recently_updated',
              title: '旧创建但刚更新',
              created_at: '2026-05-09T12:00:00+08:00',
              updated_at: '2026-05-11T11:00:00+08:00',
            }),
            makeNote({
              note_id: 'old_tail',
              title: '超过一天',
              created_at: '2026-05-09T11:30:00+08:00',
              updated_at: '2026-05-09T11:30:00+08:00',
            }),
          ],
          has_more: true,
        },
      }) as Response;
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'web',
        webApiToken: 'web-token',
        maxDays: 1,
      }));

      const result = await engine.sync();

      expect(result.items?.map(item => item.noteId)).toEqual(['fresh', 'old_created_recently_updated']);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(globalThis.fetch).mock.calls[0][0])).toContain('sort=create_desc');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('SyncEngine — filterNotesByDateRange', () => {
  it('keeps notes with updated_at > syncStartDate (boundary is exclusive)', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(
      app,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: '2026-05-09T10:00:00+08:00', maxDays: 0 }
    );

    const boundaryNote = makeNote({
      note_id: 'boundary',
      updated_at: '2026-05-09T10:00:00+08:00', // == startDate → excluded
    });
    const afterBoundary = makeNote({
      note_id: 'after',
      updated_at: '2026-05-10T10:00:00+08:00', // > startDate → kept
    });
    const beforeBoundary = makeNote({
      note_id: 'before',
      updated_at: '2026-05-08T10:00:00+08:00', // < startDate → excluded
    });

    // @ts-expect-error private helper is tested directly
    const result = engine['filterNotesByDateRange']([boundaryNote, afterBoundary, beforeBoundary]);

    expect(result).toHaveLength(1);
    expect(result[0].note_id).toBe('after');
  });

  it('keeps all notes when syncStartDate is empty', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

    const notes = [
      makeNote({ note_id: 'n1', updated_at: '2026-04-01T10:00:00+08:00' }),
      makeNote({ note_id: 'n2', updated_at: '2026-04-02T10:00:00+08:00' }),
    ];
    // @ts-expect-error private helper is tested directly
    expect(engine['filterNotesByDateRange'](notes)).toHaveLength(2);
  });

  it('returns all notes when syncStartDate is an unparsable value', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(
      app,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: 'not-a-date', maxDays: 0 }
    );

    const notes = [makeNote({ note_id: 'n1' })];
    // @ts-expect-error private helper is tested directly
    expect(engine['filterNotesByDateRange'](notes)).toHaveLength(1);
  });
});

describe('SyncEngine — subscribed knowledge selected notes', () => {
  it('skips an existing legacy-path UID before writing dated attachments', async () => {
    const noteId = 'existing_knowledge_image';
    const note = makeNote({
      note_id: noteId,
      title: '历史知识库图片',
      note_type: 'img_text',
      attachments: [{ type: 'image', url: 'https://mediacdn.umiwi.com/existing.png', title: 'existing.png' }],
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'created_topic', name: '我的知识库' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({ data: { topics: [], has_more: false } }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/notes')) {
        return mockFetchResponse({ data: { notes: [note], has_more: false } }) as Response;
      }
      if (requestUrl.includes('/resource/note/detail')) {
        return mockFetchResponse({ data: { note } }) as Response;
      }
      if (requestUrl.startsWith('https://mediacdn.umiwi.com/')) {
        return { status: 200, arrayBuffer: async () => new ArrayBuffer(32) } as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });
    const app = makeMockApp();
    const existingPath = '得到大脑/知识库/我的知识库/历史知识库图片.md';
    app.vault._addFile(existingPath, 'local', { uid: noteId });
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }));

    const result = await engine.syncSubscribedKnowledge(undefined, {
      selectedNoteIds: [noteId],
      createdTopicIds: ['created_topic'],
      knowledgeBaseNames: { [noteId]: '我的知识库' },
    });

    expect(result).toEqual(expect.objectContaining({ total: 1, created: 0, skipped: 1, failed: 0 }));
    const requestedUrls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(requestedUrls.some(url => url.includes('/resource/note/detail'))).toBe(false);
    expect(requestedUrls.some(url => url.startsWith('https://mediacdn.umiwi.com/'))).toBe(false);
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
    expect(app.vault.getAbstractFileByPath(existingPath)).toBeTruthy();
  });

  it.each([
    {
      noteId: 'created_image_note',
      title: '知识库图片笔记',
      noteType: 'img_text',
      attachment: { type: 'image', url: 'https://mediacdn.umiwi.com/knowledge.png', title: 'knowledge.png' },
      detailExtra: {},
      expectedAssets: ['得到大脑/知识库/我的知识库/asset/知识库图片笔记_image.png'],
      expectedMarkdown: 'asset/知识库图片笔记_image.png',
    },
    {
      noteId: 'created_audio_note',
      title: '知识库音频笔记',
      noteType: 'recorder_audio',
      attachment: { type: 'audio', url: 'https://mediacdn.umiwi.com/knowledge.mp3', title: '' },
      detailExtra: { audio: '知识库音频转写' },
      expectedAssets: [
        '得到大脑/知识库/我的知识库/asset/知识库音频笔记_created_audio_note_audio.mp3',
        '得到大脑/知识库/我的知识库/asset/知识库音频笔记_created_audio_note_transcript.md',
      ],
      expectedMarkdown: '知识库音频笔记_created_audio_note_audio.mp3',
    },
  ])('reuses ordinary note enrichment for $noteType notes in a created knowledge base', async ({
    noteId,
    title,
    noteType,
    attachment,
    detailExtra,
    expectedAssets,
    expectedMarkdown,
  }) => {
    const createdFiles: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'created_topic', name: '我的知识库' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({ data: { topics: [], has_more: false } }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/notes')) {
        return mockFetchResponse({
          data: {
            notes: [{
              note_id: noteId,
              title,
              content: '知识库正文',
              note_type: noteType,
              created_at: '2026-06-01T10:00:00+08:00',
              updated_at: '2026-06-01T10:00:00+08:00',
            }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/note/detail')) {
        return mockFetchResponse({
          data: {
            note: {
              note_id: noteId,
              title,
              content: '知识库正文',
              note_type: noteType,
              attachments: [attachment],
              created_at: '2026-06-01T10:00:00+08:00',
              updated_at: '2026-06-01T10:00:00+08:00',
              ...detailExtra,
            },
          },
        }) as Response;
      }
      if (requestUrl.startsWith('https://mediacdn.umiwi.com/')) {
        return {
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(32),
        } as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    const app = makeMockApp();
    app.vault.create = vi.fn().mockImplementation(async (path: string, data: string) => {
      createdFiles.push(path, data);
      return { path };
    });
    app.vault.createBinary = vi.fn().mockImplementation(async (path: string) => {
      createdFiles.push(path);
      return { path };
    });

    try {
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
      }));
      const result = await engine.syncSubscribedKnowledge(undefined, {
        selectedNoteIds: [noteId],
        createdTopicIds: ['created_topic'],
        knowledgeBaseNames: { [noteId]: '我的知识库' },
      });

      expect(result.created).toBe(1);
      for (const asset of expectedAssets) expect(createdFiles).toContain(asset);
      expect(createdFiles.find(item => item.includes('知识库正文'))).toContain(expectedMarkdown);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('does not sync the whole knowledge base when the explicit selection is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
    }));

    const result = await engine.syncSubscribedKnowledge(undefined, {
      selectedNoteIds: [],
      topicIds: ['topic_1'],
    });

    expect(result.total).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('syncs all contents in one knowledge base without applying manual time filters', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'topic_1', name: '长期专题' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/list')) {
        return mockFetchResponse({ data: { topics: [], has_more: false } }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/bloggers')) {
        return mockFetchResponse({
          data: { bloggers: [{ follow_id: 'blogger_1', name: '主理人' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/contents')) {
        return mockFetchResponse({
          data: {
            contents: [{
              post_id_alias: 'old_post',
              title: '旧文章',
              summary: '全部同步仍包含旧内容',
              created_at: '2025-01-01T10:00:00+08:00',
              updated_at: '2025-01-01T10:00:00+08:00',
            }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/content/detail')) {
        return mockFetchResponse({
          data: {
            post_id: 'old_post',
            title: '旧文章',
            content: '全部同步仍包含旧内容',
            created_at: '2025-01-01T10:00:00+08:00',
            updated_at: '2025-01-01T10:00:00+08:00',
          },
        }) as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 1 }));
      const result = await engine.syncSubscribedKnowledge(undefined, {
        syncAll: true,
        topicIds: ['topic_1'],
        knowledgeBaseName: '长期专题',
      });

      expect(result.created).toBe(1);
      expect(app.vault.create).toHaveBeenCalledWith(
        expect.stringMatching(/^得到大脑\/知识库\/长期专题\//),
        expect.any(String)
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('syncs exactly the selected subscribed-knowledge note regardless of manual sync filters', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00+08:00'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({
          data: {
            topics: [{ topic_id: 'topic_1', name: '长期专题' }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/bloggers')) {
        return mockFetchResponse({
          data: {
            bloggers: [{ follow_id: 'blogger_1', name: '主理人' }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/contents')) {
        const url = new URL(requestUrl);
        if (url.searchParams.get('page') === '2') {
          return mockFetchResponse({
            data: {
              contents: [
                {
                  post_id_alias: 'should_not_fetch',
                  title: '不应该继续翻页',
                  summary: '已经找到勾选文章后不应继续请求',
                  created_at: '2026-06-01T10:00:00+08:00',
                  updated_at: '2026-06-01T10:00:00+08:00',
                },
              ],
              has_more: false,
            },
          }) as Response;
        }
        return mockFetchResponse({
          data: {
            contents: [
              {
                post_id_alias: 'old_post',
                title: '旧文章',
                summary: '用户手动勾选的旧内容',
                created_at: '2026-01-01T10:00:00+08:00',
                updated_at: '2026-01-01T10:00:00+08:00',
              },
            ],
            has_more: true,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/content/detail')) {
        return mockFetchResponse({
          data: {
            post_id: 'detail_numeric_id',
            title: '旧文章',
            content: '用户手动勾选的旧内容详情',
            created_at: '2026-01-01T10:00:00+08:00',
            updated_at: '2026-01-01T10:00:00+08:00',
          },
        }) as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
        maxDays: 30,
      }), undefined, {
        maxDays: 30,
        syncStartDate: '2026-05-01',
        enabledNoteTypes: ['plain_text'],
      });

      const result = await engine.syncSubscribedKnowledge(undefined, {
        selectedNoteIds: ['blogger_old_post'],
        topicIds: [],
        bloggerIds: [],
        knowledgeBaseNames: {
          blogger_old_post: '长期专题',
        },
      });

      expect(result.total).toBe(1);
      expect(result.created).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'blogger_old_post',
          status: 'created',
        }),
      ]);
      expect(app.vault.create).toHaveBeenCalledTimes(1);
      expect(app.vault.create).toHaveBeenCalledWith(
        expect.stringMatching(/^得到大脑\/知识库\/长期专题\//),
        expect.any(String)
      );
      expect(vi.mocked(globalThis.fetch).mock.calls.map(call => String(call[0]))).not.toContain(
        'https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/contents?topic_id=topic_1&follow_id=blogger_1&page=2'
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });

  it('records an OpenAPI blogger detail failure and continues with the next article', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'topic_1', name: '长期专题' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/bloggers')) {
        return mockFetchResponse({
          data: { bloggers: [{ follow_id: 'blogger_1', name: '主理人' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/contents')) {
        return mockFetchResponse({
          data: {
            contents: [
              {
                post_id_alias: 'failed_post',
                title: '详情失败文章',
                summary: '不可静默写入的预览摘要',
                created_at: '2026-01-01T10:00:00+08:00',
                updated_at: '2026-01-01T10:00:00+08:00',
              },
              {
                post_id_alias: 'successful_post',
                title: '后续文章',
                summary: '后续文章摘要',
                created_at: '2026-01-02T10:00:00+08:00',
                updated_at: '2026-01-02T10:00:00+08:00',
              },
            ],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/content/detail')) {
        if (requestUrl.includes('post_id=failed_post')) {
          return new Promise<Response>(() => {});
        }
        return mockFetchResponse({
          data: {
            post_id: 'successful_post',
            title: '后续文章',
            content: '后续文章详情',
            created_at: '2026-01-02T10:00:00+08:00',
            updated_at: '2026-01-02T10:00:00+08:00',
          },
        }) as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const progressSpy = vi.fn();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
      }), progressSpy);

      const resultPromise = engine.syncSubscribedKnowledge(undefined, {
        syncAll: true,
        topicIds: ['topic_1'],
        knowledgeBaseName: '长期专题',
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.total).toBe(2);
      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'blogger_failed_post',
          status: 'failed',
          error: expect.any(String),
        }),
        expect.objectContaining({
          noteId: 'blogger_successful_post',
          status: 'created',
        }),
      ]);
      expect(result.checkpointBlocked).toBe(true);
      expect(progressSpy).toHaveBeenCalledWith(expect.objectContaining({
        processed: 1,
        total: 2,
        failed: 1,
      }));
      expect(app.vault.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('后续文章详情')
      );
      expect(app.vault.create).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('不可静默写入的预览摘要')
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });

  it('propagates OpenAPI quota exhaustion from a blogger detail request', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'topic_1', name: '长期专题' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/bloggers')) {
        return mockFetchResponse({
          data: { bloggers: [{ follow_id: 'blogger_1', name: '主理人' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/contents')) {
        return mockFetchResponse({
          data: {
            contents: [{
              post_id_alias: 'quota_exhausted',
              title: '配额耗尽文章',
              summary: '不可降级写入的预览摘要',
              created_at: '2026-01-01T10:00:00+08:00',
              updated_at: '2026-01-01T10:00:00+08:00',
            }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/content/detail')) {
        return {
          status: 429,
          text: async () => JSON.stringify({
            error: { reason: 'quota_day', message: 'quota exhausted' },
          }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
      }));

      const outcomePromise = engine.syncSubscribedKnowledge(undefined, {
        syncAll: true,
        topicIds: ['topic_1'],
        knowledgeBaseName: '长期专题',
      }).then(
        value => ({ value }),
        error => ({ error }),
      );
      await vi.runAllTimersAsync();
      const outcome = await outcomePromise;

      expect(outcome).toEqual({ error: expect.any(Error) });
      expect(app.vault.create).not.toHaveBeenCalled();
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: 'authentication',
      detailResponse: () => ({
        status: 401,
        text: async () => '',
      } as Response),
    },
    {
      name: 'membership',
      detailResponse: () => ({
        status: 403,
        text: async () => JSON.stringify({
          success: false,
          error: { code: 10201, message: 'membership required' },
        }),
      } as Response),
    },
  ])('propagates OpenAPI $name failure from a blogger detail request', async ({ detailResponse }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'topic_1', name: '长期专题' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/bloggers')) {
        return mockFetchResponse({
          data: { bloggers: [{ follow_id: 'blogger_1', name: '主理人' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/contents')) {
        return mockFetchResponse({
          data: {
            contents: [{
              post_id_alias: 'fatal_detail_failure',
              title: '全局错误文章',
              summary: '不可降级写入的预览摘要',
              created_at: '2026-01-01T10:00:00+08:00',
              updated_at: '2026-01-01T10:00:00+08:00',
            }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/content/detail')) {
        return detailResponse();
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
      }));

      const outcome = await engine.syncSubscribedKnowledge(undefined, {
        syncAll: true,
        topicIds: ['topic_1'],
        knowledgeBaseName: '长期专题',
      }).then(
        value => ({ value }),
        error => ({ error }),
      );

      expect(outcome).toEqual({ error: expect.any(Error) });
      expect(app.vault.create).not.toHaveBeenCalled();
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('records an OpenAPI blogger detail payload that cannot be normalized as fetch_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/resource/knowledge/subscribe/list')) {
        return mockFetchResponse({
          data: { topics: [{ topic_id: 'topic_1', name: '长期专题' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/bloggers')) {
        return mockFetchResponse({
          data: { bloggers: [{ follow_id: 'blogger_1', name: '主理人' }], has_more: false },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/contents')) {
        return mockFetchResponse({
          data: {
            contents: [{
              post_id_alias: 'malformed_detail',
              title: '详情格式异常文章',
              summary: '不可写入的预览摘要',
              created_at: '2026-01-01T10:00:00+08:00',
              updated_at: '2026-01-01T10:00:00+08:00',
            }],
            has_more: false,
          },
        }) as Response;
      }
      if (requestUrl.includes('/resource/knowledge/blogger/content/detail')) {
        return mockFetchResponse({ data: {} }) as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'openapi',
        openApiToken: 'openapi-token',
        openApiClientId: 'openapi-client',
      }));

      const result = await engine.syncSubscribedKnowledge(undefined, {
        syncAll: true,
        topicIds: ['topic_1'],
        knowledgeBaseName: '长期专题',
      });

      expect(result.created).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.checkpointBlocked).toBe(true);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'blogger_malformed_detail',
          status: 'failed',
          error: expect.any(String),
        }),
      ]);
      expect(app.vault.create).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('不可写入的预览摘要')
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('syncs exactly the selected Web API knowledge-base note and skips unrelated topics', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00+08:00'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('/subscribe/topic/list')) {
        return mockFetchResponse({
          c: {
            list: [
              { id_alias: 'other_topic', name: '其他知识库', root_dir: { id: 'other_dir' } },
              { id_alias: 'selected_topic', name: '选中的知识库', root_dir: { id: 'selected_dir' } },
            ],
          },
        }) as Response;
      }
      if (requestUrl.includes('/topic/resource/list/mix')) {
        const request = new URL(requestUrl);
        if (request.searchParams.get('topic_id_alias') !== 'selected_topic') {
          throw new Error(`Unexpected topic request: ${requestUrl}`);
        }
        if (request.searchParams.get('page') === '2') {
          throw new Error(`Unexpected second page request: ${requestUrl}`);
        }
        return mockFetchResponse({
          c: {
            resources: [
              {
                resource_type: 'BLOGGER_POST',
                resource_note_meta_data: {
                  note_id: 'blogger_old_web_post',
                  title: 'Web API 旧文章',
                  content: '用户明确选择的旧文章',
                  note_type: 'blogger_post',
                  source: 'blogger',
                  created_at: '2026-01-01T10:00:00+08:00',
                  edit_time: '2026-01-01T10:00:00+08:00',
                },
              },
              {
                resource_type: 'BLOGGER_POST',
                resource_note_meta_data: {
                  note_id: 'blogger_unselected_post',
                  title: '未选择文章',
                  content: '不应写入',
                  note_type: 'blogger_post',
                  source: 'blogger',
                  created_at: '2026-06-01T10:00:00+08:00',
                  edit_time: '2026-06-01T10:00:00+08:00',
                },
              },
            ],
            has_next: 1,
          },
        }) as Response;
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'web',
        webApiToken: 'web-token',
        apiToken: 'web-token',
        maxDays: 30,
      }), undefined, {
        maxDays: 30,
        syncStartDate: '2026-05-01',
        enabledNoteTypes: ['plain_text'],
      });

      const result = await engine.syncSubscribedKnowledge(undefined, {
        selectedNoteIds: ['blogger_old_web_post'],
        topicIds: ['selected_topic'],
      });

      expect(result.total).toBe(1);
      expect(result.created).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'blogger_old_web_post',
          status: 'created',
        }),
      ]);
      expect(app.vault.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('SyncEngine — sync lastNoteTimestamp tracking', () => {
  it('records the newest updated_at as lastNoteTimestamp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'note_1', updated_at: '2026-05-11T12:00:00+08:00' }),
            makeNote({ note_id: 'note_2', updated_at: '2026-05-10T12:00:00+08:00' }),
            makeNote({ note_id: 'note_3', updated_at: '2026-05-09T12:00:00+08:00' }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

    const result = await engine.sync();
    expect(result.lastNoteTimestamp).toBe('2026-05-11T12:00:00+08:00');
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('does not set lastNoteTimestamp when no notes are processed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: { notes: [], has_more: false, next_cursor: '' },
      }) as Response
    );

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

    const result = await engine.sync();
    expect(result.lastNoteTimestamp).toBeUndefined();
    expect(result.total).toBe(0);
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('tracks newest timestamp across multiple pages', async () => {
    let page = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      page++;
      if (page === 1) {
        return Promise.resolve(mockFetchResponse({
          data: {
            notes: [makeNote({ note_id: 'early', updated_at: '2026-05-10T10:00:00+08:00' })],
            has_more: true,
            next_cursor: 'page2',
          },
        }) as Response);
      }
      return Promise.resolve(mockFetchResponse({
        data: {
          notes: [makeNote({ note_id: 'newer', updated_at: '2026-05-12T10:00:00+08:00' })],
          has_more: false,
          next_cursor: '',
        },
      }) as Response);
    });

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

    const result = await engine.sync();
    expect(result.lastNoteTimestamp).toBe('2026-05-12T10:00:00+08:00');
    expect(result.total).toBe(2);
    vi.mocked(globalThis.fetch).mockRestore();
  });
});

describe('SyncEngine — seenNoteIds cross-page dedup', () => {
  it('deduplicates notes that appear on multiple pages', async () => {
    let page = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      page++;
      if (page === 1) {
        return Promise.resolve(mockFetchResponse({
          data: {
            notes: [
              makeNote({ note_id: 'note_A', title: 'Note A' }),
              makeNote({ note_id: 'note_B', title: 'Note B' }),
            ],
            has_more: true,
            next_cursor: 'page2',
          },
        }) as Response);
      }
      return Promise.resolve(mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'note_B', title: 'Note B' }),
            makeNote({ note_id: 'note_C', title: 'Note C' }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response);
    });

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

    const result = await engine.sync();

    expect(result.total).toBe(3);
    expect(result.created).toBe(3);
    const uniqueNoteIds = new Set(result.items!.map(i => i.noteId));
    expect(uniqueNoteIds.size).toBe(3);
    const noteIds = result.items!.map(i => i.noteId);
    expect(noteIds.filter(id => id === 'note_B')).toHaveLength(1);
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('processes only unique notes when all notes in page 2 are already seen in page 1', async () => {
    let page = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      page++;
      if (page === 1) {
        return Promise.resolve(mockFetchResponse({
          data: {
            notes: [makeNote({ note_id: 'only_A', title: 'Only A' })],
            has_more: true,
            next_cursor: 'page2',
          },
        }) as Response);
      }
      return Promise.resolve(mockFetchResponse({
        data: {
          notes: [makeNote({ note_id: 'only_A', title: 'Only A' })],
          has_more: false,
          next_cursor: '',
        },
      }) as Response);
    });

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));

    const result = await engine.sync();

    expect(result.total).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    vi.mocked(globalThis.fetch).mockRestore();
  });
});

describe('SyncEngine — lastSyncEndTimestamp boundary re-check', () => {
  it('boundary note at lastSyncEndTimestamp is excluded by layer-1 filter (>)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'boundary_note',
              updated_at: '2026-05-10T12:00:00+08:00',
            }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    const app = makeMockApp();
    app.vault._addFile(
      '得到大脑/纯文本/测试笔记.md',
      '---\nuid: "boundary_note"\ntitle: "测试笔记"\nmodified: 2026-05-10 12:00:00\n---\n正文',
      { uid: 'boundary_note', modified: '2026-05-10 12:00:00' }
    );
    app.vault._addFolder('得到大脑/纯文本');

    const engine = new SyncEngine(
      app,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: '2026-05-10T12:00:00+08:00', maxDays: 0 }
    );

    const result = await engine.sync();

    expect(result.total).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.lastNoteTimestamp).toBeUndefined();
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('recreates a previously synced boundary note when the local file is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'deleted_local_note',
              title: '本地误删笔记',
              updated_at: '2026-05-10T12:00:00+08:00',
            }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    const app = makeMockApp();
    app.vault._addFolder('得到大脑/纯文本');
    const engine = new SyncEngine(
      app,
      makeSettings({
        maxDays: 0,
        syncHistory: [
          {
            id: 'previous-sync',
            startedAt: 1,
            finishedAt: 2,
            durationMs: 1,
            timestamp: 2,
            type: 'auto',
            mode: 'auto',
            status: 'success',
            scope: { maxDays: 0, syncStartDate: '2026-05-09T12:00:00+08:00' },
            result: {
              created: 1,
              updated: 0,
              skipped: 0,
              failed: 0,
              total: 1,
              items: [
                {
                  noteId: 'deleted_local_note',
                  title: '本地误删笔记',
                  noteType: 'plain_text',
                  updatedAt: '2026-05-10T12:00:00+08:00',
                  status: 'created',
                },
              ],
              lastNoteTimestamp: '2026-05-10T12:00:00+08:00',
            },
          },
        ],
      }),
      undefined,
      { syncStartDate: '2026-05-10T12:00:00+08:00', maxDays: 0 }
    );

    const result = await engine.sync();

    expect(result.total).toBe(1);
    expect(result.created).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: 'deleted_local_note',
        status: 'created',
      }),
    ]);
    expect(app.vault.create).toHaveBeenCalledWith(
      '得到大脑/纯文本/本地误删笔记.md',
      expect.stringContaining('uid: "deleted_local_note"')
    );
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('does not recreate a previously synced missing note older than the boundary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'old_deleted_local_note',
              title: '旧本地误删笔记',
              updated_at: '2026-05-10T11:59:59+08:00',
            }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    const app = makeMockApp();
    app.vault._addFolder('得到大脑/纯文本');
    const engine = new SyncEngine(
      app,
      makeSettings({
        maxDays: 0,
        syncHistory: [
          {
            id: 'previous-sync',
            startedAt: 1,
            finishedAt: 2,
            durationMs: 1,
            timestamp: 2,
            type: 'auto',
            mode: 'auto',
            status: 'success',
            scope: { maxDays: 0, syncStartDate: '2026-05-09T12:00:00+08:00' },
            result: {
              created: 1,
              updated: 0,
              skipped: 0,
              failed: 0,
              total: 1,
              items: [
                {
                  noteId: 'old_deleted_local_note',
                  title: '旧本地误删笔记',
                  noteType: 'plain_text',
                  updatedAt: '2026-05-10T11:59:59+08:00',
                  status: 'created',
                },
              ],
              lastNoteTimestamp: '2026-05-10T11:59:59+08:00',
            },
          },
        ],
      }),
      undefined,
      { syncStartDate: '2026-05-10T12:00:00+08:00', maxDays: 0 }
    );

    const result = await engine.sync();

    expect(result.total).toBe(0);
    expect(result.created).toBe(0);
    expect(result.lastNoteTimestamp).toBeUndefined();
    expect(app.vault.create).not.toHaveBeenCalled();
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('newer notes (> boundary) pass the > filter and advance lastSyncEndTimestamp', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({
              note_id: 'new_note',
              title: '新笔记',
              updated_at: '2026-05-11T12:00:00+08:00',
            }),
            makeNote({
              note_id: 'boundary_note',
              title: '边界笔记',
              updated_at: '2026-05-10T12:00:00+08:00',
            }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    const app = makeMockApp();
    app.vault._addFile(
      '得到大脑/纯文本/边界笔记.md',
      '---\nuid: "boundary_note"\ntitle: "边界笔记"\nmodified: 2026-05-10 12:00:00\n---\n正文',
      { uid: 'boundary_note', modified: '2026-05-10 12:00:00' }
    );
    app.vault._addFolder('得到大脑/纯文本');

    const engine = new SyncEngine(
      app,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: '2026-05-10T12:00:00+08:00', maxDays: 0 }
    );

    const result = await engine.sync();

    expect(result.total).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.lastNoteTimestamp).toBe('2026-05-11T12:00:00+08:00');
    vi.mocked(globalThis.fetch).mockRestore();
  });
});

describe('SyncEngine — fresh UID ownership', () => {
  it.each(['900719925474099312345', '"900719925474099312345"', "'900719925474099312345'"])(
    'recognizes freshly persisted UID %s at a moved path despite stale metadata', async (uid) => {
      const app = makeMockApp();
      const path = '得到大脑/2026/04/纯文本/本地标题.md';
      const content = `---\nuid: ${uid}\n---\n上传后继续编辑的内容`;
      app.vault._addFile(path, content, { uid: 'stale-uid' });
      const engine = new SyncEngine(app, makeSettings());
      // @ts-expect-error private helper is tested through its real vault boundary
      const index = await engine['buildUidIndex']();
      // @ts-expect-error private helper is tested through its real vault boundary
      const result = await engine['writeNote'](makeNote({ note_id: '900719925474099312345' }), index);
      expect(index.has('stale-uid')).toBe(false);
      expect(result).toEqual({ status: 'skipped', file: expect.objectContaining({ path }) });
      expect(app.vault.create).not.toHaveBeenCalled();
      expect(app.vault.modify).not.toHaveBeenCalled();
      expect(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)).toBe(content);
    },
  );

  it('does not trust a removed UID still present in the metadata cache', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/纯文本/测试笔记.md', '---\ntitle: 本地笔记\n---\n本地内容', { uid: 'note_001' });
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested through its real vault boundary
    const index = await engine['buildUidIndex']();
    // @ts-expect-error private helper is tested through its real vault boundary
    await engine['writeNote'](makeNote(), index);
    expect(index.get('note_001')?.path).toBe('得到大脑/纯文本/测试笔记-2.md');
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('preserves current content if an associated target appears during create', async () => {
    const app = makeMockApp();
    const path = '得到大脑/纯文本/测试笔记.md';
    const content = '---\nuid: "note_001"\n---\n并发写入的本地编辑';
    vi.mocked(app.vault.create).mockImplementationOnce(async () => {
      app.vault._addFile(path, content);
      throw new Error('File already exists');
    });
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested through its real vault boundary
    const result = await engine['writeNote'](makeNote(), new Map<string, TFile>());
    expect(result.status).toBe('skipped');
    expect(app.vault.create).toHaveBeenCalledTimes(1);
    expect(app.vault.modify).not.toHaveBeenCalled();
    expect(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)).toBe(content);
  });

  it('preserves a newly associated target that was absent from the index snapshot', async () => {
    const app = makeMockApp();
    const path = '得到大脑/纯文本/测试笔记.md';
    const content = '---\nuid: "note_001"\n---\n本地新编辑';
    app.vault._addFile(path, content);
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested through its real vault boundary
    const result = await engine['writeNote'](makeNote(), new Map<string, TFile>());
    expect(result.status).toBe('skipped');
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
    expect(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)).toBe(content);
  });
});

describe('SyncEngine — buildUidIndex', () => {
  it('返回空 Map 当 vault 没有 md 文件', async () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested directly
    const index = await engine['buildUidIndex']();
    expect(index.size).toBe(0);
  });

  it('索引带 uid frontmatter 的文件', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/纯文本/test.md', 'content', { uid: 'note_abc' });
    app.vault._addFolder('得到大脑/纯文本');
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested directly
    const index = await engine['buildUidIndex']();
    expect(index.size).toBe(1);
    expect(index.get('note_abc')?.path).toBe('得到大脑/纯文本/test.md');
  });

  it('忽略不带 uid frontmatter 的文件', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/纯文本/test.md', 'content', {});
    app.vault._addFolder('得到大脑/纯文本');
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested directly
    const index = await engine['buildUidIndex']();
    expect(index.size).toBe(0);
  });

  it('只索引 folderName 前缀下的文件', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/纯文本/test.md', 'content', { uid: 'note_001' });
    app.vault._addFile('其他/纯文本/other.md', 'content', { uid: 'note_002' });
    app.vault._addFolder('得到大脑/纯文本');
    app.vault._addFolder('其他/纯文本');
    const engine = new SyncEngine(app, makeSettings());
    // @ts-expect-error private helper is tested directly
    const index = await engine['buildUidIndex']();
    expect(index.size).toBe(1);
    expect(index.has('note_001')).toBe(true);
    expect(index.has('note_002')).toBe(false);
  });
});

describe('SyncEngine — writeNote', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('新建笔记返回 created', async () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings());
    const note = makeNote({ note_id: 'new_001', title: '新笔记' });
    const index = new Map<string, TFile>();
    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](note, index);
    expect(result.status).toBe('created');
  });

  it('日期路径开启后按 created 时间在分类前创建新笔记', async () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM/DD',
    }));
    const note = makeNote({
      note_id: 'dated_001',
      title: '日期笔记',
      created_at: '2024-01-02T03:04:05+08:00',
      updated_at: '2026-07-03T23:59:00+08:00',
    });

    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](note, new Map<string, TFile>());

    expect(result.status).toBe('created');
    expect(app.vault.create).toHaveBeenCalledWith(
      '得到大脑/2024/01/02/纯文本/日期笔记.md',
      expect.any(String),
    );
  });

  it('日期路径开启后知识库路径仍保留完整分类层级', async () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }));
    const note = makeNote({ note_id: 'kb_dated', title: '知识库笔记' });

    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](
      note,
      new Map<string, TFile>(),
      undefined,
      undefined,
      undefined,
      '知识库/我的知识库',
    );

    expect(result.status).toBe('created');
    expect(app.vault.create).toHaveBeenCalledWith(
      '得到大脑/2026/04/知识库/我的知识库/知识库笔记.md',
      expect.any(String),
    );
  });

  it('日期路径开启时相同 UID 仍在原位置跳过且不创建日期目录', async () => {
    const app = makeMockApp();
    const existing = { path: '得到大脑/纯文本/历史笔记.md' } as TFile;
    const engine = new SyncEngine(app, makeSettings({
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }));
    const note = makeNote({ note_id: 'existing_dated', title: '历史笔记' });

    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](
      note,
      new Map<string, TFile>([['existing_dated', existing]]),
    );

    expect(result).toEqual({ status: 'skipped', file: existing });
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it('日期路径开启后附件写入新笔记相邻的 asset 目录', async () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }));
    const note = makeNote({ note_id: 'dated_image', title: '日期图片' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse({})));

    // @ts-expect-error private helper is tested directly
    const path = await engine['downloadImageAsset'](
      note,
      { type: 'image', url: 'https://mediacdn.umiwi.com/image.png', title: '图片' },
    );

    expect(path).toBe('得到大脑/2026/04/纯文本/asset/日期图片_image.png');
    expect(app.vault.createBinary).toHaveBeenCalledWith(
      '得到大脑/2026/04/纯文本/asset/日期图片_image.png',
      expect.any(ArrayBuffer),
    );
  });

  it('日期路径开启且 created 无效时不降级到旧目录', async () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      datePathEnabled: true,
      datePathFormat: 'YYYY/MM',
    }));
    const note = makeNote({
      note_id: 'invalid_created',
      title: '无效日期',
      created_at: 'not-a-date',
    });

    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](note, new Map<string, TFile>());

    expect(result.status).toBe('failed');
    expect(app.vault.createFolder).not.toHaveBeenCalled();
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it('有相同 uid 的笔记无变化返回 skipped', async () => {
    const app = makeMockApp();
    app.vault._addFile(
      '得到大脑/纯文本/新笔记.md',
      '---\nuid: "new_001"\ntitle: "新笔记"\ncreated: 2026-04-27 22:26:17\nmodified: 2026-04-28 10:00:00\n---\n正文',
      { uid: 'new_001', modified: '2026-04-28 10:00:00' }
    );
    app.vault._addFolder('得到大脑/纯文本');
    const engine = new SyncEngine(app, makeSettings());
    const note = makeNote({ note_id: 'new_001', title: '新笔记' });
    const index = new Map<string, TFile>([['new_001', { path: '得到大脑/纯文本/新笔记.md' } as TFile]]);
    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](note, index);
    expect(result.status).toBe('skipped');
  });

  it('有相同 uid 的笔记即使远端更新也跳过且不覆盖本地内容', async () => {
    const app = makeMockApp();
    app.vault._addFile(
      '得到大脑/纯文本/本地编辑.md',
      '---\nuid: "local_edit"\nmodified: "2026-04-28 10:00:00"\n---\n本地手动修改',
      { uid: 'local_edit', modified: '2026-04-28 10:00:00' }
    );
    app.vault._addFolder('得到大脑/纯文本');
    const engine = new SyncEngine(app, makeSettings());
    const note = makeNote({
      note_id: 'local_edit',
      title: '本地编辑',
      content: '远端新内容',
      updated_at: '2026-04-29T10:00:00+08:00',
    });
    const index = new Map<string, TFile>([['local_edit', { path: '得到大脑/纯文本/本地编辑.md' } as TFile]]);

    // @ts-expect-error private helper is tested directly
    const result = await engine['writeNote'](note, index);

    expect(result.status).toBe('skipped');
    expect(app.vault.modify).not.toHaveBeenCalled();
  });
});

describe('SyncEngine — append note sync', () => {
  it('详情关系字段覆盖列表里的 stale is_child_note', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
    const listNote = makeNote({
      note_id: '1909246675068292528',
      parent_id: '1909193892067130512',
      is_child_note: false,
    });
    const detailNote = {
      note_id: '1909246675068292528',
      parent_id: '1909193892067130512',
      is_child_note: true,
    };

    // @ts-expect-error private helper is tested directly to lock relation merge behavior.
    expect(engine['mergeNoteDetail'](listNote, detailNote).is_child_note).toBe(true);
  });

  it('同步主笔记时通过官方详情接口拉取并写入附加笔记', async () => {
    const parentNote = makeNote({
      note_id: '1909193892067130512',
      title: '主笔记',
      content: '主笔记正文',
      children_count: 1,
      updated_at: '2026-05-06 22:07:04',
    });
    const childNote = makeNote({
      note_id: '1909246675068292528',
      title: '',
      content: '附加笔记正文',
      parent_id: parentNote.note_id,
      is_child_note: true,
      updated_at: '2026-05-07 19:19:30',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [parentNote], has_more: false, cursor: '' },
        }) as Response);
      }
      if (urlStr.includes(`/resource/note/detail?id=${parentNote.note_id}`)) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...parentNote,
              children_ids: [childNote.note_id],
              is_child_note: false,
            },
          },
        }) as Response);
      }
      if (urlStr.includes(`/resource/note/detail?id=${childNote.note_id}`)) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: { note: childNote },
        }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const app = makeMockApp();

    try {
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.created).toBe(2);
      expect(result.items).toEqual([
        expect.objectContaining({ noteId: parentNote.note_id, status: 'created' }),
        expect.objectContaining({ noteId: childNote.note_id, status: 'created' }),
      ]);
      const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
      expect(createdPaths).toContain('得到大脑/纯文本/主笔记.md');
      // 子文档命名：父文档名__子文档标题（不用 note_id）
      expect(createdPaths).toContain('得到大脑/纯文本/主笔记__附加笔记正文.md');
      const childContent = vi.mocked(app.vault.create).mock.calls.find(([path]) =>
        path === '得到大脑/纯文本/主笔记__附加笔记正文.md'
      )?.[1] as string;
      expect(childContent).toContain('parent_id: "1909193892067130512"');
      expect(childContent).toContain('is_child_note: true');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('标签白名单独立过滤附加笔记，并通过不匹配的父笔记发现匹配子笔记', async () => {
    const parentNote = makeNote({
      note_id: 'parent-other-tag',
      title: '不匹配父笔记',
      children_count: 1,
      tags: [{ name: '其他' }],
    });
    const childNote = makeNote({
      note_id: 'child-work-tag',
      title: '匹配附加笔记',
      parent_id: parentNote.note_id,
      is_child_note: true,
      tags: [{ name: '工作' }],
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({ data: { notes: [parentNote], has_more: false } }) as Response);
      }
      if (urlStr.includes(`id=${parentNote.note_id}`)) {
        return Promise.resolve(mockFetchResponse({ data: { note: { ...parentNote, children_ids: [childNote.note_id] } } }) as Response);
      }
      if (urlStr.includes(`id=${childNote.note_id}`)) {
        return Promise.resolve(mockFetchResponse({ data: { note: childNote } }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }), undefined, { syncTags: ['工作'] });
      const result = await engine.sync();

      expect(result.items.map(item => item.noteId)).toEqual([childNote.note_id]);
      expect(vi.mocked(app.vault.create).mock.calls.map(([path]) => path)).toEqual([
        '得到大脑/纯文本/匹配附加笔记.md',
      ]);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});

describe('SyncEngine — audio note sync', () => {
  const audioNote: GetNoteNote = {
    id: '1908723638246504120',
    note_id: '1908723638246504120',
    title: '我的录音笔记',
    content: '### 📑 智能总结\n摘要',
    note_type: 'recorder_audio',
    source: 'app',
    tags: [],
    created_at: '2026-04-30T12:45:24+08:00',
    updated_at: '2026-04-30T13:00:07+08:00',
  };

  it('音频笔记下载附件到 asset 目录，md 内嵌音频链接', async () => {
    const createdFiles: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [audioNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...audioNote,
              attachments: [{ type: 'audio', url: 'https://mediacdn.umiwi.com/test.mp3', title: '', duration: 883920 }],
              audio: '🟢 说话人1 [00:00:01]\n转写内容',
            },
          },
        }) as Response);
      }
      if (new URL(urlStr).hostname === 'mediacdn.umiwi.com') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({}),
          json: () => Promise.resolve(null),
          text: () => Promise.resolve(''),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
        } as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const mockApp = makeMockApp();
    mockApp.vault.create = vi.fn().mockImplementation(async (path: string) => {
      createdFiles.push(path);
      return { path };
    });
    mockApp.vault.modify = vi.fn().mockImplementation(async (_file: { path: string }, data: string) => {
      createdFiles.push(`[modify:${data.slice(0, 20)}]`);
    });
    mockApp.vault.createBinary = vi.fn().mockImplementation(async (path: string) => {
      createdFiles.push(path);
      return { path };
    });

    try {
      const engine = new SyncEngine(mockApp, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      // 验证 asset 目录被创建/写入
      expect(createdFiles.some(f => f.includes('/asset/'))).toBe(true);
      expect(createdFiles).toContain('得到大脑/录音笔记/asset/我的录音笔记_1908723638246504120_audio.mp3');
      expect(createdFiles).toContain('得到大脑/录音笔记/asset/我的录音笔记_1908723638246504120_transcript.md');
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        'https://mediacdn.umiwi.com/test.mp3',
        { redirect: 'error' },
      );
      // 验证 md 文件被创建
      expect(createdFiles.some(f => f.endsWith('.md'))).toBe(true);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: audioNote.note_id,
          title: audioNote.title,
          noteType: audioNote.note_type,
          updatedAt: audioNote.updated_at,
          status: 'created',
        }),
      ]);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('关闭音频文件但开启音频口水稿时只写入口水稿', async () => {
    const createdFiles: string[] = [];
    const fetchedUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      fetchedUrls.push(urlStr);
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [audioNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...audioNote,
              attachments: [{ type: 'audio', url: 'https://mediacdn.umiwi.com/test.mp3', title: '', duration: 883920 }],
              audio: '完整录音口水稿',
            },
          },
        }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const mockApp = makeMockApp();
    mockApp.vault.create = vi.fn().mockImplementation(async (path: string, content?: string) => {
      createdFiles.push(path);
      if (content) createdFiles.push(content);
      return { path };
    });
    mockApp.vault.createBinary = vi.fn().mockImplementation(async (path: string) => {
      createdFiles.push(path);
      return { path };
    });

    try {
      const engine = new SyncEngine(mockApp, makeSettings({
        maxDays: 0,
        attachmentImport: {
          image: true,
          audio: false,
          audioTranscript: true,
          video: true,
          document: true,
        } as Settings['attachmentImport'],
      }));
      const result = await engine.sync();

      expect(result.failed).toBe(0);
      expect(createdFiles).toContain('得到大脑/录音笔记/asset/我的录音笔记_1908723638246504120_transcript.md');
      expect(createdFiles.join('\n')).toContain('完整录音口水稿');
      expect(createdFiles.some(path => path.endsWith('_audio.mp3'))).toBe(false);
      expect(fetchedUrls).not.toContain('https://mediacdn.umiwi.com/test.mp3');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('图片笔记从详情接口下载图片附件并写入 md 引用', async () => {
    const imageNote = makeNote({
      note_id: '1911137317526242616',
      title: 'Obsidian GetNote Importer插件配置界面记录',
      content: '图片笔记正文',
      note_type: 'img_text',
      created_at: '2026-05-27T20:35:27+08:00',
      updated_at: '2026-05-27T20:35:27+08:00',
    });
    const createdFiles: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [imageNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...imageNote,
              attachments: [
                {
                  type: 'image',
                  url: 'https://get-notes.umiwi.com/get_notes_prod%2F202605272035%2Fsync-history.png',
                  title: 'sync-history.png',
                },
              ],
            },
          },
        }) as Response);
      }
      if (new URL(urlStr).hostname === 'get-notes.umiwi.com') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({}),
          json: () => Promise.resolve(null),
          text: () => Promise.resolve(''),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
        } as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const mockApp = makeMockApp();
    mockApp.vault.create = vi.fn().mockImplementation(async (path: string, data: string) => {
      createdFiles.push(path);
      createdFiles.push(data);
      return { path };
    });
    mockApp.vault.createBinary = vi.fn().mockImplementation(async (path: string) => {
      createdFiles.push(path);
      return { path };
    });

    try {
      const engine = new SyncEngine(mockApp, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.created).toBe(1);
      expect(createdFiles).toContain('得到大脑/图片笔记/asset/Obsidian GetNote Importer插件配置界面记录_image.png');
      const markdown = createdFiles.find(item => item.includes('图片笔记正文')) ?? '';
      expect(markdown).toContain('> 📷 图片');
      expect(markdown).toContain('> ![](<asset/Obsidian GetNote Importer插件配置界面记录_image.png>)');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('图片笔记已存在但缺少图片时按笔记同步也保守跳过', async () => {
    const imageNote = makeNote({
      note_id: 'image_existing',
      title: '已有图片笔记',
      content: '图片笔记正文',
      note_type: 'img_text',
      created_at: '2026-05-27T20:35:27+08:00',
      updated_at: '2026-05-27T20:35:27+08:00',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [imageNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...imageNote,
              attachments: [
                {
                  type: 'image',
                  url: 'https://get-notes.umiwi.com/get_notes_prod%2F202605272035%2Fexisting.png',
                  title: 'existing.png',
                },
              ],
            },
          },
        }) as Response);
      }
      if (new URL(urlStr).hostname === 'get-notes.umiwi.com') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({}),
          json: () => Promise.resolve(null),
          text: () => Promise.resolve(''),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
        } as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const app = makeMockApp();
    app.vault._addFolder('得到大脑/图片笔记');
    app.vault._addFolder('得到大脑/图片笔记/asset');
    app.vault._addFile(
      '得到大脑/图片笔记/已有图片笔记.md',
      '---\nuid: "image_existing"\nmodified: "2026-05-27 20:35:27"\nnote_type: img_text\n---\n图片笔记正文',
      { uid: 'image_existing', modified: '2026-05-27 20:35:27' }
    );

    try {
      const engine = new SyncEngine(app, makeSettings());
      const result = await engine.syncNoteIds(['image_existing']);

      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
      expect(app.vault.getAbstractFileByPath('得到大脑/图片笔记/asset/已有图片笔记_image.png')).toBeNull();
      expect(app.vault.createBinary).not.toHaveBeenCalled();
      expect(app.vault.modify).not.toHaveBeenCalled();
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('拒绝下载非 HTTPS 音频附件', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp, makeSettings());

    // @ts-expect-error accessing private method for security regression coverage
    const result = await engine['downloadAudioAsset'](audioNote, {
      type: 'audio',
      url: 'http://127.0.0.1/private.mp3',
      title: '',
      duration: 1000,
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockApp.vault.createBinary).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('http://127.0.0.1/private.mp3');

    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('拒绝下载指向 HTTPS 回环地址的音频附件', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp, makeSettings());

    try {
      // @ts-expect-error accessing private method for security regression coverage
      const result = await engine['downloadAudioAsset'](audioNote, {
        type: 'audio',
        url: 'https://127.0.0.1/private.mp3',
        title: '',
        duration: 1000,
      });

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockApp.vault.createBinary).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('disables redirects when downloading from the trusted attachment CDN', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);
    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp, makeSettings());

    try {
      // @ts-expect-error accessing private method for security regression coverage
      await engine['downloadAudioAsset'](audioNote, {
        type: 'audio',
        url: 'https://mediacdn.umiwi.com/voice.mp3',
        title: '',
        duration: 1000,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://mediacdn.umiwi.com/voice.mp3',
        { redirect: 'error' },
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('音频下载失败日志不泄露附件 URL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signedUrl = 'https://mediacdn.umiwi.com/test.mp3?Expires=1778291785&Signature=secret';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({}),
      json: () => Promise.resolve(null),
      text: () => Promise.resolve('forbidden'),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response);

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp, makeSettings());

    try {
      // @ts-expect-error accessing private method for security regression coverage
      const result = await engine['downloadAudioAsset'](audioNote, {
        type: 'audio',
        url: signedUrl,
        title: '',
        duration: 1000,
      });

      expect(result).toBeNull();
      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(signedUrl);
    } finally {
      errorSpy.mockRestore();
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('详情接口缺少核心笔记字段时使用列表笔记兜底', async () => {
    const createdFiles: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [audioNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...audioNote,
              attachments: [{ type: 'audio', url: 'https://mediacdn.umiwi.com/test.mp3', title: '', duration: 883920 }],
              audio: { original: '🟢 说话人1 [00:00:01]\n转写内容' },
            },
          },
        }) as Response);
      }
      if (new URL(urlStr).hostname === 'mediacdn.umiwi.com') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({}),
          json: () => Promise.resolve(null),
          text: () => Promise.resolve(''),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
        } as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const mockApp = makeMockApp();
    mockApp.vault.create = vi.fn().mockImplementation(async (path: string, content?: string) => {
      createdFiles.push(path);
      if (content) createdFiles.push(content);
      return { path };
    });
    mockApp.vault.createBinary = vi.fn().mockImplementation(async (path: string) => {
      createdFiles.push(path);
      return { path };
    });

    try {
      const engine = new SyncEngine(mockApp, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.failed).toBe(0);
      expect(createdFiles).toContain('得到大脑/录音笔记/asset/我的录音笔记_1908723638246504120_audio.mp3');
      expect(createdFiles).toContain('得到大脑/录音笔记/asset/我的录音笔记_1908723638246504120_transcript.md');
      expect(createdFiles).toContain('得到大脑/录音笔记/我的录音笔记.md');
      expect(createdFiles.join('\n')).toContain('created: 2026-04-30 12:45:24');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});

describe('SyncEngine — link original sync', () => {
  const linkNote = makeNote({
    note_id: 'link_001',
    title: '链接标题',
    content: 'AI 摘要正文',
    note_type: 'link',
    created_at: '2026-05-09T10:00:00+08:00',
    updated_at: '2026-05-09T10:05:00+08:00',
  });

  it('writes OpenAPI link original content to an asset Markdown file and links it from the main note', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [linkNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...linkNote,
              web_page: {
                title: '原网页标题',
                url: 'https://example.com/source',
                content: '链接原文全文',
              },
            },
          },
        }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const app = makeMockApp();

    try {
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.created).toBe(1);
      const mainFile = app.vault.getAbstractFileByPath('得到大脑/链接笔记/链接标题.md') as { content: string } | null;
      const originalFile = app.vault.getAbstractFileByPath('得到大脑/链接笔记/asset/链接标题_link_001_original.md') as { content: string } | null;

      expect(mainFile?.content).toContain('AI 摘要正文');
      expect(mainFile?.content).toContain('> 📄 链接原文');
      expect(mainFile?.content).toContain('> [[链接标题_link_001_original]]');
      expect(originalFile?.content).toBe('# 原网页标题\n\n来源链接：https://example.com/source\n\n链接原文全文');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('does not create an empty original asset when the remote link original is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [linkNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...linkNote,
              web_page: {
                title: '原网页标题',
                url: 'https://example.com/source',
                content: '',
              },
            },
          },
        }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const app = makeMockApp();

    try {
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.created).toBe(1);
      const mainFile = app.vault.getAbstractFileByPath('得到大脑/链接笔记/链接标题.md') as { content: string } | null;
      expect(mainFile?.content).not.toContain('> 📄 链接原文');
      expect(app.vault.getAbstractFileByPath('得到大脑/链接笔记/asset/链接标题_link_001_original.md')).toBeNull();
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('refreshes a stale link original asset during selected re-sync', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      const urlStr = typeof url === 'string' ? url : (url as Request).url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve(mockFetchResponse({
          data: { notes: [linkNote], has_more: false, next_cursor: '' },
        }) as Response);
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve(mockFetchResponse({
          success: true,
          data: {
            note: {
              ...linkNote,
              web_page: {
                title: '原网页标题',
                url: 'https://example.com/source',
                content: '更新后的链接原文',
              },
            },
          },
        }) as Response);
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    });

    const app = makeMockApp();
    app.vault._addFolder('得到大脑/链接笔记');
    app.vault._addFolder('得到大脑/链接笔记/asset');
    app.vault._addFile(
      '得到大脑/链接笔记/链接标题.md',
      '---\nuid: "link_001"\nmodified: "2026-05-09 10:05:00"\nnote_type: link\n---\nAI 摘要正文',
      { uid: 'link_001', modified: '2026-05-09 10:05:00' }
    );
    app.vault._addFile(
      '得到大脑/链接笔记/asset/链接标题_link_001_original.md',
      '# 原网页标题\n\n来源链接：https://example.com/source\n\n旧原文'
    );

    try {
      const engine = new SyncEngine(app, makeSettings());
      const result = await engine.syncNoteIds(['link_001']);

      expect(result.skipped).toBe(1);
      const originalFile = app.vault.getAbstractFileByPath('得到大脑/链接笔记/asset/链接标题_link_001_original.md') as { content: string } | null;
      expect(originalFile?.content).toContain('旧原文');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});

describe('SyncEngine — selective sync cancellation', () => {
  describe('SyncEngine — preCheckNote', () => {
    it('不存在 uidIndex 时返回 { exists: false }', () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({ note_id: 'note_missing' });
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, new Map());
      expect(result.exists).toBe(false);
    });

    it('uid 命中但内容已修改时仍返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/纯文本/test.md',
        '---\nuid: "note_changed"\nmodified: "2026-04-27 10:00:00"\n---\n旧内容',
        { uid: 'note_changed', modified: '2026-04-27 10:00:00' }
      );
      app.vault._addFolder('得到大脑/纯文本');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'note_changed',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['note_changed', { path: '得到大脑/纯文本/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
      expect(result.file).toBeDefined();
    });

    it('uid 命中且内容未变时返回 { exists: true }（非音频笔记）', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/纯文本/test.md',
        '---\nuid: "note_unchanged"\nmodified: "2026-04-28 10:00:00"\n---\n正文',
        { uid: 'note_unchanged', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/纯文本');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'note_unchanged',
        note_type: 'plain_text',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['note_unchanged', { path: '得到大脑/纯文本/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('音频笔记：附件齐全且内容未变时返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/录音笔记/test.md',
        '---\nuid: "audio_ready"\nmodified: "2026-04-28 10:00:00"\n---\n音频笔记',
        { uid: 'audio_ready', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/录音笔记');
      app.vault._addFolder('得到大脑/录音笔记/asset');
      app.vault._addFile('得到大脑/录音笔记/asset/测试笔记_audio.mp3', '');
      app.vault._addFile('得到大脑/录音笔记/asset/测试笔记_transcript.md', '');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'audio_ready',
        title: '测试笔记',
        note_type: 'recorder_audio',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['audio_ready', { path: '得到大脑/录音笔记/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('音频笔记：缺少音频文件时仍返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/录音笔记/test.md',
        '---\nuid: "audio_missing_mp3"\nmodified: "2026-04-28 10:00:00"\n---\n音频笔记',
        { uid: 'audio_missing_mp3', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/录音笔记');
      app.vault._addFolder('得到大脑/录音笔记/asset');
      app.vault._addFile('得到大脑/录音笔记/asset/测试笔记_transcript.md', '');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'audio_missing_mp3',
        title: '测试笔记',
        note_type: 'recorder_audio',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['audio_missing_mp3', { path: '得到大脑/录音笔记/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('音频笔记：缺少转写文件时仍返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/录音笔记/test.md',
        '---\nuid: "audio_missing_transcript"\nmodified: "2026-04-28 10:00:00"\n---\n音频笔记',
        { uid: 'audio_missing_transcript', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/录音笔记');
      app.vault._addFolder('得到大脑/录音笔记/asset');
      app.vault._addFile('得到大脑/录音笔记/asset/测试笔记_audio.mp3', '');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'audio_missing_transcript',
        title: '测试笔记',
        note_type: 'recorder_audio',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['audio_missing_transcript', { path: '得到大脑/录音笔记/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('非音频、非链接笔记忽略附件检查直接通过', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/纯文本/test.md',
        '---\nuid: "note_link"\nmodified: "2026-04-28 10:00:00"\n---\n链接笔记',
        { uid: 'note_link', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/纯文本');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'note_link',
        note_type: 'plain_text',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['note_link', { path: '得到大脑/纯文本/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('图片笔记：图片笔记目录下已存在非 png 图片附件时返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/图片笔记/test.md',
        '---\nuid: "image_ready"\nmodified: "2026-04-28 10:00:00"\n---\n图片笔记',
        { uid: 'image_ready', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/图片笔记');
      app.vault._addFolder('得到大脑/图片笔记/asset');
      app.vault._addFile('得到大脑/图片笔记/asset/测试笔记_image.jpg', '');
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'image_ready',
        title: '测试笔记',
        note_type: 'img_text',
        updated_at: '2026-04-28T10:00:00+08:00',
        attachments: [
          { type: 'image', url: 'https://mediacdn.umiwi.com/path/photo.jpg', title: 'photo' },
        ],
      });
      const index = new Map([['image_ready', { path: '得到大脑/图片笔记/test.md' }]]);
      // @ts-expect-error private helper is tested directly
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('图片笔记：图片笔记目录下的非音频笔记也会下载多张图片附件', async () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'image_multi',
        title: '测试笔记',
        note_type: 'img_text',
        attachments: [
          { type: 'image', url: 'https://mediacdn.umiwi.com/photo-a.jpg', title: 'photo-a' },
          { type: 'image', url: 'https://mediacdn.umiwi.com/photo-b.jpg', title: 'photo-b' },
        ],
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}) as Response);

      try {
        // @ts-expect-error private helper is tested directly
        const enriched = await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(enriched.assetPaths).toEqual([
          '得到大脑/图片笔记/asset/测试笔记_image.jpg',
          '得到大脑/图片笔记/asset/测试笔记_image_2.jpg',
        ]);
        expect(app.vault.getAbstractFileByPath('得到大脑/图片笔记/asset/测试笔记_image.jpg')).toBeTruthy();
        expect(app.vault.getAbstractFileByPath('得到大脑/图片笔记/asset/测试笔记_image_2.jpg')).toBeTruthy();
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });

    it('同一笔记的同名通用附件会下载到不同文件', async () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'duplicate_generic_names',
        title: '测试笔记',
        attachments: [
          { type: 'file', url: 'https://cdn-a.umiwi.com/attachment.pdf', title: 'first' },
          { type: 'file', url: 'https://cdn-b.umiwi.com/attachment.pdf', title: 'second' },
        ],
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}) as Response);

      try {
        // @ts-expect-error private helper is tested directly
        const enriched = await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(enriched.assetPaths).toEqual([
          '得到大脑/纯文本/asset/测试笔记_attachment.pdf',
          '得到大脑/纯文本/asset/测试笔记_attachment_2.pdf',
        ]);
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });

    it('通用附件在本地 vault 使用文件系统快速写入路径', async () => {
      const basePath = await mkdtemp(join(tmpdir(), 'dedao-generic-asset-'));
      const app = makeMockApp();
      app.vault.adapter = { getBasePath: () => basePath };
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'local_fast_path',
        title: '测试笔记',
        attachments: [
          { type: 'file', url: 'https://mediacdn.umiwi.com/handout.pdf', title: 'handout' },
        ],
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ...mockFetchResponse({}),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      } as Response);

      try {
        // @ts-expect-error private helper is tested directly
        await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(app.vault.createBinary).not.toHaveBeenCalled();
        await expect(readFile(join(basePath, '得到大脑/纯文本/asset/测试笔记_handout.pdf')))
          .resolves.toEqual(Buffer.from([1, 2, 3]));
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
        await rm(basePath, { recursive: true, force: true });
      }
    });

    it('通用附件文件名会忽略 URL fragment', async () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings());
      const note = makeNote({
        note_id: 'fragment_generic_name',
        title: '测试笔记',
        attachments: [
          { type: 'file', url: 'https://mediacdn.umiwi.com/clip.mp4#t=10', title: 'clip' },
        ],
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}) as Response);

      try {
        // @ts-expect-error private helper is tested directly
        const enriched = await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(enriched.assetPaths).toEqual([
          '得到大脑/纯文本/asset/测试笔记_clip.mp4',
        ]);
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });

    it('Web API 模式会处理列表响应中已有的通用附件', async () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        authMode: 'web',
        webApiToken: 'web-token',
      }));
      const note = makeNote({
        note_id: 'web_generic_attachment',
        title: '测试笔记',
        attachments: [
          { type: 'file', url: 'https://mediacdn.umiwi.com/handout.pdf', title: 'handout' },
        ],
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}) as Response);

      try {
        // @ts-expect-error private helper is tested directly
        const enriched = await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(enriched.assetPaths).toEqual([
          '得到大脑/纯文本/asset/测试笔记_handout.pdf',
        ]);
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });

    it('禁用音频导入时不会保留会渲染成断链的音频字段', async () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({
        attachmentImport: { image: true, audio: false, video: true, document: true },
      }));
      const note = makeNote({
        note_id: 'audio_disabled',
        title: '测试笔记',
        note_type: 'recorder_audio',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        data: {
          ...note,
          audio: { duration: 10 },
          attachments: [
            { type: 'audio', url: 'https://mediacdn.umiwi.com/audio.mp3', title: 'audio' },
          ],
        },
      }) as Response);

      try {
        // @ts-expect-error private helper is tested directly
        const enriched = await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(enriched.audio).toBeUndefined();
        expect(enriched.attachments).not.toContainEqual(expect.objectContaining({ type: 'audio' }));
        expect(enriched.assetFileName).toBeUndefined();
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });
  });

  describe('SyncEngine — syncNoteIds pre-check integration', () => {
    it('预检查通过时跳过笔记（标记为 skipped，不调用 enrichAudioNote）', async () => {
      const note = makeNote({
        note_id: 'pre_skip',
        title: '已有笔记',
        note_type: 'plain_text',
      });

      // 在 vault 中预先创建该笔记（UID 命中且内容一致）
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/纯文本/已有笔记.md',
        '---\nuid: "pre_skip"\nmodified: "2026-04-28 10:00:00"\n---\n已有内容',
        { uid: 'pre_skip', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/纯文本');

      // Mock API 返回该笔记
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({
          data: { notes: [note], has_more: false, next_cursor: '' },
        }) as Response
      );

      try {
        const engine = new SyncEngine(app, makeSettings());
        const result = await engine.syncNoteIds(['pre_skip']);

        expect(result.total).toBe(1);
        expect(result.skipped).toBe(1);
        expect(result.created).toBe(0);
        expect(result.updated).toBe(0);

        // 验证未创建任何新文件（pre-check 跳过了全部写操作）
        expect(app.vault.create).not.toHaveBeenCalled();
        expect(app.vault.modify).not.toHaveBeenCalled();

        // 验证 recordItem 正确记录了 skipped 状态
        expect(result.items).toEqual([
          expect.objectContaining({
            noteId: 'pre_skip',
            status: 'skipped',
          }),
        ]);
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });

    it('预检查不通过时正常处理笔记', async () => {
      const note = makeNote({
        note_id: 'pre_proceed',
        title: '新笔记',
        note_type: 'plain_text',
      });

      // vault 中不存在该笔记（UID 不命中）
      const app = makeMockApp();
      app.vault._addFolder('得到大脑/纯文本');

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({
          data: { notes: [note], has_more: false, next_cursor: '' },
        }) as Response
      );

      try {
        const engine = new SyncEngine(app, makeSettings());
        const result = await engine.syncNoteIds(['pre_proceed']);

        expect(result.total).toBe(1);
        expect(result.created).toBe(1);
        expect(result.skipped).toBe(0);

        // 验证创建了新文件
        expect(app.vault.create).toHaveBeenCalledTimes(1);

        // 验证 recordItem 正确记录了 created 状态
        expect(result.items).toEqual([
          expect.objectContaining({
            noteId: 'pre_proceed',
            status: 'created',
          }),
        ]);
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });

    it('部分笔记通过预检查、部分未通过时正确混合计数', async () => {
      const existing = makeNote({
        note_id: 'existing',
        title: '已存在',
        note_type: 'plain_text',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const newNote = makeNote({
        id: 2,
        note_id: 'new_one',
        title: '新增',
        note_type: 'plain_text',
        updated_at: '2026-04-29T10:00:00+08:00',
      });

      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/纯文本/已存在.md',
        '---\nuid: "existing"\nmodified: "2026-04-28 10:00:00"\n---\n已有',
        { uid: 'existing', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('得到大脑/纯文本');

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({
          data: { notes: [existing, newNote], has_more: false, next_cursor: '' },
        }) as Response
      );

      try {
        const engine = new SyncEngine(app, makeSettings());
        const result = await engine.syncNoteIds(['existing', 'new_one']);

        expect(result.total).toBe(2);
        expect(result.skipped).toBe(1);
        expect(result.created).toBe(1);
        expect(result.updated).toBe(0);
        expect(result.failed).toBe(0);

        expect(result.items).toEqual([
          expect.objectContaining({ noteId: 'existing', status: 'skipped' }),
          expect.objectContaining({ noteId: 'new_one', status: 'created' }),
        ]);
      } finally {
        vi.mocked(globalThis.fetch).mockRestore();
      }
    });
  });

  it('engine.cancel 会停止选择同步的后续笔记处理', async () => {
    const notes = [
      makeNote({ note_id: 'select_1', title: '选择 1' }),
      makeNote({ note_id: 'select_2', title: '选择 2' }),
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: { notes, has_more: false, next_cursor: '' },
      }) as Response
    );

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp, makeSettings(), (info) => {
      if (info.processed === 1) {
        engine.cancel();
      }
    });

    try {
      await expect(engine.syncNoteIds(['select_1', 'select_2'])).rejects.toThrow('Sync cancelled');
      expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});
describe('SyncEngine auth credential chains', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function expectLastFetchHeaders(expected: Record<string, string>) {
    const call = vi.mocked(globalThis.fetch).mock.calls.at(-1);
    expect(call).toBeTruthy();
    const options = call![1] as RequestInit;
    expect(options.headers).toEqual(expect.objectContaining(expected));
  }

  it('sync() uses OpenAPI credentials for the full/manual/auto engine chain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ data: { notes: [], has_more: false, next_cursor: '' } }) as Response
    );

    const engine = new SyncEngine(makeMockApp(), makeSettings({
      authMode: 'openapi',
      apiToken: 'active-web-token',
      clientId: 'legacy-client',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      webApiToken: 'web-token',
    }));

    await engine.sync();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0',
      expect.any(Object)
    );
    expectLastFetchHeaders({
      Authorization: 'Bearer openapi-token',
      'X-Client-ID': 'openapi-client',
    });
  });

  it('sync() uses Web credentials for the full/manual/auto engine chain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { list: [], has_more: false } }) as Response
    );

    const engine = new SyncEngine(makeMockApp(), makeSettings({
      authMode: 'web',
      apiToken: 'active-openapi-token',
      clientId: 'openapi-client',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      webApiToken: 'web-token',
    }));

    await engine.sync();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=&sort=create_desc',
      expect.any(Object)
    );
    expectLastFetchHeaders({
      Authorization: 'Bearer web-token',
      'x-request-id': expect.any(String) as unknown as string,
    });
  });

  it('syncNoteIds() uses OpenAPI credentials for selected-note sync', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        success: true,
        data: { note_id: 'note-1', title: 't', content: '', note_type: 'plain_text', source: 'app', tags: [], created_at: '', updated_at: '' },
      }) as Response
    );

    const engine = new SyncEngine(makeMockApp(), makeSettings({
      authMode: 'openapi',
      apiToken: 'active-web-token',
      clientId: 'legacy-client',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      webApiToken: 'web-token',
    }));

    await engine.syncNoteIds(['note-1']);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=note-1',
      expect.any(Object)
    );
    expectLastFetchHeaders({
      Authorization: 'Bearer openapi-token',
      'X-Client-ID': 'openapi-client',
    });
  });

  it('syncNoteIds() uses Web credentials for selected-note sync', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        h: {},
        c: { note_id: 'note-1', title: 't', content: '', note_type: 'plain_text', source: 'app', tags: [], created_at: '', updated_at: '' },
      }) as Response
    );

    const engine = new SyncEngine(makeMockApp(), makeSettings({
      authMode: 'web',
      apiToken: 'active-openapi-token',
      clientId: 'openapi-client',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      webApiToken: 'web-token',
    }));

    await engine.syncNoteIds(['note-1']);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes/note-1',
      expect.any(Object)
    );
    expectLastFetchHeaders({
      Authorization: 'Bearer web-token',
      'x-request-id': expect.any(String) as unknown as string,
    });
  });
});

// ---- Integration tests using fixture loader ----
import { getFixtureRequests, loadScenario, resetFixtures } from './mocks/fixtures/loader';

describe('SyncEngine — fixture-based sync integration', () => {
  it('OpenAPI: full sync writes paginated notes across core note types', async () => {
    resetFixtures();
    loadScenario('sync-core-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(3);
    expect(result.lastNoteTimestamp).toBe('2026-05-20 10:00:00');
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toEqual(expect.arrayContaining([
      '得到大脑/纯文本/OpenAPI 纯文本.md',
      '得到大脑/链接笔记/OpenAPI 链接.md',
      '得到大脑/纯文本/OpenAPI 第二页.md',
    ]));
    expect(getFixtureRequests().map(request => request.url)).toEqual([
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0',
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=open_link_2',
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=open_link_2',
    ]);
  });

  it('OpenAPI: full sync writes only enabled note types', async () => {
    resetFixtures();
    loadScenario('sync-core-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }), undefined, {
      enabledNoteTypes: ['plain_text'],
    });

    const result = await engine.sync();

    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(2);
    expect(result.items.map(item => item.noteId)).toEqual(['open_plain_1', 'open_plain_3']);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toEqual([
      '得到大脑/纯文本/OpenAPI 纯文本.md',
      '得到大脑/纯文本/OpenAPI 第二页.md',
    ]);
  });

  it('WebAPI: full sync writes paginated notes with web list query shape', async () => {
    resetFixtures();
    loadScenario('sync-core-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(3);
    expect(result.lastNoteTimestamp).toBe('2026-05-20 10:00:00');
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toEqual(expect.arrayContaining([
      '得到大脑/纯文本/WebAPI 纯文本.md',
      '得到大脑/链接笔记/WebAPI 链接.md',
      '得到大脑/纯文本/WebAPI 第二页.md',
    ]));
    expect(getFixtureRequests().map(request => request.url)).toEqual([
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=&sort=create_desc',
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_web_link_2/original',
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=web_link_2&sort=create_desc',
    ]);
  });

  it('WebAPI: full sync writes only enabled note types', async () => {
    resetFixtures();
    loadScenario('sync-core-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }), undefined, {
      enabledNoteTypes: ['plain_text'],
    });

    const result = await engine.sync();

    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(2);
    expect(result.items.map(item => item.noteId)).toEqual(['web_plain_1', 'web_plain_3']);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toEqual([
      '得到大脑/纯文本/WebAPI 纯文本.md',
      '得到大脑/纯文本/WebAPI 第二页.md',
    ]);
  });

  it('WebAPI: selective sync writes only requested notes', async () => {
    resetFixtures();
    loadScenario('selective-sync-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.syncNoteIds(['web_selected']);

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: 'web_selected', status: 'created' }),
    ]);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toEqual(['得到大脑/纯文本/WebAPI 被选择.md']);
  });

  it('OpenAPI: selective sync skips selected notes outside the enabled type filter', async () => {
    resetFixtures();
    loadScenario('selective-sync-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }), undefined, {
      enabledNoteTypes: ['link'],
    });

    const result = await engine.syncNoteIds(['1909193892067130512']);

    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(getFixtureRequests().map(request => request.url)).toEqual([
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=1909193892067130512',
    ]);
  });

  it('WebAPI: selective sync skips selected notes outside the enabled type filter', async () => {
    resetFixtures();
    loadScenario('selective-sync-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }), undefined, {
      enabledNoteTypes: ['link'],
    });

    const result = await engine.syncNoteIds(['web_selected']);

    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(getFixtureRequests().map(request => request.url)).toEqual([
      'https://get-notes.luojilab.com/voicenotes/web/notes/web_selected',
    ]);
  });

  it('WebAPI: selective sync writes selected parent with append children', async () => {
    resetFixtures();
    loadScenario('sync-parent-and-children-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.syncNoteIds(['1909193892067130512']);

    expect(result.created).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(3);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292529', status: 'created' }),
    ]);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__附加笔记正文.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__第二条附加笔记正文.md');
    expect(getFixtureRequests().map(request => request.url)).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=&sort=create_desc'
    );
    expect(getFixtureRequests().map(request => request.url)).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=1909246675068292528&sort=create_desc'
    );
  });

  it('OpenAPI: parent + child notes both created', async () => {
    resetFixtures();
    loadScenario('sync-parent-and-children-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(3);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292529', status: 'created' }),
    ]);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__附加笔记正文.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__第二条附加笔记正文.md');
    expect(getFixtureRequests().map(request => request.url)).not.toContain(
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=1909246675068292530'
    );
    const childContent = vi.mocked(app.vault.create).mock.calls.find(([path]) =>
      path === '得到大脑/纯文本/主笔记__附加笔记正文.md'
    )?.[1] as string;
    expect(childContent).toContain('parent_id: "1909193892067130512"');
    expect(childContent).toContain('is_child_note: true');
  });

  it('OpenAPI: detail child relation overrides stale list child IDs', async () => {
    resetFixtures();
    loadScenario('sync-stale-children-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
    ]);
    const requestUrls = getFixtureRequests().map(request => request.url);
    expect(requestUrls).toContain(
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=1909193892067130512'
    );
    expect(requestUrls).not.toContain(
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=1909246675068292530'
    );
  });

  it('WebAPI: detail child relation overrides stale list child IDs', async () => {
    resetFixtures();
    loadScenario('sync-stale-children-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
    ]);
    const requestUrls = getFixtureRequests().map(request => request.url);
    expect(requestUrls).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512'
    );
    expect(requestUrls).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=&sort=create_desc'
    );
    const parentContent = vi.mocked(app.vault.create).mock.calls.find(([path]) =>
      path === '得到大脑/录音笔记/WebAPI 录音主笔记.md'
    )?.[1] as string;
    expect(parentContent).toContain('children_ids: ["1909246675068292528"]');
    expect(parentContent).not.toContain('1909246675068292530');
  });

  it('WebAPI: parent + child notes both created', async () => {
    resetFixtures();
    loadScenario('sync-parent-and-children-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(3);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292529', status: 'created' }),
    ]);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__附加笔记正文.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__第二条附加笔记正文.md');
    expect(getFixtureRequests().map(request => request.url)).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=&sort=create_desc'
    );
    expect(getFixtureRequests().map(request => request.url)).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=1909246675068292528&sort=create_desc'
    );
    expect(getFixtureRequests().map(request => request.url)).not.toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512'
    );
  });

  it('OpenAPI: append-note detail failure increments result.failed', async () => {
    resetFixtures();
    loadScenario('sync-failed-child-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(1); // parent OK
    expect(result.failed).toBe(1);   // child failed
    const failedItems = result.items.filter(i => i.status === 'failed');
    expect(failedItems.length).toBe(1);
    expect(failedItems[0].noteId).toBe('1909246675068292528');
  });

  it('WebAPI: append-note detail failure increments result.failed', async () => {
    resetFixtures();
    loadScenario('sync-failed-child-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    const failedItems = result.items.filter(i => i.status === 'failed');
    expect(failedItems.length).toBe(1);
    expect(failedItems[0].noteId).toBe('prime_1909193892067130512');
    expect(getFixtureRequests().map(request => request.url)).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=&sort=create_desc'
    );
  });

  it('WebAPI: fetchAppendNotes uses prime_id when available (P1 fix)', async () => {
    resetFixtures();
    loadScenario('sync-parent-primeid-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'web',
      webApiToken: 'test-web-token',
      maxDays: 0,
    }));

    const result = await engine.sync();

    expect(result.created).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
    ]);
    expect(getFixtureRequests().map(request => request.url)).toContain(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime_1909193892067130512/children?limit=20&since_id=&sort=create_desc'
    );
  });

  it('selective sync: parent + child both written via syncNoteIds', async () => {
    resetFixtures();
    loadScenario('selective-sync-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings({
      authMode: 'openapi',
      openApiToken: 'test-openapi-token',
      openApiClientId: 'test-client',
      maxDays: 0,
    }));

    const result = await engine.syncNoteIds(['1909193892067130512']);

    expect(result.created).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({ noteId: '1909193892067130512', status: 'created' }),
      expect.objectContaining({ noteId: '1909246675068292528', status: 'created' }),
    ]);
    const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记.md');
    expect(createdPaths).toContain('得到大脑/纯文本/主笔记__附加笔记正文.md');
    expect(createdPaths).not.toContain('得到大脑/纯文本/未选择的 OpenAPI 笔记.md');
  });
});

describe('SyncEngine — tag whitelist filter', () => {
  it('keeps all notes when syncTags is empty (no filter applied)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'plain', note_type: 'plain_text', tags: [] }),
            makeNote({ note_id: 'tagged', note_type: 'plain_text', tags: [{ name: 'work' }] }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }), undefined, { syncTags: [] });
      const result = await engine.sync();
      expect(result.total).toBe(2);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('keeps only notes that have at least one tag in the whitelist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'a', note_type: 'plain_text', tags: [{ name: 'work' }] }),
            makeNote({ note_id: 'b', note_type: 'plain_text', tags: [{ name: 'daily' }] }),
            makeNote({ note_id: 'c', note_type: 'plain_text', tags: [] }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }), undefined, { syncTags: ['work'] });
      const result = await engine.sync();
      expect(result.total).toBe(1);
      expect(result.items?.map(i => i.noteId)).toEqual(['a']);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('matches tags case-insensitively for whitelist filter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'a', note_type: 'plain_text', tags: [{ name: 'Work' }] }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }), undefined, { syncTags: ['work'] });
      const result = await engine.sync();
      expect(result.total).toBe(1);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('returns no notes when whitelist tags do not exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        data: {
          notes: [
            makeNote({ note_id: 'a', note_type: 'plain_text', tags: [{ name: 'work' }] }),
          ],
          has_more: false,
          next_cursor: '',
        },
      }) as Response
    );

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app, makeSettings({ maxDays: 0 }), undefined, { syncTags: ['nope'] });
      const result = await engine.sync();
      expect(result.total).toBe(0);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('filterNotesByTags private method returns all notes when whitelist is undefined', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings());
    const notes = [
      makeNote({ note_id: 'a', tags: [{ name: 'work' }] }),
      makeNote({ note_id: 'b', tags: [] }),
    ];
    // @ts-expect-error accessing private method
    expect(engine['filterNotesByTags'](notes)).toHaveLength(2);
  });

  it('filterNotesByTags private method returns matching notes for non-empty whitelist', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app, makeSettings());
    const notes = [
      makeNote({ note_id: 'a', tags: [{ name: 'work' }, { name: 'project' }] }),
      makeNote({ note_id: 'b', tags: [{ name: 'daily' }] }),
      makeNote({ note_id: 'c', tags: [{ name: 'project' }] }),
    ];
    // @ts-expect-error accessing private method
    const result = engine['filterNotesByTags'](notes, ['work', 'project']);
    expect(result.map(n => n.note_id).sort()).toEqual(['a', 'c']);
  });
});

describe('SyncEngine — 跨库同步 (syncKnowledgeBases)', () => {
  const fetchSubscribedSpy = vi.fn();

  beforeEach(() => {
    fetchSubscribedSpy.mockReset();
  });

  it('知识库失败进度使用知识库阶段自己的分子', async () => {
    fetchSubscribedSpy.mockResolvedValue([
      makeNote({
        note_id: 'blogger_failed',
        note_type: 'blogger_post',
        source: 'blogger',
        topic_id: 'kb-1',
        fetch_error: 'temporary detail failure',
      }),
    ]);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      const progressSpy = vi.fn();
      const engine = new EngineReloaded(makeMockApp(), makeSettings(), progressSpy, {
        maxDays: 0,
        syncKnowledgeBases: ['kb-1'],
      });
      const result = {
        created: 10,
        updated: 0,
        skipped: 0,
        failed: 0,
        total: 10,
        items: [],
      };

      await engine['runCrossKnowledgeBaseSync'](result, new AbortController().signal);

      expect(progressSpy).toHaveBeenCalledWith(expect.objectContaining({
        processed: 1,
        total: 1,
        percent: 100,
      }));
    } finally {
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('保留更新时间恰好等于自动同步断点的知识库笔记', async () => {
    const checkpoint = '2026-07-17T10:00:00+08:00';
    fetchSubscribedSpy.mockResolvedValue([
      makeNote({
        note_id: 'blogger_checkpoint_equal',
        title: '断点同秒文章',
        note_type: 'blogger_post',
        source: 'blogger',
        topic_id: 'kb-1',
        created_at: checkpoint,
        updated_at: checkpoint,
      }),
    ]);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      const app = makeMockApp();
      const engine = new EngineReloaded(app, makeSettings(), undefined, {
        maxDays: 0,
        syncStartDate: checkpoint,
        syncKnowledgeBases: ['kb-1'],
        knowledgeBaseNames: { 'kb-1': '测试知识库' },
      });
      const result = {
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        items: [],
      };

      await engine['runCrossKnowledgeBaseSync'](result, new AbortController().signal);

      expect(result.created).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'blogger_checkpoint_equal',
          status: 'created',
        }),
      ]);
    } finally {
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('普通跨库同步复用 maxDays 和笔记类型过滤', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00+08:00'));
    fetchSubscribedSpy.mockResolvedValue([
      makeNote({
        id: 'recent-blogger',
        note_id: 'blogger_recent',
        title: '近期博主文章',
        note_type: 'blogger_post',
        source: 'blogger',
        topic_id: 'kb-1',
        created_at: '2026-07-16T10:00:00+08:00',
        updated_at: '2026-07-16T10:00:00+08:00',
      }),
      makeNote({
        id: 'old-blogger',
        note_id: 'blogger_old',
        title: '过期博主文章',
        note_type: 'blogger_post',
        source: 'blogger',
        topic_id: 'kb-1',
        created_at: '2026-06-01T10:00:00+08:00',
        updated_at: '2026-06-01T10:00:00+08:00',
      }),
      makeNote({
        id: 'recent-plain',
        note_id: 'recent_plain',
        title: '近期普通笔记',
        note_type: 'plain_text',
        source: 'knowledge',
        topic_id: 'kb-1',
        created_at: '2026-07-16T10:00:00+08:00',
        updated_at: '2026-07-16T10:00:00+08:00',
      }),
    ]);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        success: true,
        data: { notes: [], has_more: false, next_cursor: '0' },
      }) as Response);
      const app = makeMockApp();
      const engine = new EngineReloaded(app, makeSettings({ maxDays: 7 }), undefined, {
        maxDays: 7,
        enabledNoteTypes: ['blogger_post'],
        syncKnowledgeBases: ['kb-1'],
        knowledgeBaseNames: { 'kb-1': '测试知识库' },
      });

      const result = await engine.sync();

      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'blogger_recent',
          noteType: 'blogger_post',
          status: 'created',
        }),
      ]);
      expect(app.vault.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.doUnmock('../src/api');
      vi.resetModules();
      vi.useRealTimers();
    }
  });

  it('跨库单笔写入失败后继续后续笔记并阻止自动断点前移', async () => {
    fetchSubscribedSpy.mockResolvedValue([
      makeNote({
        id: 'failed-blogger',
        note_id: 'blogger_failed',
        title: '写入失败文章',
        note_type: 'blogger_post',
        source: 'blogger',
        topic_id: 'kb-1',
        updated_at: '2026-07-17T11:00:00+08:00',
      }),
      makeNote({
        id: 'successful-blogger',
        note_id: 'blogger_successful',
        title: '后续成功文章',
        note_type: 'blogger_post',
        source: 'blogger',
        topic_id: 'kb-1',
        updated_at: '2026-07-17T10:00:00+08:00',
      }),
    ]);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        success: true,
        data: { notes: [], has_more: false, next_cursor: '0' },
      }) as Response);
      const app = makeMockApp();
      vi.mocked(app.vault.create).mockRejectedValueOnce(new Error('disk full'));
      const engine = new EngineReloaded(app, makeSettings({
        maxDays: 0,
        lastSyncEndTimestamp: '2026-07-16T10:00:00+08:00',
      }), undefined, {
        maxDays: 0,
        syncKnowledgeBases: ['kb-1'],
        knowledgeBaseNames: { 'kb-1': '测试知识库' },
      });

      const result = await engine.sync();

      expect(result.items).toEqual([
        expect.objectContaining({ noteId: 'blogger_failed', status: 'failed', error: 'disk full' }),
        expect.objectContaining({ noteId: 'blogger_successful', status: 'created' }),
      ]);
      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.checkpointBlocked).toBe(true);
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('append 获取不完整时不写父子文件并在下轮原子重试完整关系', async () => {
    const parentNote = makeNote({
      id: 'parent',
      note_id: 'knowledge_parent',
      title: '父笔记',
      note_type: 'plain_text',
      source: 'knowledge',
      topic_id: 'kb-1',
      children_count: 2,
      children_ids: ['knowledge_child_1', 'knowledge_child_2'],
      updated_at: '2026-07-17T11:00:00+08:00',
    });
    const firstChild = {
      id: 'child-1',
      note_id: 'knowledge_child_1',
      title: '子笔记一',
      content: '子笔记一正文',
      note_type: 'plain_text',
      source: 'knowledge',
      tags: [],
      created_at: '2026-07-17T10:00:00+08:00',
      updated_at: '2026-07-17T10:00:00+08:00',
      parent_id: 'knowledge_parent',
      is_child_note: true,
    };
    const secondChild = {
      ...firstChild,
      id: 'child-2',
      note_id: 'knowledge_child_2',
      title: '子笔记二',
      content: '子笔记二正文',
    };
    const fetchDetailSpy = vi.fn()
      .mockResolvedValueOnce(firstChild)
      .mockRejectedValueOnce(new Error('temporary child fetch failure'))
      .mockResolvedValueOnce(firstChild)
      .mockResolvedValueOnce(secondChild);
    fetchSubscribedSpy.mockResolvedValue([parentNote]);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
        fetchNoteDetail: fetchDetailSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        success: true,
        data: { notes: [], has_more: false, next_cursor: '0' },
      }) as Response);
      const app = makeMockApp();
      const settings = makeSettings({ maxDays: 0 });
      const scope = {
        maxDays: 0,
        syncKnowledgeBases: ['kb-1'],
        knowledgeBaseNames: { 'kb-1': '测试知识库' },
      };
      const firstProgressSpy = vi.fn();

      const firstResult = await new EngineReloaded(app, settings, firstProgressSpy, scope).sync();

      expect(firstResult.items).toEqual([
        expect.objectContaining({
          noteId: 'knowledge_child_2',
          status: 'failed',
          error: 'temporary child fetch failure',
        }),
      ]);
      expect(firstResult.checkpointBlocked).toBe(true);
      expect(firstProgressSpy).toHaveBeenCalledWith(expect.objectContaining({
        processed: 1,
        total: 1,
        failed: 1,
      }));
      expect(app.vault.create).not.toHaveBeenCalled();

      const secondResult = await new EngineReloaded(app, settings, undefined, scope).sync();

      expect(secondResult.items).toEqual([
        expect.objectContaining({ noteId: 'knowledge_parent', status: 'created' }),
        expect.objectContaining({ noteId: 'knowledge_child_1', status: 'created' }),
        expect.objectContaining({ noteId: 'knowledge_child_2', status: 'created' }),
      ]);
      expect(secondResult.checkpointBlocked).not.toBe(true);
      expect(secondResult.lastNoteTimestamp).toBe('2026-07-17T11:00:00+08:00');
      expect(fetchDetailSpy).toHaveBeenCalledTimes(4);
      expect(app.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('/父笔记.md'),
        expect.stringContaining('[[父笔记__子笔记一]]')
      );
      expect(app.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('/父笔记.md'),
        expect.stringContaining('[[父笔记__子笔记二]]')
      );
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('syncKnowledgeBases=[] 时不调用 fetchSubscribedKnowledgeNotes（关闭跨库同步）', async () => {
    fetchSubscribedSpy.mockResolvedValue([]);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      const app = makeMockApp();
      const settings = makeSettings({
        scheduledSync: {
          ...DEFAULT_SCHEDULED_SYNC,
          enabled: true,
          syncKnowledgeBases: [],
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        success: true,
        data: { notes: [], has_more: false, next_cursor: '0' },
      }) as Response);

      const engine = new EngineReloaded(app, settings, undefined, {
        maxDays: 0,
        syncStartDate: '2026-04-27',
      });

      await engine.sync();

      expect(fetchSubscribedSpy).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('syncKnowledgeBases 非空时本地已有 note_id 的笔记会保守跳过', async () => {
    const fakeNotes = [
      {
        id: 'blogger:kb-1:1',
        note_id: 'blogger_kb-1',
        title: '已有博主笔记',
        content: '新内容',
        note_type: 'blogger_post',
        source: 'blogger',
        tags: [{ name: '测试博主' }],
        created_at: '2026-04-27T22:26:17+08:00',
        updated_at: '2026-04-29T10:00:00+08:00', // 比旧 modified 更新
      },
      {
        id: 'blogger:kb-1:2',
        note_id: 'blogger_kb-2',
        title: '新博主笔记',
        content: '全新内容',
        note_type: 'blogger_post',
        source: 'blogger',
        tags: [{ name: '测试博主' }],
        created_at: '2026-04-27T22:26:17+08:00',
        updated_at: '2026-04-28T10:00:00+08:00',
      },
    ];
    fetchSubscribedSpy.mockResolvedValue(fakeNotes);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/订阅博主/已有博主笔记.md',
        '---\nuid: "blogger_kb-1"\nmodified: "2026-04-28 10:00:00"\n---\n旧内容',
        { uid: 'blogger_kb-1', modified: '2026-04-28 10:00:00' }
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        success: true,
        data: { notes: [], has_more: false, next_cursor: '0' },
      }) as Response);

      const settings = makeSettings({
        scheduledSync: {
          ...DEFAULT_SCHEDULED_SYNC,
          enabled: true,
          syncKnowledgeBases: ['kb-1'],
        },
      });

      const engine = new EngineReloaded(app, settings, undefined, {
        maxDays: 0,
        syncStartDate: '2026-04-27',
        syncKnowledgeBases: ['kb-1'],
      });

      const result = await engine.sync();

      // 跨库路径被触发
      expect(fetchSubscribedSpy).toHaveBeenCalled();
      // 本地已存在的 kb-1 即使远端更新也应被标记为 skipped
      expect(result.items?.some(item => item.noteId === 'blogger_kb-1' && item.status === 'skipped')).toBe(true);
      // kb-2 应被标记为 created
      expect(result.items?.some(item => item.noteId === 'blogger_kb-2' && item.status === 'created')).toBe(true);
    } finally {
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('跨库同步时，本地存在且内容相同则跳过', async () => {
    const sameContent = '相同内容';
    const fakeNotes = [
      {
        id: 'blogger:kb-3:1',
        note_id: 'blogger_kb-3',
        title: '未变博主笔记',
        content: sameContent,
        note_type: 'blogger_post',
        source: 'blogger',
        tags: [],
        created_at: '2026-04-27T22:26:17+08:00',
        updated_at: '2026-04-28T10:00:00+08:00',
      },
    ];
    fetchSubscribedSpy.mockResolvedValue(fakeNotes);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      const app = makeMockApp();
      app.vault._addFile(
        '得到大脑/订阅博主/未变博主笔记.md',
        '---\nuid: "blogger_kb-3"\nmodified: "2026-04-28 10:00:00"\n---\n相同内容',
        { uid: 'blogger_kb-3', modified: '2026-04-28 10:00:00' }
      );
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({
        success: true,
        data: { notes: [], has_more: false, next_cursor: '0' },
      }) as Response);

      const settings = makeSettings({
        scheduledSync: {
          ...DEFAULT_SCHEDULED_SYNC,
          enabled: true,
          syncKnowledgeBases: ['kb-3'],
        },
      });

      const engine = new EngineReloaded(app, settings, undefined, {
        maxDays: 0,
        syncStartDate: '2026-04-27',
        syncKnowledgeBases: ['kb-3'],
      });

      const result = await engine.sync();

      expect(fetchSubscribedSpy).toHaveBeenCalled();
      expect(result.items?.some(item => item.noteId === 'blogger_kb-3' && item.status === 'skipped')).toBe(true);
    } finally {
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });

  it('跨库同步：音频笔记本地已存在但缺音频文件时也保守跳过', async () => {
    const noteId = 'cross_kb_audio_missing';
    const fakeNotes = [
      {
        id: 'cross_kb_audio_missing:1',
        note_id: noteId,
        title: '跨库音频笔记',
        content: '跨库正文',
        note_type: 'recorder_audio',
        source: 'blogger',
        topic_id: 'kb-audio',
        tags: [],
        created_at: '2026-04-27T22:26:17+08:00',
        updated_at: '2026-04-28T10:00:00+08:00',
        attachments: [
          { type: 'audio', url: 'https://mediacdn.umiwi.com/cross-kb.mp3', title: '', duration: 1000 },
        ],
        audio: '🟢 说话人1 [00:00:01]\n转写',
      },
    ];
    fetchSubscribedSpy.mockResolvedValue(fakeNotes);
    vi.doMock('../src/api', async () => {
      const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
      return {
        ...actual,
        fetchSubscribedKnowledgeNotes: fetchSubscribedSpy,
      };
    });
    vi.resetModules();
    const { SyncEngine: EngineReloaded } = await import('../src/sync');

    try {
      const app = makeMockApp();
      // md 已存在 + uid 命中 + modified 匹配 + transcript 存在，但音频 mp3 缺失
      app.vault._addFolder('得到大脑/知识库/跨库专题');
      app.vault._addFolder('得到大脑/知识库/跨库专题/asset');
      app.vault._addFile(
        `得到大脑/知识库/跨库专题/跨库音频笔记.md`,
        `---\nuid: "${noteId}"\nmodified: "2026-04-28 10:00:00"\nnote_type: recorder_audio\n---\n跨库正文`,
        { uid: noteId, modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFile('得到大脑/知识库/跨库专题/asset/跨库音频笔记_transcript.md', '');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: Request | string | URL) => {
        const urlStr = typeof url === 'string' ? url : url?.url ?? '';
        if (urlStr.includes('/resource/note/list')) {
          return mockFetchResponse({
            success: true,
            data: { notes: [], has_more: false, next_cursor: '0' },
          }) as Response;
        }
        if (urlStr.includes('/resource/note/detail')) {
          return mockFetchResponse({
            success: true,
            data: {
              note: {
                note_id: noteId,
                title: '跨库音频笔记',
                content: '跨库正文',
                note_type: 'recorder_audio',
                attachments: [
                  { type: 'audio', url: 'https://mediacdn.umiwi.com/cross-kb.mp3', title: '', duration: 1000 },
                ],
                audio: '🟢 说话人1 [00:00:01]\n转写',
                created_at: '2026-04-27T22:26:17+08:00',
                updated_at: '2026-04-28T10:00:00+08:00',
              },
            },
          }) as Response;
        }
        if (new URL(urlStr).hostname === 'mediacdn.umiwi.com') {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new ArrayBuffer(32),
          } as Response;
        }
        throw new Error(`Unexpected request: ${urlStr}`);
      });

      const settings = makeSettings({
        scheduledSync: {
          ...DEFAULT_SCHEDULED_SYNC,
          enabled: true,
          syncKnowledgeBases: ['kb-audio'],
        },
      });

      const engine = new EngineReloaded(app, settings, undefined, {
        maxDays: 0,
        syncStartDate: '2026-04-27',
        syncKnowledgeBases: ['kb-audio'],
        knowledgeBaseNames: { kb_audio: '跨库专题', kb_audio_missing: '跨库专题' } as Record<string, string>,
      });

      const result = await engine.sync();

      // 本地已有同 UID Markdown 时默认跳过，不补下载附件或覆盖正文。
      const itemsForNote = result.items?.filter(item => item.noteId === noteId) ?? [];
      expect(itemsForNote.length).toBeGreaterThan(0);
      const statuses = itemsForNote.map(item => item.status);
      expect(statuses).toEqual(['skipped']);
      // 不应尝试下载音频
      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.map(call => String(call[0]));
      expect(fetchCalls.some(url => url === 'https://mediacdn.umiwi.com/cross-kb.mp3')).toBe(false);
    } finally {
      vi.doUnmock('../src/api');
      vi.resetModules();
    }
  });
});
