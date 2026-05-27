import type { App, TFile } from 'obsidian';
import { createNote, fetchNoteDetail, type CreateNoteResult } from './api';
import { t } from './i18n';
import { getAuthCredentials, type AuthCredentials, type Settings, type SyncResultItem } from './types';

export interface ReverseSyncResult {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  items: SyncResultItem[];
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
    if (!match) return null;
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
  return value.trim().replace(/^"|"$/g, '');
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
  return trimmed
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(stripQuotes)
    .filter(Boolean);
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

  constructor(private app: App, private settings: Settings) {}

  cancel(): void {
    this.abortController.abort();
  }

  private requireCredentials(): AuthCredentials {
    const credentials = getAuthCredentials(this.settings);
    if (!credentials.token || (credentials.authMode !== 'web' && !credentials.clientId)) {
      throw new Error('Missing GetNote credentials');
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
    const body = parsed?.body ?? content;
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
      content: note.body,
      noteType: note.noteType,
      tags: note.tags,
      signal: this.abortController.signal,
    });
    const currentContent = await this.app.vault.read(note.file);
    await this.app.vault.modify(note.file, replaceOrInsertFrontmatterFields(currentContent, {
      uid: created.noteId,
      prime_id: created.detailId,
    }));
    return created;
  }

  async syncFiles(files: TFile[]): Promise<ReverseSyncResult> {
    const credentials = this.requireCredentials();
    const result: ReverseSyncResult = { created: 0, skipped: 0, failed: 0, total: 0, items: [] };

    for (const file of files) {
      if (this.abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      result.total++;
      let local: LocalReadResult;
      try {
        local = await this.readLocalNote(file);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        result.failed++;
        result.items.push(this.createLocalItem(file, 'failed', {
          error: err instanceof Error ? err.message : String(err),
        }));
        continue;
      }
      if (local.skippedItem) {
        result.skipped++;
        result.items.push(local.skippedItem);
        continue;
      }
      const note = local.note;
      if (!note) continue;

      try {
        if (credentials.authMode === 'web' && note.uid && !note.primeId) {
          result.skipped++;
          result.items.push(this.createLocalItem(file, 'skipped', {
            noteId: note.uid,
            title: note.title,
            noteType: note.noteType,
            error: t('reverseSync.skip.missingWebDetailId'),
          }));
          continue;
        }
        const detailId = credentials.authMode === 'web' ? note.primeId : note.uid;
        if (detailId && await this.remoteExists(detailId, credentials)) {
          result.skipped++;
          result.items.push(this.createLocalItem(file, 'skipped', {
            noteId: note.uid,
            title: note.title,
            noteType: note.noteType,
            error: t('reverseSync.skip.remoteExists'),
          }));
          continue;
        }
        const created = await this.createRemoteNote(note, credentials);
        result.created++;
        result.items.push(this.createLocalItem(file, 'created', {
          noteId: created.noteId,
          title: note.title,
          noteType: note.noteType,
        }));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        console.error(`[GetNote] Reverse sync failed [${file.path}]:`, err);
        result.failed++;
        result.items.push(this.createLocalItem(file, 'failed', {
          noteId: note.uid || file.path,
          title: note.title,
          noteType: note.noteType,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    return result;
  }

  async syncBack(): Promise<ReverseSyncResult> {
    const files = this.app.vault.getMarkdownFiles().filter(item => isInsideFolder(item, this.settings.folderName));
    return this.syncFiles(files);
  }
}
