import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    authMode: 'openapi',
    openApiToken: '',
    openApiClientId: '',
    webApiToken: '',
    apiToken: 'test-token',
    clientId: 'test-client',
    webCsrfToken: '',
    folderName: 'Get笔记',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    filenamePrefix: '',
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

describe('SyncEngine — filterRecentNotes', () => {
  it('disables maxDays when syncStartDate is set', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 30, syncStartDate: '2026-05-09' }));

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
      const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }), undefined, { enabledNoteTypes: ['link'] });

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
      const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

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
      const engine = new SyncEngine(app as any, makeSettings({
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
      const engine = new SyncEngine(app as any, makeSettings({
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
      app as any,
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

    // @ts-ignore
    const result = engine['filterNotesByDateRange']([boundaryNote, afterBoundary, beforeBoundary]);

    expect(result).toHaveLength(1);
    expect(result[0].note_id).toBe('after');
  });

  it('keeps all notes when syncStartDate is empty', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

    const notes = [
      makeNote({ note_id: 'n1', updated_at: '2026-04-01T10:00:00+08:00' }),
      makeNote({ note_id: 'n2', updated_at: '2026-04-02T10:00:00+08:00' }),
    ];
    // @ts-ignore
    expect(engine['filterNotesByDateRange'](notes)).toHaveLength(2);
  });

  it('returns all notes when syncStartDate is an unparsable value', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(
      app as any,
      makeSettings({ maxDays: 0 }),
      undefined,
      { syncStartDate: 'not-a-date', maxDays: 0 }
    );

    const notes = [makeNote({ note_id: 'n1' })];
    // @ts-ignore
    expect(engine['filterNotesByDateRange'](notes)).toHaveLength(1);
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
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

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
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

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
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

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
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

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
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));

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
      'Get笔记/纯文本/测试笔记.md',
      '---\nuid: "boundary_note"\ntitle: "测试笔记"\nmodified: 2026-05-10 12:00:00\n---\n正文',
      { uid: 'boundary_note', modified: '2026-05-10 12:00:00' }
    );
    app.vault._addFolder('Get笔记/纯文本');

    const engine = new SyncEngine(
      app as any,
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
      'Get笔记/纯文本/边界笔记.md',
      '---\nuid: "boundary_note"\ntitle: "边界笔记"\nmodified: 2026-05-10 12:00:00\n---\n正文',
      { uid: 'boundary_note', modified: '2026-05-10 12:00:00' }
    );
    app.vault._addFolder('Get笔记/纯文本');

    const engine = new SyncEngine(
      app as any,
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

  it('附加笔记使用父文档名作为前缀', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ filenamePrefix: 'getnote' }));
    const note = makeNote({
      title: '原笔记标题',
      note_id: '1909246675068292528',
      parent_id: '1909193892067130512',
      is_child_note: true,
    });

    // 子文档不带 parentBaseName 时，返回带前缀的标题（不用 note_id）
    // @ts-ignore
    expect(engine['getFileName'](note)).toBe('getnote_原笔记标题');

    // 传入父文档 baseName 时，格式为：父文档名__子文档标题
    // @ts-ignore
    expect(engine['getFileName'](note, 'getnote_主笔记标题')).toBe('getnote_主笔记标题__原笔记标题');
  });
});

describe('SyncEngine — append note sync', () => {
  it('详情关系字段覆盖列表里的 stale is_child_note', () => {
    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));
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

    // @ts-ignore private helper is tested directly to lock relation merge behavior.
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
      const engine = new SyncEngine(app as any, makeSettings({ maxDays: 0 }));
      const result = await engine.sync();

      expect(result.created).toBe(2);
      expect(result.items).toEqual([
        expect.objectContaining({ noteId: parentNote.note_id, status: 'created' }),
        expect.objectContaining({ noteId: childNote.note_id, status: 'created' }),
      ]);
      const createdPaths = vi.mocked(app.vault.create).mock.calls.map(([path]) => path);
      expect(createdPaths).toContain('Get笔记/纯文本/主笔记.md');
      // 子文档命名：父文档名__子文档标题（不用 note_id）
      expect(createdPaths).toContain('Get笔记/纯文本/主笔记__附加笔记正文.md');
      const childContent = vi.mocked(app.vault.create).mock.calls.find(([path]) =>
        path === 'Get笔记/纯文本/主笔记__附加笔记正文.md'
      )?.[1] as string;
      expect(childContent).toContain('parent_id: "1909193892067130512"');
      expect(childContent).toContain('is_child_note: true');
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
            ...audioNote,
            attachments: [{ type: 'audio', url: 'https://cdn.example.com/test.mp3', title: '', duration: 883920 }],
            audio: '🟢 说话人1 [00:00:01]\n转写内容',
          },
        }) as Response);
      }
      if (new URL(urlStr).hostname === 'cdn.example.com') {
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
      const engine = new SyncEngine(mockApp as any, makeSettings());
      const result = await engine.sync();

      // 验证 asset 目录被创建/写入
      expect(createdFiles.some(f => f.includes('/asset/'))).toBe(true);
      expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_audio.mp3');
      expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_transcript.md');
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('https://cdn.example.com/test.mp3');
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
      const engine = new SyncEngine(mockApp as any, makeSettings());
      const result = await engine.sync();

      expect(result.created).toBe(1);
      expect(createdFiles).toContain('Get笔记/图片笔记/asset/Obsidian GetNote Importer插件配置界面记录_image.png');
      const markdown = createdFiles.find(item => item.includes('图片笔记正文')) ?? '';
      expect(markdown).toContain('> 📷 图片');
      expect(markdown).toContain('> ![](<asset/Obsidian GetNote Importer插件配置界面记录_image.png>)');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('图片笔记已存在但缺少图片时按笔记同步会补下载并重写 md 引用', async () => {
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
    app.vault._addFolder('Get笔记/图片笔记');
    app.vault._addFolder('Get笔记/图片笔记/asset');
    app.vault._addFile(
      'Get笔记/图片笔记/已有图片笔记.md',
      '---\nuid: "image_existing"\nmodified: "2026-05-27 20:35:27"\nnote_type: img_text\n---\n图片笔记正文',
      { uid: 'image_existing', modified: '2026-05-27 20:35:27' }
    );

    try {
      const engine = new SyncEngine(app as any, makeSettings());
      const result = await engine.syncNoteIds(['image_existing']);

      expect(result.updated).toBe(1);
      expect(app.vault.getAbstractFileByPath('Get笔记/图片笔记/asset/已有图片笔记_image.png')).toBeTruthy();
      const modifiedContent = vi.mocked(app.vault.modify).mock.calls[0]?.[1] as string;
      expect(modifiedContent).toContain('> 📷 图片');
      expect(modifiedContent).toContain('> ![](asset/已有图片笔记_image.png)');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });

  it('拒绝下载非 HTTPS 音频附件', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

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
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockApp.vault.createBinary).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('http://127.0.0.1/private.mp3');

    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('音频下载失败日志不泄露附件 URL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signedUrl = 'https://cdn.example.com/test.mp3?Expires=1778291785&Signature=secret';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({}),
      json: () => Promise.resolve(null),
      text: () => Promise.resolve('forbidden'),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response);

    const mockApp = makeMockApp();
    const engine = new SyncEngine(mockApp as any, makeSettings());

    try {
      // @ts-ignore accessing private method for security regression coverage
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
            attachments: [{ type: 'audio', url: 'https://cdn.example.com/test.mp3', title: '', duration: 883920 }],
            audio: { original: '🟢 说话人1 [00:00:01]\n转写内容' },
          },
        }) as Response);
      }
      if (new URL(urlStr).hostname === 'cdn.example.com') {
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
      const engine = new SyncEngine(mockApp as any, makeSettings());
      const result = await engine.sync();

      expect(result.failed).toBe(0);
      expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_audio.mp3');
      expect(createdFiles).toContain('Get笔记/录音长录/asset/我的录音笔记_transcript.md');
      expect(createdFiles).toContain('Get笔记/录音长录/我的录音笔记.md');
      expect(createdFiles.join('\n')).toContain('created: 2026-04-30 12:45:24');
    } finally {
      vi.mocked(globalThis.fetch).mockRestore();
    }
  });
});

describe('SyncEngine — selective sync cancellation', () => {
  describe('SyncEngine — preCheckNote', () => {
    it('不存在 uidIndex 时返回 { exists: false }', () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({ note_id: 'note_missing' });
      // @ts-ignore
      const result = engine['preCheckNote'](note, new Map());
      expect(result.exists).toBe(false);
    });

    it('uid 命中但内容已修改时返回 { exists: false, file }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/纯文本/test.md',
        '---\nuid: "note_changed"\nmodified: "2026-04-27 10:00:00"\n---\n旧内容',
        { uid: 'note_changed', modified: '2026-04-27 10:00:00' }
      );
      app.vault._addFolder('Get笔记/纯文本');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'note_changed',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['note_changed', { path: 'Get笔记/纯文本/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(false);
      expect(result.file).toBeDefined();
    });

    it('uid 命中且内容未变时返回 { exists: true }（非音频笔记）', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/纯文本/test.md',
        '---\nuid: "note_unchanged"\nmodified: "2026-04-28 10:00:00"\n---\n正文',
        { uid: 'note_unchanged', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/纯文本');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'note_unchanged',
        note_type: 'plain_text',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['note_unchanged', { path: 'Get笔记/纯文本/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('音频笔记：附件齐全且内容未变时返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/录音长录/test.md',
        '---\nuid: "audio_ready"\nmodified: "2026-04-28 10:00:00"\n---\n音频笔记',
        { uid: 'audio_ready', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/录音长录');
      app.vault._addFolder('Get笔记/录音长录/asset');
      app.vault._addFile('Get笔记/录音长录/asset/测试笔记_audio.mp3', '');
      app.vault._addFile('Get笔记/录音长录/asset/测试笔记_transcript.md', '');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'audio_ready',
        title: '测试笔记',
        note_type: 'recorder_audio',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['audio_ready', { path: 'Get笔记/录音长录/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('音频笔记：缺少音频文件时返回 { exists: false }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/录音长录/test.md',
        '---\nuid: "audio_missing_mp3"\nmodified: "2026-04-28 10:00:00"\n---\n音频笔记',
        { uid: 'audio_missing_mp3', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/录音长录');
      app.vault._addFolder('Get笔记/录音长录/asset');
      app.vault._addFile('Get笔记/录音长录/asset/测试笔记_transcript.md', '');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'audio_missing_mp3',
        title: '测试笔记',
        note_type: 'recorder_audio',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['audio_missing_mp3', { path: 'Get笔记/录音长录/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(false);
    });

    it('音频笔记：缺少转写文件时返回 { exists: false }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/录音长录/test.md',
        '---\nuid: "audio_missing_transcript"\nmodified: "2026-04-28 10:00:00"\n---\n音频笔记',
        { uid: 'audio_missing_transcript', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/录音长录');
      app.vault._addFolder('Get笔记/录音长录/asset');
      app.vault._addFile('Get笔记/录音长录/asset/测试笔记_audio.mp3', '');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'audio_missing_transcript',
        title: '测试笔记',
        note_type: 'recorder_audio',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['audio_missing_transcript', { path: 'Get笔记/录音长录/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(false);
    });

    it('非音频笔记忽略附件检查直接通过', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/链接笔记/test.md',
        '---\nuid: "note_link"\nmodified: "2026-04-28 10:00:00"\n---\n链接笔记',
        { uid: 'note_link', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/链接笔记');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'note_link',
        note_type: 'link',
        updated_at: '2026-04-28T10:00:00+08:00',
      });
      const index = new Map([['note_link', { path: 'Get笔记/链接笔记/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('图片笔记：图片笔记目录下已存在非 png 图片附件时返回 { exists: true }', () => {
      const app = makeMockApp();
      app.vault._addFile(
        'Get笔记/图片笔记/test.md',
        '---\nuid: "image_ready"\nmodified: "2026-04-28 10:00:00"\n---\n图片笔记',
        { uid: 'image_ready', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/图片笔记');
      app.vault._addFolder('Get笔记/图片笔记/asset');
      app.vault._addFile('Get笔记/图片笔记/asset/测试笔记_image.jpg', '');
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'image_ready',
        title: '测试笔记',
        note_type: 'img_text',
        updated_at: '2026-04-28T10:00:00+08:00',
        attachments: [
          { type: 'image', url: 'https://cdn.example.com/path/photo.jpg', title: 'photo' },
        ],
      });
      const index = new Map([['image_ready', { path: 'Get笔记/图片笔记/test.md' }]]);
      // @ts-ignore
      const result = engine['preCheckNote'](note, index);
      expect(result.exists).toBe(true);
    });

    it('图片笔记：图片笔记目录下的非音频笔记也会下载多张图片附件', async () => {
      const app = makeMockApp();
      const engine = new SyncEngine(app as any, makeSettings());
      const note = makeNote({
        note_id: 'image_multi',
        title: '测试笔记',
        note_type: 'img_text',
        attachments: [
          { type: 'image', url: 'https://cdn.example.com/photo-a.jpg', title: 'photo-a' },
          { type: 'image', url: 'https://cdn.example.com/photo-b.jpg', title: 'photo-b' },
        ],
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({}) as Response);

      try {
        // @ts-ignore
        const enriched = await engine['enrichAudioNote'](note, new AbortController().signal);

        expect(enriched.assetPaths).toEqual([
          'Get笔记/图片笔记/asset/测试笔记_image.jpg',
          'Get笔记/图片笔记/asset/测试笔记_image_2.jpg',
        ]);
        expect(app.vault.getAbstractFileByPath('Get笔记/图片笔记/asset/测试笔记_image.jpg')).toBeTruthy();
        expect(app.vault.getAbstractFileByPath('Get笔记/图片笔记/asset/测试笔记_image_2.jpg')).toBeTruthy();
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
        'Get笔记/纯文本/已有笔记.md',
        '---\nuid: "pre_skip"\nmodified: "2026-04-28 10:00:00"\n---\n已有内容',
        { uid: 'pre_skip', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/纯文本');

      // Mock API 返回该笔记
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({
          data: { notes: [note], has_more: false, next_cursor: '' },
        }) as Response
      );

      try {
        const engine = new SyncEngine(app as any, makeSettings());
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
      app.vault._addFolder('Get笔记/纯文本');

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({
          data: { notes: [note], has_more: false, next_cursor: '' },
        }) as Response
      );

      try {
        const engine = new SyncEngine(app as any, makeSettings());
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
        'Get笔记/纯文本/已存在.md',
        '---\nuid: "existing"\nmodified: "2026-04-28 10:00:00"\n---\n已有',
        { uid: 'existing', modified: '2026-04-28 10:00:00' }
      );
      app.vault._addFolder('Get笔记/纯文本');

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse({
          data: { notes: [existing, newNote], has_more: false, next_cursor: '' },
        }) as Response
      );

      try {
        const engine = new SyncEngine(app as any, makeSettings());
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
    const engine = new SyncEngine(mockApp as any, makeSettings(), (info) => {
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

    const engine = new SyncEngine(makeMockApp() as any, makeSettings({
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

    const engine = new SyncEngine(makeMockApp() as any, makeSettings({
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
      mockFetchResponse({ data: { notes: [], has_more: false, next_cursor: '' } }) as Response
    );

    const engine = new SyncEngine(makeMockApp() as any, makeSettings({
      authMode: 'openapi',
      apiToken: 'active-web-token',
      clientId: 'legacy-client',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      webApiToken: 'web-token',
    }));

    await engine.syncNoteIds(['note-1']);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0',
      expect.any(Object)
    );
    expectLastFetchHeaders({
      Authorization: 'Bearer openapi-token',
      'X-Client-ID': 'openapi-client',
    });
  });

  it('syncNoteIds() uses Web credentials for selected-note sync', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { list: [], has_more: false } }) as Response
    );

    const engine = new SyncEngine(makeMockApp() as any, makeSettings({
      authMode: 'web',
      apiToken: 'active-openapi-token',
      clientId: 'openapi-client',
      openApiToken: 'openapi-token',
      openApiClientId: 'openapi-client',
      webApiToken: 'web-token',
    }));

    await engine.syncNoteIds(['note-1']);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=&sort=create_desc',
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
    const engine = new SyncEngine(app as any, makeSettings({
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
      'Get笔记/纯文本/OpenAPI 纯文本.md',
      'Get笔记/链接笔记/OpenAPI 链接.md',
      'Get笔记/纯文本/OpenAPI 第二页.md',
    ]));
    expect(getFixtureRequests().map(request => request.url)).toEqual([
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0',
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=open_link_2',
    ]);
  });

  it('OpenAPI: full sync writes only enabled note types', async () => {
    resetFixtures();
    loadScenario('sync-core-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
      'Get笔记/纯文本/OpenAPI 纯文本.md',
      'Get笔记/纯文本/OpenAPI 第二页.md',
    ]);
  });

  it('WebAPI: full sync writes paginated notes with web list query shape', async () => {
    resetFixtures();
    loadScenario('sync-core-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
      'Get笔记/纯文本/WebAPI 纯文本.md',
      'Get笔记/链接笔记/WebAPI 链接.md',
      'Get笔记/纯文本/WebAPI 第二页.md',
    ]));
    expect(getFixtureRequests().map(request => request.url)).toEqual([
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=&sort=create_desc',
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=web_link_2&sort=create_desc',
    ]);
  });

  it('WebAPI: full sync writes only enabled note types', async () => {
    resetFixtures();
    loadScenario('sync-core-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
      'Get笔记/纯文本/WebAPI 纯文本.md',
      'Get笔记/纯文本/WebAPI 第二页.md',
    ]);
  });

  it('WebAPI: selective sync writes only requested notes', async () => {
    resetFixtures();
    loadScenario('selective-sync-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
    expect(createdPaths).toEqual(['Get笔记/纯文本/WebAPI 被选择.md']);
  });

  it('OpenAPI: selective sync skips selected notes outside the enabled type filter', async () => {
    resetFixtures();
    loadScenario('selective-sync-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
      'https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0',
    ]);
  });

  it('WebAPI: selective sync skips selected notes outside the enabled type filter', async () => {
    resetFixtures();
    loadScenario('selective-sync-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
      'https://get-notes.luojilab.com/voicenotes/web/notes?limit=20&since_id=&sort=create_desc',
    ]);
  });

  it('OpenAPI: parent + child notes both created', async () => {
    resetFixtures();
    loadScenario('sync-parent-and-children-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记.md');
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记__附加笔记正文.md');
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记__第二条附加笔记正文.md');
    expect(getFixtureRequests().map(request => request.url)).not.toContain(
      'https://openapi.biji.com/open/api/v1/resource/note/detail?id=1909246675068292530'
    );
    const childContent = vi.mocked(app.vault.create).mock.calls.find(([path]) =>
      path === 'Get笔记/纯文本/主笔记__附加笔记正文.md'
    )?.[1] as string;
    expect(childContent).toContain('parent_id: "1909193892067130512"');
    expect(childContent).toContain('is_child_note: true');
  });

  it('OpenAPI: detail child relation overrides stale list child IDs', async () => {
    resetFixtures();
    loadScenario('sync-stale-children-openapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
    const engine = new SyncEngine(app as any, makeSettings({
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
      path === 'Get笔记/录音长录/WebAPI 录音主笔记.md'
    )?.[1] as string;
    expect(parentContent).toContain('children_ids: ["1909246675068292528"]');
    expect(parentContent).not.toContain('1909246675068292530');
  });

  it('WebAPI: parent + child notes both created', async () => {
    resetFixtures();
    loadScenario('sync-parent-and-children-webapi');

    const app = makeMockApp();
    const engine = new SyncEngine(app as any, makeSettings({
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
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记.md');
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记__附加笔记正文.md');
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记__第二条附加笔记正文.md');
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
    const engine = new SyncEngine(app as any, makeSettings({
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
    const engine = new SyncEngine(app as any, makeSettings({
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
    const engine = new SyncEngine(app as any, makeSettings({
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
    const engine = new SyncEngine(app as any, makeSettings({
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
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记.md');
    expect(createdPaths).toContain('Get笔记/纯文本/主笔记__附加笔记正文.md');
  });
});
