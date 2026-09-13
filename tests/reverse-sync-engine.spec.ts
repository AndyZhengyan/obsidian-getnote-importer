import { describe, it, expect, vi, afterEach } from 'vitest';
import type { App, TFile } from 'obsidian';
import { ReverseSyncEngine } from '../src/reverse-sync';
import type { Settings } from '../src/types';

vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(),
  parseYaml: (text: string) => Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes(':')).map(line => {
    const index = line.indexOf(':');
    const value = line.slice(index + 1).trim();
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* plain YAML scalar */ }
    return [line.slice(0, index), parsed];
  })),
}));

function makeMockApp() {
  const files = new Map<string, { path: string; basename: string; content: string; frontmatter: Record<string, unknown> }>();
  const folders = new Set<string>();

  const parseYamlScalar = (value: string): unknown => {
    const trimmed = value.trim();
    const quoted = trimmed.match(/^(['"])(.*)\1$/s);
    if (quoted) return quoted[2];
    if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  };

  const parseFrontmatter = (content: string): Record<string, unknown> => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return {};
    const result: Record<string, unknown> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const [key, ...rest] = line.split(':');
      if (!key || rest.length === 0) continue;
      result[key.trim()] = parseYamlScalar(rest.join(':'));
    }
    return result;
  };

  return {
    vault: {
      getMarkdownFiles: () => [...files.values()],
      getAbstractFileByPath: (path: string) => files.get(path) ?? (folders.has(path) ? { path } : null),
      createFolder: vi.fn(async (path: string) => { folders.add(path); }),
      process: vi.fn(async (file: { path: string }, fn: (raw: string) => string) => {
        const existing = files.get(file.path);
        if (!existing) throw new Error('file missing');
        existing.content = fn(existing.content);
        existing.frontmatter = parseFrontmatter(existing.content);
        return existing.content;
      }),
      read: vi.fn(async (file: { path: string }) => files.get(file.path)?.content ?? ''),
      modify: vi.fn(async (file: { path: string }, content: string) => {
        const existing = files.get(file.path);
        if (existing) {
          Object.assign(existing, { content, frontmatter: parseFrontmatter(content) });
        }
      }),
      _addFile: (path: string, content: string) => {
        files.set(path, { path, basename: path.split('/').pop()!.replace(/\.md$/, ''), content, frontmatter: parseFrontmatter(content) });
      },
      _setContentOnly: (path: string, content: string) => {
        const existing = files.get(path);
        if (existing) existing.content = content;
      },
      _setFrontmatter: (path: string, frontmatter: Record<string, unknown>) => {
        const existing = files.get(path);
        if (existing) files.set(path, { ...existing, frontmatter });
      },
      _getFile: (path: string) => files.get(path),
    },
    fileManager: {
      renameFile: vi.fn(async (file: { path: string; basename: string }, path: string) => {
        const existing = files.get(file.path);
        if (!existing || files.has(path)) throw new Error('invalid rename');
        files.delete(file.path);
        file.path = path;
        file.basename = path.split('/').pop()!.replace(/\.md$/, '');
        files.set(path, existing);
      }),
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
    folderName: '得到大脑',
    filenamePrefix: '',
    templateFilePath: '',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
    syncHistory: [],
    ...overrides,
  };
}

function toObsidianApp(app: ReturnType<typeof makeMockApp>): App {
  return app as unknown as App;
}

function toTFile(file: { path: string }): TFile {
  return file as unknown as TFile;
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
  it('retries a failed manual archive without creating another remote identity', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/retry.md', 'Body');
    app.fileManager.renameFile.mockRejectedValueOnce(new Error('rename failed'));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'archive-id' } } })
    );
    const first = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();
    expect(first.failed).toBe(1);
    expect(app.vault._getFile('得到大脑/retry.md')?.content).toContain('uid: "archive-id"');
    const second = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();
    expect(second.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(app.vault._getFile('得到大脑/retry.md')).toBeUndefined();
    expect(app.vault._getFile('得到大脑/纯文本/retry.md')?.content).toContain('dedao_upload_state: "complete"');
    const third = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();
    expect(third.skipped).toBe(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('keeps explicit uploads outside the sync folder at their original path', async () => {
    const app = makeMockApp();
    app.vault._addFile('Personal/upload.md', 'Outside body');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'outside-id' } } })
    );
    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncFiles(app.vault.getMarkdownFiles().map(toTFile));
    expect(result.created).toBe(1);
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(app.vault._getFile('Personal/upload.md')?.content).toContain('uid: "outside-id"');
  });

  it('cancels manual creation and prevents repeating an uncertain create request', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/cancel.md', 'Cancel body');
    const engine = new ReverseSyncEngine(toObsidianApp(app), makeSettings());
    let sentSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentSignal = init?.signal;
      engine.cancel();
      return mockFetchResponse({ success: true, data: { note: { note_id: 'cancel-id' } } });
    });
    await expect(engine.syncBack()).rejects.toMatchObject({ name: 'AbortError' });
    expect(sentSignal?.aborted).toBe(true);
    expect(app.vault._getFile('得到大脑/cancel.md')?.content).toContain('dedao_upload_state: "pending"');
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    const retry = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();
    expect(retry.failed).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('creates a remote note from only the marked source body', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/marked.md', [
      '---',
      'title: "Marked"',
      'note_type: plain_text',
      '---',
      'local template text',
      '<!-- dedao-brain-sync:source-body:start -->',
      'remote source',
      '<!-- dedao-brain-sync:source-body:end -->',
      '> 📎 local attachment',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'created-marked' } } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, failed: 0 }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({ body: expect.stringContaining('"content":"remote source"') })
    );
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining('local attachment') })
    );
  });

  it('skips a malformed marked file without sending a create request', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/broken.md', [
      '---',
      'title: "Broken"',
      'note_type: plain_text',
      '---',
      '<!-- dedao-brain-sync:source-body:start -->',
      'remote source',
    ].join('\n'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0 }));
    expect(result.items[0]?.error).toMatch(/source-body/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores markdown files outside the configured Dedao Brain folder', async () => {
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

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual({ created: 0, skipped: 0, failed: 0, total: 0, items: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not treat a root note named like the configured folder as inside that folder', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑.md', [
      '---',
      'title: "Folder index"',
      '---',
      'Folder index body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note_id: 'should-not-create' } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual({ created: 0, skipped: 0, failed: 0, total: 0, items: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('creates a local-only markdown note and writes the returned uid back to frontmatter', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/local.md', [
      '---',
      'title: "Local title"',
      'note_type: plain_text',
      '---',
      'Local body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: '1909999999999999999' } } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

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
    expect(app.vault._getFile('得到大脑/local.md')).toBeUndefined();
    const archived = app.vault._getFile('得到大脑/纯文本/Local title.md')?.content;
    expect(archived).toContain('uid: "1909999999999999999"');
    expect(archived).toContain('dedao_upload_state: "complete"');
    expect(archived).toContain('dedao_bidirectional_hash:');
    expect(archived).toContain('Local body');
  });

  it('limits uploaded tags to the OpenAPI create-note maximum', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/many-tags.md', [
      '---',
      'title: "Many tags"',
      'note_type: plain_text',
      'tags: ["one", "two", "three", "four", "five", "six"]',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'many-tags-created' } } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: JSON.stringify({
          title: 'Many tags',
          content: 'Body',
          note_type: 'plain_text',
          source: 'app',
          tags: ['one', 'two', 'three', 'four'],
        }),
      })
    );
  });

  it('uploads Markdown image embeds as plain links so create-note does not reject third-party images', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/with-image.md', [
      '---',
      'title: "With image"',
      'note_type: plain_text',
      '---',
      'Before',
      '![](asset/local image.png)',
      '![diagram](https://cdn.example.com/diagram.png)',
      'After',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'with-image-created' } } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: JSON.stringify({
          title: 'With image',
          content: [
            'Before',
            '[asset/local image.png](asset/local image.png)',
            '[diagram](https://cdn.example.com/diagram.png)',
            'After',
          ].join('\n'),
          note_type: 'plain_text',
          source: 'app',
          tags: [],
        }),
      })
    );
  });

  it('applies upload-safe tags and image links in Web API mode too', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/web-safe.md', [
      '---',
      'title: "Web safe"',
      'note_type: plain_text',
      'tags: ["one", "two", "three", "four", "five"]',
      '---',
      'Before',
      '![chart](https://cdn.example.com/chart.png)',
      'After',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { note_id: 'web-safe-created', prime_id: 'web-safe-prime' } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    })).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes',
      expect.objectContaining({
        method: 'POST',
      })
    );
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload).toEqual(expect.objectContaining({
      title: 'Web safe',
      note_type: 'plain_text',
      tags: ['one', 'two', 'three', 'four'],
    }));
    expect(payload.content).toContain('[chart](https://cdn.example.com/chart.png)');
    expect(payload.content).not.toContain('![chart]');
  });

  it('skips notes whose uid still exists remotely', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/imported.md', [
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

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

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

  it('preserves numeric uid values before deciding whether to create a remote note', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/numeric.md', [
      '---',
      'uid: 1909999999999999999',
      'title: "Numeric uid"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    const metadataUid = app.vault._getFile('得到大脑/numeric.md')?.frontmatter.uid;
    expect(typeof metadataUid).toBe('number');
    expect(String(metadataUid)).not.toBe('1909999999999999999');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: '1909999999999999999' } } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('id=1909999999999999999'),
      expect.anything()
    );
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('normalizes single-quoted uid values before checking the remote note', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/single-quoted.md', [
      '---',
      "uid: 'remote-single'",
      'title: "Single quoted uid"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'remote-single' } } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('id=remote-single'),
      expect.anything()
    );
  });

  it('parses uid from current file contents when metadata cache is stale', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/stale-cache.md', [
      '---',
      'uid: "remote-from-content"',
      'title: "Fresh content"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    app.vault._setFrontmatter('得到大脑/stale-cache.md', {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'remote-from-content' } } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(app.vault.modify).not.toHaveBeenCalled();
  });

  it('preserves an associated note when its remote uid is missing', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/missing.md', [
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

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(app.vault._getFile('得到大脑/missing.md')?.content).toContain('uid: "missing-remote"');
    expect(app.vault._getFile('得到大脑/missing.md')?.content).toContain('Keep this body');
  });

  it('creates a local-only markdown note through Web API mode', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/local.md', [
      '---',
      'title: "Local title"',
      '---',
      '19',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ h: {}, c: { note_id: '1911000000000000000', prime_id: 'prime-created' } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    })).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 0, total: 1 }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://get-notes.luojilab.com/voicenotes/web/notes',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.items[0]).toEqual(expect.objectContaining({ noteId: '1911000000000000000' }));
    expect(app.vault._getFile('得到大脑/local.md')?.content).toContain('uid: "1911000000000000000"');
    expect(app.vault._getFile('得到大脑/local.md')?.content).toContain('prime_id: "prime-created"');
  });

  it('uses Web prime_id for remote existence checks when it is available', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/web-imported.md', [
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

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings({
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
    app.vault._addFile('得到大脑/web-without-prime.md', [
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

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings({
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
    app.vault._addFile('得到大脑/crlf.md', '---\r\ntitle: "CRLF"\r\nnote_type: plain_text\r\n---\r\nBody\r\n');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'crlf-created' } } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

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
    expect(app.vault._getFile('得到大脑/纯文本/CRLF.md')?.content.match(/^---/g)?.length).toBe(1);
    expect(app.vault._getFile('得到大脑/纯文本/CRLF.md')?.content).toContain('uid: "crlf-created"');
  });

  it('keeps valid fields when a closed frontmatter block contains malformed lines', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/partial-frontmatter.md', [
      '---',
      'title: "Partial frontmatter"',
      'this line is not valid yaml',
      'note_type: plain_text',
      '---',
      'Body survives',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'partial-created' } } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: JSON.stringify({
          title: 'Partial frontmatter',
          content: 'Body survives',
          note_type: 'plain_text',
          source: 'app',
          tags: [],
        }),
      })
    );
    expect(app.vault._getFile('得到大脑/纯文本/Partial frontmatter.md')?.content.match(/^---/g)?.length).toBe(1);
    expect(app.vault._getFile('得到大脑/纯文本/Partial frontmatter.md')?.content).toContain('uid: "partial-created"');
  });

  it('ignores malformed object-shaped tags while keeping the note uploadable', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/object-tags.md', [
      '---',
      'title: "Object tags"',
      'note_type: plain_text',
      'tags: {"unexpected":"shape"}',
      '---',
      'Body survives',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'object-tags-created' } } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: JSON.stringify({
          title: 'Object tags',
          content: 'Body survives',
          note_type: 'plain_text',
          source: 'app',
          tags: [],
        }),
      })
    );
  });

  it('does not treat a leading markdown divider block as frontmatter', async () => {
    const app = makeMockApp();
    const content = [
      '---',
      '# Not YAML',
      '---',
      'Body',
    ].join('\n');
    app.vault._addFile('得到大脑/divider.md', content);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'divider-created' } } })
    );

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openapi.biji.com/open/api/v1/resource/note/save',
      expect.objectContaining({
        body: expect.stringContaining('"content":"---\\n# Not YAML\\n---\\nBody"'),
      })
    );
    expect(app.vault._getFile('得到大脑/纯文本/divider.md')?.content).toContain('uid: "divider-created"');
    expect(app.vault._getFile('得到大脑/纯文本/divider.md')?.content).toContain(content);
  });

  it('re-reads the local file before writing the returned uid', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/editing.md', [
      '---',
      'title: "Editing"',
      'note_type: plain_text',
      '---',
      'Initial body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      app.vault._setContentOnly('得到大脑/editing.md', [
        '---',
        'title: "Editing"',
        'note_type: plain_text',
        '---',
        'User edit while uploading',
      ].join('\n'));
      return mockFetchResponse({ success: true, data: { note: { note_id: 'editing-created' } } });
    });

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(app.vault._getFile('得到大脑/纯文本/Editing.md')?.content).toContain('uid: "editing-created"');
    expect(app.vault._getFile('得到大脑/纯文本/Editing.md')?.content).toContain('User edit while uploading');
    expect(app.vault._getFile('得到大脑/纯文本/Editing.md')?.content).not.toContain('Initial body');
  });

  it('uploads only the markdown files explicitly selected by the user', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/a.md', [
      '---',
      'title: "A"',
      '---',
      'Body A',
    ].join('\n'));
    app.vault._addFile('得到大脑/b.md', [
      '---',
      'title: "B"',
      '---',
      'Body B',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'selected-created' } } })
    );

    const selectedFile = app.vault.getMarkdownFiles().find(file => file.path === '得到大脑/b.md');
    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncFiles(selectedFile ? [toTFile(selectedFile)] : []);

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
    expect(app.vault._getFile('得到大脑/a.md')?.content).not.toContain('selected-created');
    expect(app.vault._getFile('得到大脑/纯文本/B.md')?.content).toContain('uid: "selected-created"');
  });

  it('reports progress after each selected local file is processed', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/a.md', [
      '---',
      'title: "A"',
      '---',
      'Body A',
    ].join('\n'));
    app.vault._addFile('得到大脑/b.md', [
      '---',
      'title: "B"',
      '---',
      'Body B',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'created' } } })
    );
    const progress = vi.fn();
    const selectedFiles = app.vault.getMarkdownFiles();

    await new ReverseSyncEngine(toObsidianApp(app), makeSettings(), progress).syncFiles(selectedFiles.map(toTFile));

    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenNthCalledWith(1, expect.objectContaining({
      processed: 1,
      total: 2,
      title: 'A',
      status: 'created',
    }));
    expect(progress).toHaveBeenNthCalledWith(2, expect.objectContaining({
      processed: 2,
      total: 2,
      title: 'B',
      status: 'created',
    }));
  });

  it('counts selected markdown files that cannot be uploaded as skipped', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/empty.md', [
      '---',
      'title: "Empty"',
      'note_type: plain_text',
      '---',
      '',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'should-not-create' } } })
    );

    const selectedFile = app.vault.getMarkdownFiles().find(file => file.path === '得到大脑/empty.md');
    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncFiles(selectedFile ? [toTFile(selectedFile)] : []);

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 1, failed: 0, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: '得到大脑/empty.md',
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
    app.vault._addFile('得到大脑/fail.md', [
      '---',
      'title: "Failing upload"',
      'note_type: plain_text',
      '---',
      'Body',
    ].join('\n'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ error: { message: 'server down' } }, 500)
    );

    const selectedFile = app.vault.getMarkdownFiles().find(file => file.path === '得到大脑/fail.md');
    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncFiles(selectedFile ? [toTFile(selectedFile)] : []);

    expect(result).toEqual(expect.objectContaining({ created: 0, skipped: 0, failed: 1, total: 1 }));
    expect(result.items).toEqual([
      expect.objectContaining({
        noteId: '得到大脑/fail.md',
        title: 'Failing upload',
        noteType: 'plain_text',
        status: 'failed',
        error: 'API 服务器错误 500',
      }),
    ]);
  });

  it('records one unreadable selected file as failed and continues the batch', async () => {
    const app = makeMockApp();
    app.vault._addFile('得到大脑/deleted.md', [
      '---',
      'title: "Deleted"',
      '---',
      'Body',
    ].join('\n'));
    app.vault._addFile('得到大脑/ok.md', [
      '---',
      'title: "OK"',
      '---',
      'Body',
    ].join('\n'));
    vi.mocked(app.vault.read).mockImplementation(async (file: { path: string }) => {
      if (file.path === '得到大脑/deleted.md') throw new Error('file missing');
      return app.vault._getFile(file.path)?.content ?? '';
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ success: true, data: { note: { note_id: 'ok-created' } } })
    );

    const result = await new ReverseSyncEngine(toObsidianApp(app), makeSettings()).syncBack();

    expect(result).toEqual(expect.objectContaining({ created: 1, skipped: 0, failed: 1, total: 2 }));
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ noteId: '得到大脑/deleted.md', status: 'failed', error: 'file missing' }),
      expect.objectContaining({ noteId: 'ok-created', status: 'created' }),
    ]));
  });
});
