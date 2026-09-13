import type { App, TFile } from 'obsidian';
import { createNote, fetchNoteDetail, type CreateNoteResult } from './api';
import { t } from './i18n';
import { parseSourceBody } from './source-body';
import { BidirectionalSyncEngine } from './bidirectional-sync';
import { getAuthCredentials, type AuthCredentials, type Settings, type SyncResultItem } from './types';

export interface ReverseSyncResult {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  items: SyncResultItem[];
}

export interface ReverseSyncProgress {
  processed: number;
  total: number;
  title: string;
  status: SyncResultItem['status'];
}

interface LocalMarkdownNote {
  file: TFile;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  uid?: string;
  primeId?: string;
  title: string;
  noteType: string;
  tags: string[];
}

interface LocalReadResult {
  note?: LocalMarkdownNote;
  skippedItem?: SyncResultItem;
}

const SUPPORTED_NOTE_TYPES = new Set(['plain_text', 'link']);
const MAX_UPLOAD_TAGS = 4;

interface ParsedFrontmatterBlock {
  frontmatter: Record<string, string>;
  body: string;
  raw: string;
  newline: '\n' | '\r\n';
  endIndex: number;
}

function parseSimpleFrontmatter(raw: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  let hasYamlLine = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (!match) continue;
    hasYamlLine = true;
    result[match[1]] = stripQuotes(match[2].trim());
  }
  return hasYamlLine ? result : null;
}

function parseFrontmatterBlock(content: string): ParsedFrontmatterBlock | null {
  const match = content.match(/^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n)?/);
  if (!match) return null;
  const parsed = parseSimpleFrontmatter(match[2]);
  if (!parsed) return null;
  return {
    frontmatter: parsed,
    body: content.slice(match[0].length),
    raw: match[2],
    newline: match[1] === '\r\n' ? '\r\n' : '\n',
    endIndex: match[0].length,
  };
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/s, '$2');
}

function readString(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function readTags(frontmatter: Record<string, unknown>): string[] {
  const value = frontmatter.tags;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[]') return [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return [];
  return trimmed
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(stripQuotes)
    .filter(Boolean);
}

function prepareUploadTags(tags: string[]): string[] {
  return [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].slice(0, MAX_UPLOAD_TAGS);
}

function markdownImageToPlainLink(_match: string, alt: string, rawTarget: string): string {
  const target = rawTarget.trim().replace(/^<|>$/g, '');
  const label = alt.trim() || target;
  return `[${label}](${target})`;
}

function prepareUploadContent(content: string): string {
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, markdownImageToPlainLink);
}

function fileBasename(file: TFile): string {
  return file.basename || file.path.split('/').pop()?.replace(/\.md$/i, '') || 'Untitled';
}

function nowIso(): string {
  return new Date().toISOString();
}

function replaceOrInsertFrontmatterFields(content: string, fields: Record<string, string | undefined>): string {
  const linesToUpsert = Object.entries(fields)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([key, value]) => `${key}: "${value}"`);
  const block = parseFrontmatterBlock(content);
  if (!block) {
    return ['---', ...linesToUpsert, '---', content].join('\n');
  }
  const frontmatterLines = block.raw.split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    if (!value) continue;
    const line = `${key}: "${value}"`;
    const existingIndex = frontmatterLines.findIndex(item => new RegExp(`^\\s*${key}\\s*:`).test(item));
    if (existingIndex >= 0) {
      frontmatterLines[existingIndex] = line;
    } else {
      frontmatterLines.unshift(line);
    }
  }
  const nl = block.newline;
  return `---${nl}${frontmatterLines.join(nl)}${nl}---${nl}${content.slice(block.endIndex)}`;
}

function isMissingRemoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /不存在|not\s*found|not\s*exist|404/i.test(message);
}

function isInsideFolder(file: TFile, folderName: string): boolean {
  const folder = folderName.replace(/^\/+|\/+$/g, '');
  if (!folder) return true;
  return file.path.startsWith(`${folder}/`);
}

export class ReverseSyncEngine {
  private abortController = new AbortController();
  private uploadEngine: BidirectionalSyncEngine;

  constructor(
    private app: App,
    private settings: Settings,
    private onProgress?: (progress: ReverseSyncProgress) => void
  ) {
    this.uploadEngine = new BidirectionalSyncEngine(app, settings);
  }

  cancel(): void {
    this.abortController.abort();
    this.uploadEngine.cancel();
  }

  private requireCredentials(): AuthCredentials {
    const credentials = getAuthCredentials(this.settings);
    if (!credentials.token || (credentials.authMode !== 'web' && !credentials.clientId)) {
      throw new Error('Missing Dedao Brain credentials');
    }
    return credentials;
  }

  private createLocalItem(
    file: TFile,
    status: SyncResultItem['status'],
    options: {
      noteId?: string;
      title?: string;
      noteType?: string;
      error?: string;
    } = {}
  ): SyncResultItem {
    return {
      noteId: options.noteId || file.path,
      title: options.title || fileBasename(file),
      noteType: options.noteType || 'plain_text',
      updatedAt: nowIso(),
      status,
      error: options.error,
    };
  }

  private async readLocalNote(file: TFile): Promise<LocalReadResult> {
    const content = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const parsed = parseFrontmatterBlock(content);
    const frontmatter = { ...(cache?.frontmatter ?? {}), ...(parsed?.frontmatter ?? {}) };
    const legacyBody = parsed?.body ?? content;
    const noteType = readString(frontmatter, 'note_type') || 'plain_text';
    const title = readString(frontmatter, 'title') || fileBasename(file);
    if (!SUPPORTED_NOTE_TYPES.has(noteType)) {
      return {
        skippedItem: this.createLocalItem(file, 'skipped', {
          title,
          noteType,
          error: t('reverseSync.skip.unsupportedType', { noteType }),
        }),
      };
    }
    const sourceBody = parseSourceBody(legacyBody);
    if (sourceBody.kind === 'invalid') {
      return {
        skippedItem: this.createLocalItem(file, 'skipped', {
          title,
          noteType,
          error: t('reverseSync.skip.invalidSourceBody', { reason: sourceBody.reason }),
        }),
      };
    }
    const body = sourceBody.kind === 'valid' ? sourceBody.body : legacyBody;
    if (!body.trim()) {
      return {
        skippedItem: this.createLocalItem(file, 'skipped', {
          title,
          noteType,
          error: t('reverseSync.skip.emptyBody'),
        }),
      };
    }

    return {
      note: {
        file,
        content,
        frontmatter,
        body,
        uid: readString(frontmatter, 'uid') || undefined,
        primeId: readString(frontmatter, 'prime_id') || undefined,
        title,
        noteType,
        tags: readTags(frontmatter),
      },
    };
  }

  private async remoteExists(detailId: string, credentials: AuthCredentials): Promise<boolean> {
    try {
      await fetchNoteDetail(detailId, credentials.token, credentials.clientId, this.abortController.signal, credentials.authMode);
      return true;
    } catch (err) {
      if (isMissingRemoteError(err)) return false;
      throw err;
    }
  }

  private async createRemoteNote(note: LocalMarkdownNote, credentials: AuthCredentials): Promise<CreateNoteResult> {
    const created = await createNote({
      token: credentials.token,
      clientId: credentials.clientId,
      authMode: credentials.authMode,
      title: note.title,
      content: prepareUploadContent(note.body),
      noteType: note.noteType,
      tags: prepareUploadTags(note.tags),
      signal: this.abortController.signal,
    });
    const currentContent = await this.app.vault.read(note.file);
    await this.app.vault.modify(note.file, replaceOrInsertFrontmatterFields(currentContent, {
      uid: created.noteId,
      prime_id: created.detailId,
    }));
    return created;
  }

  private reportProgress(item: SyncResultItem, processed: number, total: number): void {
    this.onProgress?.({
      processed,
      total,
      title: item.title,
      status: item.status,
    });
  }

  async syncFiles(files: TFile[]): Promise<ReverseSyncResult> {
    const credentials = this.requireCredentials();
    const result: ReverseSyncResult = { created: 0, skipped: 0, failed: 0, total: 0, items: [] };
    const totalFiles = files.length;

    for (const file of files) {
      if (this.abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      result.total++;
      let local: LocalReadResult;
      try {
        local = await this.readLocalNote(file);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        result.failed++;
        const item = this.createLocalItem(file, 'failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        result.items.push(item);
        this.reportProgress(item, result.total, totalFiles);
        continue;
      }
      if (local.skippedItem) {
        result.skipped++;
        result.items.push(local.skippedItem);
        this.reportProgress(local.skippedItem, result.total, totalFiles);
        continue;
      }
      const note = local.note;
      if (!note) continue;

      try {
        if (credentials.authMode === 'openapi' && note.noteType === 'plain_text'
          && isInsideFolder(file, this.settings.folderName)
          && (!note.uid || ['archive', 'attach'].includes(readString(note.frontmatter, 'dedao_upload_state')))) {
          const item = await this.uploadEngine.uploadNewFile(file, {
            raw: note.content, title: note.title, body: prepareUploadContent(note.body), tags: prepareUploadTags(note.tags),
          });
          if (item.status === 'created') result.created++;
          else {
            item.status = 'skipped';
            result.skipped++;
          }
          result.items.push(item);
          this.reportProgress(item, result.total, totalFiles);
          continue;
        }
        if (credentials.authMode === 'web' && note.uid && !note.primeId) {
          result.skipped++;
          const item = this.createLocalItem(file, 'skipped', {
            noteId: note.uid,
            title: note.title,
            noteType: note.noteType,
            error: t('reverseSync.skip.missingWebDetailId'),
          });
          result.items.push(item);
          this.reportProgress(item, result.total, totalFiles);
          continue;
        }
        const detailId = credentials.authMode === 'web' ? note.primeId : note.uid;
        if (detailId && await this.remoteExists(detailId, credentials)) {
          result.skipped++;
          const item = this.createLocalItem(file, 'skipped', {
            noteId: note.uid,
            title: note.title,
            noteType: note.noteType,
            error: t('reverseSync.skip.remoteExists'),
          });
          result.items.push(item);
          this.reportProgress(item, result.total, totalFiles);
          continue;
        }
        if (note.uid && credentials.authMode === 'openapi' && isInsideFolder(file, this.settings.folderName)) {
          const item = this.createLocalItem(file, 'skipped', {
            noteId: note.uid, title: note.title, noteType: note.noteType, error: t('bidirectional.remoteMissing'),
          });
          result.skipped++;
          result.items.push(item);
          this.reportProgress(item, result.total, totalFiles);
          continue;
        }
        const created = await this.createRemoteNote(note, credentials);
        result.created++;
        const item = this.createLocalItem(file, 'created', {
          noteId: created.noteId,
          title: note.title,
          noteType: note.noteType,
        });
        result.items.push(item);
        this.reportProgress(item, result.total, totalFiles);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        console.error(`[DedaoBrain] Reverse sync failed [${file.path}]:`, err);
        result.failed++;
        const item = this.createLocalItem(file, 'failed', {
          noteId: note.uid || file.path,
          title: note.title,
          noteType: note.noteType,
          error: err instanceof Error ? err.message : String(err),
        });
        result.items.push(item);
        this.reportProgress(item, result.total, totalFiles);
      }
    }

    return result;
  }

  async syncBack(): Promise<ReverseSyncResult> {
    const files = this.app.vault.getMarkdownFiles().filter(item => isInsideFolder(item, this.settings.folderName));
    return this.syncFiles(files);
  }
}
