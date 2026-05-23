import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadScenario, registerFixture, resetFixtures } from './loader';

// Minimal mock fetch that the loader controls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('fixture loader', () => {
  beforeEach(() => {
    resetFixtures();
    mockFetch.mockReset();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('resetFixtures', () => {
    it('clears all registered fixtures and restores real fetch', async () => {
      registerFixture({
        url: 'https://example.com/test',
        method: 'GET',
        response: { body: { ok: true } },
      });
      resetFixtures();
      // After reset, fetch should not be mocked
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('registerFixture', () => {
    it('matches URL pattern and returns configured response', async () => {
      registerFixture({
        url: 'https://api.example.com/notes',
        method: 'GET',
        response: { status: 200, body: { notes: [{ note_id: '123' }] } },
      });

      const response = await fetch('https://api.example.com/notes');
      const data = await response.json();

      expect(data).toEqual({ notes: [{ note_id: '123' }] });
    });

    it('matches URL with query params', async () => {
      registerFixture({
        url: 'https://api.example.com/notes/detail',
        query: { id: '456' },
        method: 'GET',
        response: { status: 200, body: { note_id: '456', title: 'Test' } },
      });

      const response = await fetch('https://api.example.com/notes/detail?id=456');
      const data = await response.json();

      expect(data).toEqual({ note_id: '456', title: 'Test' });
    });

    it('matches POST requests', async () => {
      registerFixture({
        url: 'https://api.example.com/notes',
        method: 'POST',
        response: { status: 200, body: { success: true } },
      });

      const response = await fetch('https://api.example.com/notes', {
        method: 'POST',
      });
      const data = await response.json();

      expect(data).toEqual({ success: true });
    });

    it('returns configured status code', async () => {
      registerFixture({
        url: 'https://api.example.com/error',
        method: 'GET',
        response: { status: 500, body: { error: 'ServerError' } },
      });

      const response = await fetch('https://api.example.com/error');

      expect(response.status).toBe(500);
    });

    it('consumes matched fixtures so repeated URLs can return sequential responses', async () => {
      registerFixture({
        url: 'https://api.example.com/retry',
        method: 'GET',
        response: { status: 500, body: { error: 'temporary' } },
      });
      registerFixture({
        url: 'https://api.example.com/retry',
        method: 'GET',
        response: { status: 200, body: { ok: true } },
      });

      const firstResponse = await fetch('https://api.example.com/retry');
      const secondResponse = await fetch('https://api.example.com/retry');

      expect(firstResponse.status).toBe(500);
      await expect(firstResponse.json()).resolves.toEqual({ error: 'temporary' });
      expect(secondResponse.status).toBe(200);
      await expect(secondResponse.json()).resolves.toEqual({ ok: true });
      await expect(fetch('https://api.example.com/retry')).rejects.toThrow();
    });

    it('throws for unmatched URL when no fallback', async () => {
      resetFixtures(); // ensure no fixtures
      await expect(fetch('https://unmatched.example.com/test')).rejects.toThrow();
    });
  });

  describe('loadScenario', () => {
    it('loads JSON scenario file and registers URL-matched responses', async () => {
      // Load the scenario - the loader reads JSON and registers responses
      loadScenario('sync-parent-and-children-openapi');

      const listResponse = await fetch('https://openapi.biji.com/open/api/v1/resource/note/list?since_id=0');
      const listData = await listResponse.json();
      expect(listData).toHaveProperty('data');
      expect(Array.isArray(listData.data?.notes)).toBe(true);
    });

    it('matches detail responses by URL rather than call order', async () => {
      loadScenario('sync-parent-and-children-openapi');

      const detailResp = await fetch('https://openapi.biji.com/open/api/v1/resource/note/detail?id=1909193892067130512');
      const detailData = await detailResp.json();
      expect(detailData).toHaveProperty('data');
    });

    it('throws error when scenario file not found', () => {
      expect(() => loadScenario('non-existent-scenario')).toThrow();
    });
  });

  describe('authMode routing', () => {
    it('registers OpenAPI base URLs when authMode is openapi', async () => {
      registerFixture({
        url: 'https://openapi.biji.com/open/api/v1/resource/note/list',
        method: 'GET',
        authMode: 'openapi',
        response: { status: 200, body: { data: { notes: [], has_more: false } } },
      });

      const response = await fetch('https://openapi.biji.com/open/api/v1/resource/note/list');
      const data = await response.json();
      expect(data).toEqual({ data: { notes: [], has_more: false } });
    });

    it('registers WebAPI base URLs when authMode is web', async () => {
      registerFixture({
        url: 'https://get-notes.luojilab.com/voicenotes/web/notes',
        method: 'GET',
        authMode: 'web',
        response: { status: 200, body: { h: {}, c: { list: [], has_more: false } } },
      });

      const response = await fetch('https://get-notes.luojilab.com/voicenotes/web/notes');
      const data = await response.json();
      expect(data).toEqual({ h: {}, c: { list: [], has_more: false } });
    });
  });
});
