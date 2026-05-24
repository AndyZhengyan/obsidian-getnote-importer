import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReverseSyncEngine } from '../src/reverse-sync';
import type { Settings } from '../src/types';

function makeMockApp() {
  const files = new Map<string, { path: string; content: string; frontmatter: Record<string, unknown> }>();

  const parseFrontmatter = (content: string): Record<string, unknown> => {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return {};
    const result: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
      const [key, ...rest] = line.split(':');
      if (!key || rest.length === 0) continue;
      result[key.trim()] = rest.join(':').trim().replace(/^"|"$/g, '');
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

    expect(result).toEqual({ created: 0, skipped: 0, failed: 0, total: 0 });
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

    expect(result).toEqual({ created: 1, skipped: 0, failed: 0, total: 1 });
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

    expect(result).toEqual({ created: 0, skipped: 1, failed: 0, total: 1 });
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

    expect(result).toEqual({ created: 1, skipped: 0, failed: 0, total: 1 });
    expect(app.vault._getFile('Get笔记/missing.md')?.content).toContain('uid: "replacement-remote"');
    expect(app.vault._getFile('Get笔记/missing.md')?.content).toContain('Keep this body');
  });

  it('requires OpenAPI credentials because Web API writes are not supported', async () => {
    const app = makeMockApp();
    app.vault._addFile('Get笔记/local.md', [
      '---',
      'title: "Local title"',
      '---',
      'Local body',
    ].join('\n'));

    await expect(new ReverseSyncEngine(app as any, makeSettings({
      authMode: 'web',
      webApiToken: 'web-token',
    })).syncBack()).rejects.toThrow('OpenAPI');
  });
});
