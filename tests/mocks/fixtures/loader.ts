import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export interface FixtureResponse {
  status?: number;
  body: unknown;
}

export interface Fixture {
  url: string;
  query?: Record<string, string>;
  method?: string;
  authMode?: 'openapi' | 'web';
  response: FixtureResponse;
}

export interface ScenarioRequest {
  url: string;
  params?: Record<string, string>;
  match?: string;
}

export interface ScenarioResponse {
  status?: number;
  body?: unknown;
}

export interface Scenario {
  name: string;
  description?: string;
  authMode?: 'openapi' | 'web';
  sequence: Array<{
    request: ScenarioRequest;
    response: ScenarioResponse;
  }>;
}

// Module-level mutable state
let fixtures: Fixture[] = [];
let requests: Array<{ method: string; url: string }> = [];

// Stable mockFetch — its closure captures the live fixtures array.
async function mockFetch(url: URL | Request | string, options?: RequestInit): Promise<Response> {
  const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.href;
  const method = (options?.method ?? 'GET').toUpperCase();
  requests.push({ method, url: urlStr });

  const matchedIndex = fixtures.findIndex(f => {
    if (f.method && f.method.toUpperCase() !== method) return false;
    return urlsMatch(f.url, f.query, urlStr);
  });

  if (matchedIndex >= 0) {
    const [matched] = fixtures.splice(matchedIndex, 1);
    return makeResponse(matched.response.status ?? 200, matched.response.body);
  }

  throw new Error(`[fixture loader] No fixture matched: ${method} ${urlStr}`);
}

function urlsMatch(expectedUrl: string, expectedQuery: Record<string, string> | undefined, actualUrl: string): boolean {
  const expected = new URL(expectedUrl);
  const actual = new URL(actualUrl);
  if (expected.origin !== actual.origin || expected.pathname !== actual.pathname) return false;

  const query = new URLSearchParams(expected.search);
  for (const [key, value] of Object.entries(expectedQuery ?? {})) {
    query.set(key, value);
  }

  return searchParamsEqual(query, actual.searchParams);
}

function searchParamsEqual(expected: URLSearchParams, actual: URLSearchParams): boolean {
  const expectedEntries = [...expected.entries()].sort(([a], [b]) => a.localeCompare(b));
  const actualEntries = [...actual.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (expectedEntries.length !== actualEntries.length) return false;
  return expectedEntries.every(([key, value], index) => {
    const [actualKey, actualValue] = actualEntries[index];
    return key === actualKey && value === actualValue;
  });
}

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

export function registerFixture(fixture: Fixture): void {
  fixtures.push(fixture);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
}

export function resetFixtures(): void {
  fixtures = [];
  requests = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch;
}

export function getFixtureRequests(): Array<{ method: string; url: string }> {
  return [...requests];
}

export function loadScenario(name: string): void {
  const baseDir = dirname(__filename);
  const scenarioPath = join(baseDir, '..', '..', 'fixtures', 'scenarios', `${name}.json`);

  if (!existsSync(scenarioPath)) {
    throw new Error(`[fixture loader] Scenario file not found: ${scenarioPath}`);
  }

  const content = readFileSync(scenarioPath, 'utf-8');
  const scenario: Scenario = JSON.parse(content);

  if (!scenario || !scenario.sequence) {
    throw new Error(`[fixture loader] Invalid scenario: ${name}`);
  }

  // Register fixtures with query params embedded in the URL so that
  // list fixture "notes?limit=20" won't match child detail URLs "notes/prime_child_xxx"
  // via startsWith (the ? appears before the path segment).
  fixtures = scenario.sequence.map(seq => {
    return {
      url: seq.request.url,
      query: seq.request.params,
      method: 'GET',
      response: seq.response as FixtureResponse,
    };
  });
}
