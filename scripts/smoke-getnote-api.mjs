#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const obsidianMockPlugin = {
  name: 'obsidian-smoke-mock',
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: path.resolve('tests/mocks/obsidian.ts'),
    }));
  },
};

function mask(value) {
  if (!value) return '<empty>';
  if (value.length <= 12) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function withoutBearer(token) {
  return String(token || '').trim().replace(/^Bearer\s+/i, '');
}

function looksLikeOpenApiToken(token) {
  return /^gk_/i.test(withoutBearer(token));
}

function looksLikeWebToken(token) {
  return /^eyJ/i.test(withoutBearer(token));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getConfig() {
  const authMode = process.env.GETNOTE_AUTH_MODE || 'openapi';
  const token = process.env.GETNOTE_TOKEN || '';
  const clientId = process.env.GETNOTE_CLIENT_ID || '';
  const limit = Number(process.env.GETNOTE_SMOKE_LIMIT || 1);
  const reverse = process.env.GETNOTE_SMOKE_REVERSE === '1';
  if (authMode !== 'openapi' && authMode !== 'web') {
    throw new Error('GETNOTE_AUTH_MODE must be openapi or web.');
  }
  if (!token) throw new Error('Missing GETNOTE_TOKEN.');
  if (authMode === 'openapi' && !clientId) throw new Error('Missing GETNOTE_CLIENT_ID for OpenAPI smoke.');
  if (authMode === 'openapi' && !looksLikeOpenApiToken(token)) {
    throw new Error('OpenAPI smoke needs a gk_* token.');
  }
  if (authMode === 'web' && !looksLikeWebToken(token)) {
    throw new Error('Web smoke needs a Web Bearer/JWT token.');
  }
  if (reverse && authMode !== 'openapi') {
    throw new Error('Reverse smoke writes to GetNote and only supports OpenAPI.');
  }
  return { authMode, token, clientId: authMode === 'web' ? '' : clientId, limit, reverse };
}

async function importSourceApi() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'getnote-smoke-'));
  const outfile = path.join(tempDir, 'api-smoke.mjs');
  await esbuild.build({
    entryPoints: ['src/api.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  return { api: mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

async function importSourceSync() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'getnote-sync-smoke-bundle-'));
  const outfile = path.join(tempDir, 'sync-smoke.mjs');
  await esbuild.build({
    entryPoints: ['src/sync.ts'],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    plugins: [obsidianMockPlugin],
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  return { sync: mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

async function importSourceReverseSync() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'getnote-reverse-smoke-bundle-'));
  const outfile = path.join(tempDir, 'reverse-smoke.mjs');
  await esbuild.build({
    stdin: {
      contents: [
        "export { ReverseSyncEngine } from './src/reverse-sync';",
        "export { fetchNoteDetail } from './src/api';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'reverse-smoke-entry.ts',
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  return { reverse: mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

function summarizeNote(note) {
  return {
    id: String(note.id ?? ''),
    note_id: String(note.note_id ?? ''),
    prime_id: note.prime_id ? String(note.prime_id) : undefined,
    note_type: String(note.note_type ?? ''),
    title: String(note.title ?? '').slice(0, 40),
    updated_at: String(note.updated_at ?? ''),
  };
}

function summarizeDetail(detail) {
  const detailRecord = isRecord(detail.note) ? detail.note : detail;
  const attachments = Array.isArray(detail.attachments ?? detailRecord.attachments)
    ? detail.attachments ?? detailRecord.attachments
    : [];
  return {
    note_id: String(detailRecord.note_id ?? ''),
    note_type: String(detailRecord.note_type ?? ''),
    attachments: attachments.length,
    hasAudio: Boolean(detail.audio ?? detailRecord.audio),
  };
}

function createTempVaultApp(root) {
  class SmokeTFile {
    constructor(filePath) {
      this.path = filePath;
      this.name = path.basename(filePath);
      this.basename = this.name.replace(/\.[^.]+$/, '');
      this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    }
  }

  const files = new Map();
  const folders = new Set();
  const frontmatter = new Map();

  async function persistText(filePath, content) {
    const fullPath = path.join(root, filePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  async function persistBinary(filePath, data) {
    const fullPath = path.join(root, filePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, Buffer.from(data));
  }

  function parseFrontmatter(content) {
    const match = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
      result[key] = value;
    }
    return result;
  }

  return {
    vault: {
      getAllFolders: () => [...folders].map((folderPath) => ({ path: folderPath })),
      getMarkdownFiles: () => [...files.values()].filter((file) => file.path.endsWith('.md')),
      getAbstractFileByPath: (filePath) => files.get(filePath) || (folders.has(filePath) ? { path: filePath } : null),
      read: async (file) => {
        const found = files.get(file.path);
        return found?.content ?? '';
      },
      createFolder: async (folderPath) => {
        folders.add(folderPath);
        await mkdir(path.join(root, folderPath), { recursive: true });
      },
      create: async (filePath, content) => {
        const file = new SmokeTFile(filePath);
        files.set(filePath, { ...file, content });
        frontmatter.set(filePath, parseFrontmatter(content));
        await persistText(filePath, content);
        return file;
      },
      modify: async (file, content) => {
        files.set(file.path, { ...file, content });
        frontmatter.set(file.path, parseFrontmatter(content));
        await persistText(file.path, content);
      },
      rename: async (file, nextPath) => {
        files.delete(file.path);
        file.path = nextPath;
        files.set(nextPath, file);
      },
      createBinary: async (filePath, data) => {
        const file = new SmokeTFile(filePath);
        files.set(filePath, { ...file, content: `[binary:${data.byteLength}]` });
        await persistBinary(filePath, data);
        return file;
      },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }),
    },
    listFiles: () => [...files.keys()],
  };
}

async function runReadOnlySmoke(api, config) {
  const started = Date.now();
  const list = await api.fetchNotes({
    token: config.token,
    clientId: config.clientId,
    authMode: config.authMode,
    sinceId: '0',
    limit: config.limit,
  });
  console.log(`[GetNote smoke] list ok: ${list.notes.length} notes, hasMore=${list.hasMore}, ${Date.now() - started}ms`);
  if (list.notes.length === 0) return null;

  const firstNote = list.notes[0];
  console.log('[GetNote smoke] first note:', JSON.stringify(summarizeNote(firstNote)));

  const detailId = config.authMode === 'web'
    ? String(firstNote.prime_id || firstNote.note_id || firstNote.id)
    : String(firstNote.note_id || firstNote.id);
  const detailStarted = Date.now();
  const detail = await api.fetchNoteDetail(
    detailId,
    config.token,
    config.clientId,
    undefined,
    config.authMode
  );
  console.log(`[GetNote smoke] detail ok: detailId=${detailId}, ${Date.now() - detailStarted}ms`);
  console.log('[GetNote smoke] detail summary:', JSON.stringify(summarizeDetail(detail)));
  return firstNote;
}

async function runSyncSmoke(config, firstNote) {
  const tempVault = await mkdtemp(path.join(tmpdir(), 'getnote-sync-smoke-vault-'));
  const { sync, cleanup: cleanupBundle } = await importSourceSync();
  try {
    const app = createTempVaultApp(tempVault);
    const settings = {
      authMode: config.authMode,
      openApiToken: config.authMode === 'openapi' ? config.token : '',
      openApiClientId: config.authMode === 'openapi' ? config.clientId : '',
      webApiToken: config.authMode === 'web' ? config.token : '',
      apiToken: config.token,
      clientId: config.clientId,
      webCsrfToken: '',
      folderName: 'GetNoteSmoke',
      filenamePrefix: 'SMOKE_YYYYMMDDHHmmss',
      maxDays: 0,
      syncStartDate: '',
      lastSyncEndTimestamp: '',
      scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
      syncHistory: [],
    };
    const engine = new sync.SyncEngine(app, settings, undefined, { maxDays: 0, syncStartDate: '' });
    const started = Date.now();
    const result = await engine.syncNoteIds([String(firstNote.note_id)]);
    console.log(`[GetNote smoke] sync ok: total=${result.total}, created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, failed=${result.failed}, ${Date.now() - started}ms`);
    console.log('[GetNote smoke] temp files:', JSON.stringify(app.listFiles().slice(0, 10)));
  } finally {
    await cleanupBundle();
    await rm(tempVault, { recursive: true, force: true });
    console.log('[GetNote smoke] temp vault cleaned');
  }
}

async function runReverseSyncSmoke(config, api) {
  const tempVault = await mkdtemp(path.join(tmpdir(), 'getnote-reverse-smoke-vault-'));
  const { reverse, cleanup: cleanupBundle } = await importSourceReverseSync();
  try {
    const app = createTempVaultApp(tempVault);
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const title = `Codex reverse sync smoke ${now}`;
    const body = `This note was created by a Codex reverse-sync smoke test at ${now}.`;
    const filePath = `GetNoteSmoke/${title}.md`;
    await app.vault.create(filePath, [
      '---',
      `title: "${title}"`,
      'note_type: plain_text',
      '---',
      body,
    ].join('\n'));

    const settings = {
      authMode: 'openapi',
      openApiToken: config.token,
      openApiClientId: config.clientId,
      webApiToken: '',
      apiToken: '',
      clientId: '',
      webCsrfToken: '',
      folderName: 'GetNoteSmoke',
      filenamePrefix: '',
      maxDays: 0,
      syncStartDate: '',
      lastSyncEndTimestamp: '',
      scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
      syncHistory: [],
    };

    const started = Date.now();
    const result = await new reverse.ReverseSyncEngine(app, settings).syncBack();
    const uid = app.metadataCache.getFileCache({ path: filePath })?.frontmatter?.uid;
    console.log(`[GetNote smoke] reverse sync ok: total=${result.total}, created=${result.created}, skipped=${result.skipped}, failed=${result.failed}, ${Date.now() - started}ms`);
    console.log('[GetNote smoke] reverse local uid:', uid ? mask(String(uid)) : '<missing>');

    const detail = await api.fetchNoteDetail(String(uid), config.token, config.clientId, undefined, 'openapi');
    console.log('[GetNote smoke] reverse detail:', JSON.stringify({
      note_id: String(detail.note_id ?? ''),
      title: String(detail.title ?? ''),
      note_type: String(detail.note_type ?? ''),
      contentMatches: String(detail.content ?? '') === body,
    }));
    console.log('[GetNote smoke] reverse created remote note; delete it manually if this was only a smoke run.');
  } finally {
    await cleanupBundle();
    await rm(tempVault, { recursive: true, force: true });
    console.log('[GetNote smoke] reverse temp vault cleaned');
  }
}

async function main() {
  globalThis.window ??= globalThis;

  const config = getConfig();
  const { api, cleanup } = await importSourceApi();
  try {
    console.log('[GetNote smoke] source: src/api.ts');
    console.log('[GetNote smoke] authMode:', config.authMode);
    console.log('[GetNote smoke] token:', mask(withoutBearer(config.token)));
    if (config.authMode !== 'web') console.log('[GetNote smoke] clientId:', mask(config.clientId));
    const firstNote = await runReadOnlySmoke(api, config);
    if (firstNote && process.env.GETNOTE_SMOKE_SYNC === '1') {
      console.log('[GetNote smoke] source: src/sync.ts');
      await runSyncSmoke(config, firstNote);
    }
    if (config.reverse) {
      console.log('[GetNote smoke] source: src/reverse-sync.ts');
      await runReverseSyncSmoke(config, api);
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error('[GetNote smoke] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
