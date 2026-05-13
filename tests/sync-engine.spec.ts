import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as obsidian from 'obsidian';
import { SyncEngine } from '../src/sync';
import type { Settings, GetNoteNote } from '../src/types';

// Minimal mock app for SyncEngine tests
function makeMockApp() {
  const files: Map<string, { path: string; content: string; frontmatter: Record<string, string> }> = new Map();
  const folders = new Set<string>();

  return {
    vault: {
      getAllFolders: () =>
        [...folders].map((path) => ({ path })),
      getAbstractFileByPath: (path: string) => files.get(path) || null,
      getMarkdownFiles: () =>
        [...files.values()]
          .filter((f) => f.path.endsWith('.md'))
          .map((f) => ({ path: f.path })),
      createFolder: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockImplementation((path: string, data: string) => {
        files.set(path, { path, content: data, frontmatter: {} });
        return { path };
      }),
      createBinary: vi.fn().mockImplementation(async (path: string, data: Uint8Array) => {
        files.set(path, { path, content: `[binary:${data.byteLength}]`, frontmatter: {} });
        return { path };
      }),
      modify: vi.fn().mockImplementation((file: { path: string }, data: string) => {
        const existing = files.get(file.path);
        if (existing) {
          files.set(file.path, { ...existing, content: data });
        }
        return Promise.resolve();
      }),
      rename: vi.fn().mockImplementation((file: { path: string }, newPath: string) => {
        const existing = files.get(file.path);
        if (existing) {
          files.delete(file.path);
          files.set(newPath, existing);
        }
        return Promise.resolve();
      }),
      createFolderSync: (path: string) => { folders.add(path); },
      _addFile: (path: string, content: string, frontmatter: Record<string, string> = {}) => {
        files.set(path, { path, content, frontmatter });
      },
      _addFolder: (path: string) => { folders.add(path); },
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const f = files.get(file.path);
        return f ? { frontmatter: f.frontmatter } : null;
      },
    },
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    apiToken: 'test-token',
    clientId: 'test-client',
    folderName: 'Get笔记',
    maxDays: 30,
    filenamePrefix: '',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
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

// Mock fetchAllNotes generator
function mockFetchAllNotes(notes: GetNoteNote[] = []) {
  const gen = (async function* () {
    yield notes;
  })();
  return gen as unknown as ReturnType<typeof import('../src/api').fetchAllNotes>;
}

describe('SyncEngine — filterRecentNotes', () => {
  it('disables maxDays when syncStartDate is set', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 30, syncStartDate: '2026-05-09' }));

    expect(engine['scopeOptions']).toEqual({
      maxDays: 0,
      syncStartDate: '2026-05-09',
    });
  });

  it('返回所有笔记当 maxDays <= 0', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));
    const notes = [makeNote({ note_id: '1' }), makeNote({ note_id: '2' })];
    // @ts-ignore accessing private via any
    expect(engine['filterRecentNotes'](notes)).toHaveLength(2);
  });

  it('过滤掉超过 maxDays 的笔记', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 7 }));
    const now = new Date();
    const oldNote = makeNote({
      note_id: 'old',
      updated_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recentNote = makeNote({
      note_id: 'recent',
      updated_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    // @ts-ignore
    const result = engine['filterRecentNotes']([oldNote, recentNote]);
    expect(result).toHaveLength(1);
    expect(result[0].note_id).toBe('recent');
  });

  it('边界：刚好 maxDays 当天的笔记保留', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 5 }));
    const now = new Date();
    const at5days = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000 + 1000).toISOString();
    const note = makeNote({ note_id: 'boundary', updated_at: at5days });
    // @ts-ignore
    expect(engine['filterRecentNotes']([note])).toHaveLength(1);
  });
});

describe('SyncEngine — page cutoff', () => {
  it('treats date-only syncStartDate as the local start of day', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(
      app as any,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: '2026-05-09', maxDays: 0 }
    );
    const localMidnight = new Date(2026, 4, 9, 0, 30, 0);
    const justAfterLocalMidnight = makeNote({
      note_id: 'local_midnight',
      updated_at: localMidnight.toISOString(),
    });

    // @ts-ignore accessing private method for boundary regression coverage
    expect(engine['filterNotesByDateRange']([justAfterLocalMidnight])).toHaveLength(1);
  });

  it('uses chronological time instead of string order for last synced timestamp', async () => {
    const requestSpy = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: JSON.stringify({
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
      }),
      json: null,
      arrayBuffer: new ArrayBuffer(0),
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

      const result = await engine.sync();

      expect(result.lastNoteTimestamp).toBe('2026-05-09T02:00:00Z');
    } finally {
      requestSpy.mockRestore();
    }
  });

  it('processes recent notes on a page before stopping at an old tail note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00+08:00'));
    const requestSpy = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: JSON.stringify({
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
      }),
      json: null,
      arrayBuffer: new ArrayBuffer(0),
    });

    try {
      const app = makeMockApp();
      const engine = new SyncEngine(app as any, makeSettings({ maxDays: 1 }));

      const result = await engine.sync();

      expect(result.created).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({
          noteId: 'today',
          status: 'created',
        }),
      ]);
    } finally {
      requestSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('SyncEngine — buildUidIndex', () => {
  it('返回空 Map 当 vault 没有 md 文件', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings());
    // @ts-ignore
    const index = engine['buildUidIndex']();
    expect(index.size).toBe(0);
  });

  it('索引带 uid frontmatter 的文件', () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/纯文本/test.md', 'content', { uid: 'note_abc' });
    app.vault._addFolder('Get笔记/纯文本');
    const engine = new SyncEngine(app as any, makeSettings());
    // @ts-ignore
    const index = engine['buildUidIndex']();
    expect(index.size).toBe(1);
    expect(index.get('note_abc')?.path).toBe('Get笔记/纯文本/test.md');
  });

  it('忽略不带 uid frontmatter 的文件', () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/纯文本/test.md', 'content', {});
    app.vault._addFolder('Get笔记/纯文本');
    const engine = new SyncEngine(app as any, makeSettings());
    // @ts-ignore
    const index = engine['buildUidIndex']();
    expect(index.size).toBe(0);
  });

  it('只索引 folderName 前缀下的文件', () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/纯文本/test.md', 'content', { uid: 'note_001' });
    app.vault._addFile('其他/纯文本/other.md', 'content', { uid: 'note_002' });
    app.vault._addFolder('Get笔记/纯文本');
    app.vault._addFolder('其他/纯文本');
    const engine = new SyncEngine(app as any, makeSettings());
    // @ts-ignore
    const index = engine['buildUidIndex']();
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
    const engine = new SyncEngine(app as any, makeSettings());
    const note = makeNote({ note_id: 'new_001', title: '新笔记' });
    const index = new Map<string, any>();
    // @ts-ignore
    const result = await engine['writeNote'](note, index);
    expect(result.status).toBe('created');
  });

  it('有相同 uid 的笔记无变化返回 skipped', async () => {
    const app = makeMockApp();
    app.vault._addFile(
      'Get笔记/纯文本/新笔记.md',
      '---\nuid: "new_001"\ntitle: "新笔记"\ncreated: 2026-04-27 22:26:17\nmodified: 2026-04-28 10:00:00\n---\n正文',
      { uid: 'new_001', modified: '2026-04-28 10:00:00' }
    );
    app.vault._addFolder('Get笔记/纯文本');
    const engine = new SyncEngine(app as any, makeSettings());
    const note = makeNote({ note_id: 'new_001', title: '新笔记' });
    const index = new Map<string, any>([['new_001', { path: 'Get笔记/纯文本/新笔记.md' }]]);
    // @ts-ignore
    const result = await engine['writeNote'](note, index);
    expect(result.status).toBe('skipped');
  });
});

describe('SyncEngine — getFileName', () => {
  it('无前缀时返回标题', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ filenamePrefix: '' }));
    const note = makeNote({ title: '我的笔记' });
    // @ts-ignore
    expect(engine['getFileName'](note)).toBe('我的笔记');
  });

  it('有前缀时返回 prefix_title', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ filenamePrefix: 'YYYY-MM-DD' }));
    const note = makeNote({ title: '我的笔记' });
    // @ts-ignore
    expect(engine['getFileName'](note)).toBe('2026-04-27_我的笔记');
  });

  it('无效日期前缀返回标题（无前缀）', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ filenamePrefix: 'YYYY-MM-DD' }));
    const note = makeNote({ title: '我的笔记', created_at: 'invalid' });
    // @ts-ignore
    expect(engine['getFileName'](note)).toBe('我的笔记');
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
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const requestSpy = vi.spyOn(obsidian, 'requestUrl').mockImplementation((request: any) => {
      const urlStr = typeof request === 'string' ? request : request.url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({
            data: { notes: [audioNote], has_more: false, next_cursor: '' },
          }),
          json: { data: { notes: [audioNote], has_more: false, next_cursor: '' } },
          arrayBuffer: new ArrayBuffer(0),
        });
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({
            success: true,
            data: {
              ...audioNote,
              attachments: [{ type: 'audio', url: 'https://cdn.example.com/test.mp3', title: '', duration: 883920 }],
              audio: '🟢 说话人1 [00:00:01]\n转写内容',
            },
          }),
          json: null,
          arrayBuffer: new ArrayBuffer(0),
        });
      }
      if (new URL(urlStr).hostname === 'cdn.example.com') {
        return Promise.resolve({
          status: 200,
          headers: {},
          text: '',
          json: null,
          arrayBuffer: new ArrayBuffer(1024),
        });
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    }) as any;

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

    const engine = new SyncEngine(mockApp as any, makeSettings());
    const result = await engine.sync();

    // 验证 asset 目录被创建/写入
    expect(createdFiles.some(f => f.includes('/asset/'))).toBe(true);
    expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_audio.mp3');
    expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_transcript.md');
    expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://cdn.example.com/test.mp3',
      throw: false,
    }));
    expect(fetchSpy).not.toHaveBeenCalledWith('https://cdn.example.com/test.mp3');
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

    logSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('拒绝下载非 HTTPS 音频附件', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const requestSpy = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
      status: 200,
      headers: {},
      text: '',
      json: null,
      arrayBuffer: new ArrayBuffer(1024),
    });

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp as any, makeSettings());

    // @ts-ignore accessing private method for security regression coverage
    const result = await engine['downloadAudioAsset'](audioNote, {
      type: 'audio',
      url: 'http://127.0.0.1/private.mp3',
      title: '',
      duration: 1000,
    });

    expect(result).toBeNull();
    expect(requestSpy).not.toHaveBeenCalled();
    expect(mockApp.vault.createBinary).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('http://127.0.0.1/private.mp3');

    warnSpy.mockRestore();
  });

  it('音频下载失败日志不泄露附件 URL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
      status: 403,
      headers: {},
      text: 'forbidden',
      json: null,
      arrayBuffer: new ArrayBuffer(0),
    });

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp as any, makeSettings());
    const signedUrl = 'https://cdn.example.com/test.mp3?Expires=1778291785&Signature=secret';

    // @ts-ignore accessing private method for security regression coverage
    const result = await engine['downloadAudioAsset'](audioNote, {
      type: 'audio',
      url: signedUrl,
      title: '',
      duration: 1000,
    });

    expect(result).toBeNull();
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(signedUrl);

    errorSpy.mockRestore();
  });

  it('详情接口缺少核心笔记字段时使用列表笔记兜底', async () => {
    const createdFiles: string[] = [];

    vi.spyOn(obsidian, 'requestUrl').mockImplementation((request: any) => {
      const urlStr = typeof request === 'string' ? request : request.url;
      if (urlStr.includes('/resource/note/list')) {
        return Promise.resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({
            data: { notes: [audioNote], has_more: false, next_cursor: '' },
          }),
          json: null,
          arrayBuffer: new ArrayBuffer(0),
        });
      }
      if (urlStr.includes('/resource/note/detail')) {
        return Promise.resolve({
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: JSON.stringify({
            success: true,
            data: {
              attachments: [{ type: 'audio', url: 'https://cdn.example.com/test.mp3', title: '', duration: 883920 }],
              audio: { original: '🟢 说话人1 [00:00:01]\n转写内容' },
            },
          }),
          json: null,
          arrayBuffer: new ArrayBuffer(0),
        });
      }
      if (new URL(urlStr).hostname === 'cdn.example.com') {
        return Promise.resolve({
          status: 200,
          headers: {},
          text: '',
          json: null,
          arrayBuffer: new ArrayBuffer(1024),
        });
      }
      throw new Error(`Unexpected request: ${urlStr}`);
    }) as any;

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

    const engine = new SyncEngine(mockApp as any, makeSettings());
    const result = await engine.sync();

    expect(result.failed).toBe(0);
    expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_audio.mp3');
    expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_transcript.md');
    expect(createdFiles).toContain('Get笔记/录音长录/我的录音笔记.md');
    expect(createdFiles.join('\n')).toContain('created: 2026-04-30 12:45:24');
  });
});

describe('SyncEngine — selective sync cancellation', () => {
  it('engine.cancel 会停止选择同步的后续笔记处理', async () => {
    const notes = [
      makeNote({ note_id: 'select_1', title: '选择 1' }),
      makeNote({ note_id: 'select_2', title: '选择 2' }),
    ];

    vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: JSON.stringify({
        data: { notes, has_more: false, next_cursor: '' },
      }),
      json: { data: { notes, has_more: false, next_cursor: '' } },
      arrayBuffer: new ArrayBuffer(0),
    }) as any;

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp as any, makeSettings(), (info) => {
      if (info.processed === 1) {
        engine.cancel();
      }
    });

    await expect(engine.syncNoteIds(['select_1', 'select_2'])).rejects.toThrow('Sync cancelled');
    expect(mockApp.vault.create).toHaveBeenCalledTimes(1);
  });
});
