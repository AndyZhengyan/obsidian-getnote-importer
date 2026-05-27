import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReverseSyncEngine } from '../src/reverse-sync';
import type { Settings } from '../src/types';

function makeMockApp() {
  const files = new Map<string, { path: string; content: string; frontmatter: Record<string, unknown> }>();

  const parseFrontmatter = (content: string): Record<string, unknown> => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return {};
    const result: Record<string, unknown> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const [key, ...rest] = line.split(':');
      if (!key || rest.length === 0) continue;
      const raw = rest.join(':').trim().replace(/^"|"$/g, '');
      result[key.trim()] = /^\d+$/.test(raw) ? Number(raw) : raw;
    }
    return result;
  };

  return {
    vault: {
      getMarkdownFiles: () => [...files.values()].map((f) => ({ path: f.path })),
      read: vi.fn(async (file: { path: string }) => files.get(file.path)?.content ?? ''),
      modify: vi.fn(async (file: { path: string }, content: string) => {
        const existing = files.get(file.path);
        if (existing) {
          files.set(file.path, { ...existing, content, frontmatter: parseFrontmatter(content) });
        }
      }),
      _addFile: (path: string, content: string) => {
        files.set(path, { path, content, frontmatter: parseFrontmatter(content) });
      },
      _setContentOnly: (path: string, content: string) => {
        const existing = files.get(path);
        if (existing) files.set(path, { ...existing, content });
      },
      _setFrontmatter: (path: string, frontmatter: Record<string, unknown>) => {
        const existing = files.get(path);
        if (existing) files.set(path, { ...existing, frontmatter });
      },
      _getFile: (path: string) => files.get(path),
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => {
        const existing = files.get(file.path);
        return existing ? { frontmatter: existing.frontmatter } : null;
      },
    },
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    authMode: 'openapi',
    openApiToken: 'test-token',
    openApiClientId: 'test-client',
    webApiToken: '',
    apiToken: '',
    clientId: '',
    webCsrfToken: '',
    folderName: 'Get笔记',
    filenamePrefix: '',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
    syncHistory: [],
    ...overrides,
  };
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReverseSyncEngine', () => {
  it('ignores markdown files outside the configured GetNote folder', async () => {
    const app = makeMockApp();
    app.vault._addFile('Inbox/local.md', [
      '---',
      'title: "Outside"',
      '---',
      'Outside body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note_id: 'should-not-create' } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual({ created: 0, skipped: 0, failed: 0, total: 0, items: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not treat a root note named like the configured folder as inside that folder', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记.md', [
      '---',
      'title: "Folder index"',
      '---',
      'Folder index body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note_id: 'should-not-create' } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual({ created: 0, skipped: 0, failed: 0, total: 0, items: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('creates a local-only markdown note and writes the returned uid back to frontmatter', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/local.md', [
      '---',
      'title: "Local title"',
      'note_type: plain_text',
      '---',
      'Local body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: '1909999999999999999' } } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 0, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: '1909999999999999999',
        title: 'Local title',
        noteType: 'plain_text',
        status: 'created',
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'Local title',
          content: 'Local body',
          note_type: 'plain_text',
          source: 'app',
          tags: [],
        }),
      })
    );
    expect(app.vault._getFile('Get笔记/local.md')?.content).toBe([
      '---',
      'uid: "1909999999999999999"',
      'title: "Local title"',
      'note_type: plain_text',
      '---',
      'Local body',
    ].join('\n'));
  });

  it('skips notes whose uid still exists remotely', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/imported.md', [
      '---',
      'uid: "remote-1"',
      'title: "Imported"',
      'note_type: plain_text',
      '---',
      'Imported body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'remote-1', title: 'Imported' } } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: 'remote-1',
        title: 'Imported',
        noteType: 'plain_text',
        status: 'skipped',
        error: '远端已存在，跳过上传',
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('reads numeric uid values before deciding whether to create a remote note', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/numeric.md', [
      '---',
      'uid: 1909999999999999999',
      'title: "Numeric uid"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: '1909999999999999999' } } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('resource/note/detail'),
      expect.anything()
    );
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('parses uid from current file contents when metadata cache is stale', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/stale-cache.md', [
      '---',
      'uid: "remote-from-content"',
      'title: "Fresh content"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    app.vault._setFrontmatter('Get笔记/stale-cache.md', {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'remote-from-content' } } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('creates a replacement note when a local uid no longer exists remotely and rewrites uid only', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/missing.md', [
      '---',
      'uid: "missing-remote"',
      'title: "Missing remote"',
      'note_type: plain_text',
      '---',
      'Keep this body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockFetchResponse({ success: false, error: { message: '笔记不存在' } }))
      .mockResolvedValueOnce(mockFetchResponse({ success: true, data: { note_id: 'replacement-remote' } }));

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 0, total: 1 }));
    expect(app.vault._getFile('Get笔记/missing.md')?.content).toContain('uid: "replacement-remote"');
    expect(app.vault._getFile('Get笔记/missing.md')?.content).toContain('Keep this body');
  });

  it('creates a local-only markdown note through Web API mode', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/local.md', [
      '---',
      'title: "Local title"',
      '---',
      '19',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { note_id: '1911000000000000000', prime_id: 'prime-created' } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    })).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.items[0]).toEqual(expect.objectContaining({ noteId: '1911000000000000000' }));
    expect(app.vault._getFile('Get笔记/local.md')?.content).toContain('uid: "1911000000000000000"');
    expect(app.vault._getFile('Get笔记/local.md')?.content).toContain('prime_id: "prime-created"');
  });

  it('uses Web prime_id for remote existence checks when it is available', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/web-imported.md', [
      '---',
      'uid: "1911000000000000000"',
      'prime_id: "prime-existing"',
      'title: "Web imported"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { note_id: '1911000000000000000', prime_id: 'prime-existing' } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    })).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes/prime-existing',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('skips Web notes with uid but no prime_id instead of creating possible duplicates', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/web-without-prime.md', [
      '---',
      'uid: "1911000000000000000"',
      'title: "Old Web import"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { note_id: 'should-not-be-called' } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    })).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(result.items[0]).toEqual(expect.objectContaining({
      status: 'skipped',
      error: '缺少 Web 详情 ID，跳过上传以避免重复创建',
    }));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('handles CRLF frontmatter without uploading YAML as body or duplicating frontmatter', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/crlf.md', '---\r\ntitle: "CRLF"\r\nnote_type: plain_text\r\n---\r\nBody\r\n');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'crlf-created' } } })
    );

    await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: JSON.stringify({
          title: 'CRLF',
          content: 'Body\r\n',
          note_type: 'plain_text',
          source: 'app',
          tags: [],
        }),
      })
    );
    expect(app.vault._getFile('Get笔记/crlf.md')?.content.match(/^---/g)?.length).toBe(1);
    expect(app.vault._getFile('Get笔记/crlf.md')?.content).toContain('uid: "crlf-created"');
  });

  it('does not treat a leading markdown divider block as frontmatter', async () => {
    const app = makeMockApp();
    const content = [
      '---',
      '# Not YAML',
      '---',
      'Body',
    ].join('\n');
    app.vault._addFile('Get笔记/divider.md', content);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'divider-created' } } })
    );

    await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: expect.stringContaining('"content":"---\\n# Not YAML\\n---\\nBody"'),
      })
    );
    expect(app.vault._getFile('Get笔记/divider.md')?.content).toBe([
      '---',
      'uid: "divider-created"',
      '---',
      content,
    ].join('\n'));
  });

  it('re-reads the local file before writing the returned uid', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/editing.md', [
      '---',
      'title: "Editing"',
      'note_type: plain_text',
      '---',
      'Initial body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      app.vault._setContentOnly('Get笔记/editing.md', [
        '---',
        'title: "Editing"',
        'note_type: plain_text',
        '---',
        'User edit while uploading',
      ].join('\n'));
      return mockFetchResponse({ success: true, data: { note: { note_id: 'editing-created' } } });
    });

    await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(app.vault._getFile('Get笔记/editing.md')?.content).toContain('uid: "editing-created"');
    expect(app.vault._getFile('Get笔记/editing.md')?.content).toContain('User edit while uploading');
    expect(app.vault._getFile('Get笔记/editing.md')?.content).not.toContain('Initial body');
  });

  it('uploads only the markdown files explicitly selected by the user', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/a.md', [
      '---',
      'title: "A"',
      '---',
      'Body A',
    ].join('\n'));
    app.vault._addFile('Get笔记/b.md', [
      '---',
      'title: "B"',
      '---',
      'Body B',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'selected-created' } } })
    );

    const selectedFile = app.vault.getMarkdownFiles().find(file => file.path === 'Get笔记/b.md');
    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncFiles(selectedFile ? [selectedFile as any] : []);

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 0, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: 'selected-created',
        title: 'B',
        noteType: 'plain_text',
        status: 'created',
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: expect.stringContaining('"title":"B"'),
      })
    );
    expect(app.vault._getFile('Get笔记/a.md')?.content).not.toContain('selected-created');
    expect(app.vault._getFile('Get笔记/b.md')?.content).toContain('uid: "selected-created"');
  });

  it('counts selected markdown files that cannot be uploaded as skipped', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/empty.md', [
      '---',
      'title: "Empty"',
      'note_type: plain_text',
      '---',
      '',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'should-not-create' } } })
    );

    const selectedFile = app.vault.getMarkdownFiles().find(file => file.path === 'Get笔记/empty.md');
    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncFiles(selectedFile ? [selectedFile as any] : []);

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: 'Get笔记/empty.md',
        title: 'Empty',
        noteType: 'plain_text',
        status: 'skipped',
        error: '正文为空，跳过上传',
      }),
    ]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('records upload failure details with the failing note and reason', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/fail.md', [
      '---',
      'title: "Failing upload"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ error: { message: 'server down' } }, 500)
    );

    const selectedFile = app.vault.getMarkdownFiles().find(file => file.path === 'Get笔记/fail.md');
    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncFiles(selectedFile ? [selectedFile as any] : []);

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 0, failed: 1, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: 'Get笔记/fail.md',
        title: 'Failing upload',
        noteType: 'plain_text',
        status: 'failed',
        error: 'API 服务器错误 500',
      }),
    ]);
  });

  it('records one unreadable selected file as failed and continues the batch', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/deleted.md', [
      '---',
      'title: "Deleted"',
      '---',
      'Body',
    ].join('\n'));
    app.vault._addFile('Get笔记/ok.md', [
      '---',
      'title: "OK"',
      '---',
      'Body',
    ].join('\n'));
    vi.mocked(app.vault.read).mockImplementation(async (file: { path: string }) => {
      if (file.path === 'Get笔记/deleted.md') throw new Error('file missing');
      return app.vault._getFile(file.path)?.content ?? '';
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'ok-created' } } })
    );

    const result = await new ReverseSyncEngine(app as any, makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 1, total: 2 }));
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ noteId: 'Get笔记/deleted.md', status: 'failed', error: 'file missing' }),
      expect.objectContaining({ noteId: 'ok-created', status: 'created' }),
    ]));
  });
});
