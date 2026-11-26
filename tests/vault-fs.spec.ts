import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import type { App } from 'obsidian';

const { code } = transformSync(readFileSync(path.resolve(import.meta.dirname, '../src/utils/vault-fs.ts'), 'utf8'), {
  loader: 'ts',
  format: 'cjs',
});
const writeFileMock = vi.fn();
const mkdirMock = vi.fn();

function loadVaultFs(isDesktopApp: boolean, nodeModulesAvailable = true) {
  const requireModule = vi.fn((name: string) => {
    if (name === 'obsidian') return { Platform: { isDesktopApp } };
    if (nodeModulesAvailable && name === 'fs/promises') return { writeFile: writeFileMock, mkdir: mkdirMock };
    if (nodeModulesAvailable && name === 'path') return path;
    throw new Error(`Module unavailable: ${name}`);
  });
  const module = { exports: {} };
  runInNewContext(code, { module, require: requireModule, Buffer, console });
  return { ...module.exports as typeof import('../src/utils/vault-fs'), requireModule };
}

interface WriteableAdapter {
  getBasePath?: () => string;
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
}

function makeAppWithAdapter(adapter: Partial<WriteableAdapter>): Pick<App, 'vault'> {
  return {
    vault: {
      adapter: adapter as App['vault']['adapter'],
    },
  } as unknown as Pick<App, 'vault'>;
}

describe('hasLocalVaultBase', () => {
  it('returns true when adapter exposes a non-empty getBasePath()', () => {
    const app = makeAppWithAdapter({ getBasePath: () => '/Users/test/vault' });
    expect(loadVaultFs(true).hasLocalVaultBase(app as unknown as App)).toBe(true);
  });

  it('returns false when adapter is missing getBasePath', () => {
    const app = makeAppWithAdapter({});
    expect(loadVaultFs(true).hasLocalVaultBase(app as unknown as App)).toBe(false);
  });

  it('returns false when getBasePath returns an empty string', () => {
    const app = makeAppWithAdapter({ getBasePath: () => '' });
    expect(loadVaultFs(true).hasLocalVaultBase(app as unknown as App)).toBe(false);
  });
});

describe('tryWriteBinary', () => {
  beforeEach(() => {
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('writes via Node fs when adapter has getBasePath', async () => {
    const { tryWriteBinary, requireModule } = loadVaultFs(true);
    expect(requireModule.mock.calls).toEqual([['obsidian']]);
    const createBinarySpy = vi.fn().mockResolvedValue(undefined);
    const app = makeAppWithAdapter({
      getBasePath: () => '/Users/test/vault',
    }) as unknown as App;
    (app as unknown as { vault: { createBinary: typeof createBinarySpy } }).vault.createBinary = createBinarySpy;

    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await tryWriteBinary(app, 'subdir/file.bin', data);

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [calledPath, calledBuffer] = writeFileMock.mock.calls[0] as [string, Buffer];
    expect(calledPath.replace(/\\/g, '/')).toBe('/Users/test/vault/subdir/file.bin');
    expect(calledBuffer).toBeInstanceOf(Buffer);
    expect(calledBuffer.buffer).toBe(data);
    expect(Array.from(calledBuffer)).toEqual([1, 2, 3, 4]);
    expect(createBinarySpy).not.toHaveBeenCalled();
    expect(mkdirMock).toHaveBeenCalled();
  });

  it('falls back to the Vault API when the desktop Node modules cannot load', async () => {
    const { tryWriteBinary } = loadVaultFs(true, false);
    const createBinary = vi.fn().mockResolvedValue(undefined);
    const app = {
      vault: { adapter: { getBasePath: () => '/desktop/vault' }, createBinary },
    } as unknown as App;
    const data = new ArrayBuffer(4);

    await tryWriteBinary(app, 'asset/file.bin', data);

    expect(createBinary).toHaveBeenCalledExactlyOnceWith('asset/file.bin', data);
  });

  it('uses the Vault API outside the desktop app even if the adapter exposes a local path', async () => {
    const { tryWriteBinary, requireModule } = loadVaultFs(false, false);
    const createBinary = vi.fn().mockResolvedValue(undefined);
    const getBasePath = vi.fn().mockReturnValue('/mobile/vault');
    const app = { vault: { adapter: { getBasePath }, createBinary } } as unknown as App;
    const data = new Uint8Array([1, 2, 3]).buffer;

    await tryWriteBinary(app, 'asset/photo.jpg', data);

    expect(requireModule.mock.calls).toEqual([['obsidian']]);
    expect(getBasePath).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(createBinary).toHaveBeenCalledExactlyOnceWith('asset/photo.jpg', data);
  });

  it('falls back to app.vault.createBinary when getBasePath is missing', async () => {
    const createBinarySpy = vi.fn().mockResolvedValue(undefined);
    const app = makeAppWithAdapter({}) as unknown as App;
    (app as unknown as { vault: { createBinary: typeof createBinarySpy } }).vault.createBinary = createBinarySpy;

    const data = new Uint8Array([9, 9, 9]).buffer;
    await loadVaultFs(true).tryWriteBinary(app, 'note.md', data);

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(createBinarySpy).toHaveBeenCalledTimes(1);
    expect(createBinarySpy).toHaveBeenCalledWith('note.md', data);
  });

  it('falls back to app.vault.createBinary when getBasePath is empty', async () => {
    const createBinarySpy = vi.fn().mockResolvedValue(undefined);
    const app = {
      vault: {
        adapter: { getBasePath: () => '' },
        createBinary: createBinarySpy,
      },
    } as unknown as App;

    await loadVaultFs(true).tryWriteBinary(app, 'note.md', new ArrayBuffer(4));

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(createBinarySpy).toHaveBeenCalledTimes(1);
  });

  it('falls back when Node fs.writeFile throws (e.g. Remote vault mounted via custom adapter)', async () => {
    writeFileMock.mockRejectedValueOnce(new Error('EROFS: read-only filesystem'));
    const createBinarySpy = vi.fn().mockResolvedValue(undefined);
    const app = makeAppWithAdapter({
      getBasePath: () => '/Users/test/vault',
    }) as unknown as App;
    (app as unknown as { vault: { createBinary: typeof createBinarySpy } }).vault.createBinary = createBinarySpy;

    const data = new Uint8Array([0xff]).buffer;
    await loadVaultFs(true).tryWriteBinary(app, 'asset/photo.jpg', data);

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(createBinarySpy).toHaveBeenCalledTimes(1);
    expect(createBinarySpy).toHaveBeenCalledWith('asset/photo.jpg', data);
  });
});
