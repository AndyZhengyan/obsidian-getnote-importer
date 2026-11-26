/// <reference types="node" />
import { Platform, type App } from 'obsidian';

/**
 * Returns true when the vault is backed by a local filesystem adapter that
 * exposes `getBasePath()`. On mobile and Remote vaults this is undefined, and
 * the caller must fall back to `app.vault.createBinary`.
 */
export function hasLocalVaultBase(app: App): boolean {
  const adapter = app.vault.adapter as { getBasePath?: () => string } | undefined;
  if (!adapter) return false;
  const base = adapter.getBasePath?.();
  return typeof base === 'string' && base.length > 0;
}

/**
 * Write binary data to a vault-relative path, preferring the local Node fs
 * fast path on desktop. Falls back to `app.vault.createBinary()` on any
 * failure (Remote vault, permission error, missing fs module, etc.).
 *
 * This exists because `app.vault.createBinary()` always copies through
 * ArrayBuffer, which is wasteful for large attachments (mp3, mp4, pdf) when
 * the vault is local.
 */
export async function tryWriteBinary(
  app: App,
  vaultPath: string,
  data: ArrayBuffer
): Promise<void> {
  const adapter = app.vault.adapter as { getBasePath?: () => string } | undefined;
  const base = Platform.isDesktopApp ? adapter?.getBasePath?.() : undefined;

  if (typeof base === 'string' && base.length > 0) {
    try {
      // Use Electron's CommonJS loader only when the desktop fast path is needed.
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { writeFile, mkdir } = require('fs/promises') as typeof import('fs/promises');
      const path = require('path') as typeof import('path');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const absPath = path.join(base, vaultPath);
      const absDir = path.dirname(absPath);
      await mkdir(absDir, { recursive: true });
      // Buffer.from(ArrayBuffer) is a zero-copy view (same underlying memory),
      // so writeFile writes the bytes directly without an extra allocation.
      await writeFile(absPath, Buffer.from(data));
      return;
    } catch (err) {
      console.warn('[DedaoBrain] Local fs write failed, falling back to vault.createBinary', err);
    }
  }

  await app.vault.createBinary(vaultPath, data);
}
