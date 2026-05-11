import { App, requestUrl, TFile } from 'obsidian';
import { fetchAllNotes, fetchNoteDetail } from './api';
import { formatDateTime, formatTimestampPrefix, renderNote, generateDisplayTitle } from './note-parser';
import { getCategoryDir } from './types';
import type { GetNoteNote, Settings, SyncResult, SyncResultItem, SyncScopeOptions } from './types';
import type { SyncModal } from './ui/sync-modal';
import { t } from './i18n';

const AUDIO_NOTE_TYPES = new Set([
  'recorder_audio',
  'recorder_flash_audio',
  'immediate_audio',
  'audio_long',
  'local_audio',
]);

function parseSyncBoundaryTime(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseNoteUpdatedTime(note: GetNoteNote): number | null {
  const parsed = Date.parse(note.updated_at);
  return Number.isNaN(parsed) ? null : parsed;
}

function isSortedByUpdatedDesc(notes: GetNoteNote[]): boolean {
  let previous: number | null = null;
  for (const note of notes) {
    const current = parseNoteUpdatedTime(note);
    if (current === null) return false;
    if (previous !== null && current > previous) return false;
    previous = current;
  }
  return true;
}

function isSafeAttachmentUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled');
    this.name = 'SyncCancelledError';
  }
}

export interface SyncProgressCallback {
  (info: { page?: number; processed?: number; total?: number; created?: number; updated?: number; skipped?: number; failed?: number; percent?: number }): void;
}

type WriteStatus = SyncResultItem['status'];

interface WriteNoteResult {
  status: WriteStatus;
  error?: string;
}

export class SyncEngine {
  private app: App;
  private settings: Settings;
  private scopeOptions: SyncScopeOptions;
  private onProgress?: SyncProgressCallback;
  private onCancel?: () => void;
  private cancelled = false;
  private abortController: AbortController | null = null;

  constructor(app: App, settings: Settings, onProgress?: SyncProgressCallback, scopeOptions?: Partial<SyncScopeOptions>) {
    this.app = app;
    this.settings = settings;
    this.scopeOptions = {
      maxDays: scopeOptions?.maxDays ?? settings.maxDays,
      syncStartDate: scopeOptions?.syncStartDate ?? settings.syncStartDate,
    };
    this.onProgress = onProgress;
  }

  private async ensureCategoryDir(categoryDir: string): Promise<string> {
    const basePath = this.settings.folderName;
    const fullPath = `${basePath}/${categoryDir}`;
    const targetDir = this.app.vault.getAbstractFileByPath(fullPath);
    if (!targetDir) {
      await this.app.vault.createFolder(fullPath);
    }
    return fullPath;
  }

  private getFileName(note: GetNoteNote): string {
    const rawTitle = generateDisplayTitle(note);
    const displayTitle = rawTitle || t('picker.noTitle');
    const prefix = this.settings.filenamePrefix?.trim();
    if (!prefix) {
      return displayTitle;
    }

    const hasTimestampTokens = /YYYY|MM|DD|HH|mm|ss/.test(prefix);
    if (hasTimestampTokens) {
      const formattedPrefix = formatTimestampPrefix(prefix, note.created_at);
      if (!formattedPrefix) {
        return displayTitle;
      }
      const separator = formattedPrefix.endsWith('_') ? '' : '_';
      return `${formattedPrefix}${separator}${displayTitle}`;
    }

    const separator = prefix.endsWith('_') ? '' : '_';
    return `${prefix}${separator}${displayTitle}`;
  }

  private getFilePath(categoryDir: string, note: GetNoteNote): string {
    return `${categoryDir}/${this.getFileName(note)}.md`;
  }

  private resolveConflict(categoryDir: string, baseName: string): string {
    let suffix = 2;
    let path: string;
    do {
      path = `${categoryDir}/${baseName}-${suffix}.md`;
      suffix++;
    } while (this.app.vault.getAbstractFileByPath(path));
    return path;
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }

  setOnCancel(fn: () => void): void {
    this.onCancel = fn;
  }

  private async downloadAudioAsset(
    note: GetNoteNote,
    attachment: { type: string; url: string; title: string; duration: number }
  ): Promise<string | null> {
    try {
      if (!isSafeAttachmentUrl(attachment.url)) {
        console.warn('[GetNote] Skipped unsafe audio attachment URL');
        return null;
      }

      const categoryDir = await this.ensureCategoryDir(getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const filename = `${this.getFileName(note)}_audio.mp3`;
      const targetPath = `${assetDir}/${filename}`;

      // Skip already-existing files
      if (this.app.vault.getAbstractFileByPath(targetPath)) return targetPath;

      const res = await requestUrl({ url: attachment.url, throw: false });
      if (res.status < 200 || res.status >= 300) {
        console.error(`[GetNote] Audio download failed: ${res.status}`);
        return null;
      }
      await this.app.vault.createBinary(targetPath, res.arrayBuffer);
      return targetPath;
    } catch (err) {
      console.error(`[GetNote] Audio download error:`, err);
      return null;
    }
  }

  private async writeAudioTranscriptAsset(note: GetNoteNote): Promise<string | null> {
    if (!note.audio) return null;

    try {
      const categoryDir = await this.ensureCategoryDir(getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const targetPath = `${assetDir}/${this.getFileName(note)}_transcript.md`;
      const content = `# ${generateDisplayTitle(note) || t('picker.noTitle')}\n\n${note.audio}`;
      const existing = this.app.vault.getAbstractFileByPath(targetPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(targetPath, content);
      }
      return targetPath;
    } catch (err) {
      console.error('[GetNote] Audio transcript write error:', err);
      return null;
    }
  }

  private isContentChanged(file: TFile, note: GetNoteNote): boolean {
    try {
      const cached = this.app.metadataCache.getFileCache(file);
      if (!cached?.frontmatter) return true;
      const modified = cached.frontmatter['modified'] as string | undefined;
      if (!modified) return true;
      const noteModified = formatDateTime(note.updated_at);
      return modified !== noteModified;
    } catch {
      return true;
    }
  }

  private buildUidIndex(): Map<string, TFile> {
    const index = new Map<string, TFile>();
    const prefix = this.settings.folderName + '/';
    const allFiles = this.app.vault.getMarkdownFiles();
    for (const file of allFiles) {
      if (!file.path.startsWith(prefix)) continue;
      const cached = this.app.metadataCache.getFileCache(file);
      const uid = cached?.frontmatter?.['uid'] as string | undefined;
      if (uid) {
        index.set(uid, file);
      }
    }
    return index;
  }

  private async writeNote(
    note: GetNoteNote,
    uidIndex: Map<string, TFile>
  ): Promise<WriteNoteResult> {
    try {
      const categoryDir = await this.ensureCategoryDir(getCategoryDir(note.note_type));
      let targetPath = this.getFilePath(categoryDir, note);
      const existingByUid = uidIndex.get(note.note_id);
      const existingAtTarget = this.app.vault.getAbstractFileByPath(targetPath);

      if (existingAtTarget instanceof TFile) {
        if (!existingByUid || existingAtTarget.path !== existingByUid.path) {
          const cached = this.app.metadataCache.getFileCache(existingAtTarget);
          const targetUid = cached?.frontmatter?.['uid'] as string | undefined;
          if (targetUid && targetUid !== note.note_id) {
            const baseName = this.getFileName(note);
            targetPath = this.resolveConflict(categoryDir, baseName);
          }
        }
      }

      if (existingByUid) {
        const contentChanged = this.isContentChanged(existingByUid, note);
        const pathChanged = existingByUid.path !== targetPath;

        if (!contentChanged && !pathChanged) return { status: 'skipped' };

        const content = renderNote(note, note.assetFileName);
        if (pathChanged) {
          await this.app.vault.rename(existingByUid, targetPath);
        }
        await this.app.vault.modify(existingByUid, content);
        return { status: 'updated' };
      } else if (existingAtTarget instanceof TFile) {
        // File exists at target path but wasn't in uidIndex - check content
        const contentChanged = this.isContentChanged(existingAtTarget, note);
        const content = renderNote(note, note.assetFileName);
        await this.app.vault.modify(existingAtTarget, content);
        uidIndex.set(note.note_id, existingAtTarget);
        return { status: contentChanged ? 'updated' : 'skipped' };
      } else {
        const content = renderNote(note, note.assetFileName);
        try {
          await this.app.vault.create(targetPath, content);
          const created = this.app.vault.getAbstractFileByPath(targetPath);
          if (created && created instanceof TFile) {
            uidIndex.set(note.note_id, created);
          }
          return { status: 'created' };
        } catch (createErr) {
          // File was created by another process between check and create
          const existing = this.app.vault.getAbstractFileByPath(targetPath);
          if (existing instanceof TFile) {
            const contentChanged = this.isContentChanged(existing, note);
            await this.app.vault.modify(existing, content);
            uidIndex.set(note.note_id, existing);
            return { status: contentChanged ? 'updated' : 'skipped' };
          }
          throw createErr;
        }
      }
    } catch (err) {
      console.error(`[GetNote] Write failed [${generateDisplayTitle(note) || note.note_id}]:`, err);
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private recordItem(result: SyncResult, note: GetNoteNote, writeResult: WriteNoteResult): void {
    result.items?.push({
      noteId: note.note_id,
      title: generateDisplayTitle(note) || t('picker.noTitle'),
      noteType: note.note_type,
      updatedAt: note.updated_at,
      status: writeResult.status,
      error: writeResult.error,
    });
  }

  private async enrichAudioNote(note: GetNoteNote, signal: AbortSignal): Promise<GetNoteNote> {
    if (!AUDIO_NOTE_TYPES.has(note.note_type)) {
      return note;
    }

    try {
      const noteDetail = await fetchNoteDetail(
        note.note_id,
        this.settings.apiToken,
        this.settings.clientId,
        signal
      );
      const enrichedNote: GetNoteNote = {
        ...note,
        ...noteDetail,
        id: noteDetail.id ?? note.id,
        note_id: noteDetail.note_id ?? note.note_id,
        title: noteDetail.title ?? note.title,
        content: noteDetail.content ?? note.content,
        note_type: noteDetail.note_type ?? note.note_type,
        source: noteDetail.source ?? note.source,
        tags: noteDetail.tags ?? note.tags,
        created_at: noteDetail.created_at ?? note.created_at,
        updated_at: noteDetail.updated_at ?? note.updated_at,
      };
      const attachment = enrichedNote.attachments?.find(a => a.type === 'audio');
      if (attachment) {
        await this.downloadAudioAsset(enrichedNote, attachment);
      } else {
        console.warn(`[GetNote] No audio attachment found in note detail [${note.note_id}]`);
      }
      await this.writeAudioTranscriptAsset(enrichedNote);
      enrichedNote.assetFileName = this.getFileName(enrichedNote);
      return enrichedNote;
    } catch (err) {
      console.warn(`[GetNote] Failed to enrich audio note ${note.note_id}:`, err);
      return note;
    }
  }

  private filterNotesByDateRange(notes: GetNoteNote[]): GetNoteNote[] {
    const { syncStartDate } = this.scopeOptions;
    if (!syncStartDate) return notes;

    const startTime = parseSyncBoundaryTime(syncStartDate);
    if (startTime === null) return notes;

    return notes.filter(note => {
      const updated = parseNoteUpdatedTime(note);
      return updated !== null && updated >= startTime;
    });
  }

  private filterRecentNotes(notes: GetNoteNote[]): GetNoteNote[] {
    const { maxDays } = this.scopeOptions;
    if (!maxDays || maxDays <= 0) return notes;

    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    return notes.filter(note => {
      const updated = parseNoteUpdatedTime(note);
      return updated !== null && updated >= cutoff;
    });
  }

  async sync(modal?: SyncModal): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
    const uidIndex = this.buildUidIndex();
    const controller = new AbortController();
    this.abortController = controller;
    let pageCount = 0;

    // cutoffTime: earliest time boundary for early exit. Use the newest (most restrictive) of:
    // - syncStartDate (absolute): manual sync user-specified date
    // - maxDays cutoff (relative): only keep notes within last N days
    // Taking the max means early exit fires when EITHER boundary is reached.
    const syncStartCutoff = this.scopeOptions.syncStartDate
      ? parseSyncBoundaryTime(this.scopeOptions.syncStartDate)
      : null;
    const maxDaysCutoff = this.scopeOptions.maxDays && this.scopeOptions.maxDays > 0
      ? Date.now() - this.scopeOptions.maxDays * 24 * 60 * 60 * 1000
      : null;
    const cutoffTime = [syncStartCutoff, maxDaysCutoff]
      .filter((t): t is number => t !== null)
      .reduce((max, t) => Math.max(max, t), 0) || null;
    let lastNoteTimestampTime: number | null = null;

    const cleanup = () => {
      this.cancelled = true;
      this.onCancel?.();
      if (!controller.signal.aborted) controller.abort();
    };
    modal?.setOnCancel(cleanup);

    try {
      for await (const notes of fetchAllNotes(this.settings.apiToken, this.settings.clientId, controller.signal)) {
        if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
        pageCount++;
        this.onProgress?.({ page: pageCount, percent: 0 });

        const recentNotes = this.filterRecentNotes(notes);
        const filtered = this.filterNotesByDateRange(recentNotes);

        for (const note of filtered) {
          if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
          result.total++;
          const noteToWrite = await this.enrichAudioNote(note, controller.signal);
          const writeResult = await this.writeNote(noteToWrite, uidIndex);
          switch (writeResult.status) {
            case 'created': result.created++; break;
            case 'updated': result.updated++; break;
            case 'skipped': result.skipped++; break;
            case 'failed': result.failed++; break;
          }
          this.recordItem(result, noteToWrite, writeResult);
          const updatedTime = parseNoteUpdatedTime(note);
          if (updatedTime !== null && (lastNoteTimestampTime === null || updatedTime > lastNoteTimestampTime)) {
            lastNoteTimestampTime = updatedTime;
            result.lastNoteTimestamp = note.updated_at;
          }
        }

        // Notes are sorted by updated_at DESC. Once the oldest note in this page
        // is older than the cutoff, later pages can be skipped after this page's
        // still-valid notes have been processed.
        if (cutoffTime !== null && notes.length > 0 && isSortedByUpdatedDesc(notes)) {
          const oldestNote = notes[notes.length - 1];
          const oldestTime = parseNoteUpdatedTime(oldestNote);
          if (oldestTime !== null && oldestTime < cutoffTime) {
            break;
          }
        }

        if (result.total % 10 === 0) {
          this.onProgress?.({
            page: pageCount,
            processed: result.total,
            total: result.total,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            percent: 0,
          });
        }
      }

      this.onProgress?.({ percent: 100 });
      return result;
    } catch (err) {
      cleanup();
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new SyncCancelledError();
      }
      throw err;
    }
  }

  async syncNoteIds(
    noteIds: string[],
    modal?: SyncModal
  ): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
    const idSet = new Set(noteIds);
    const uidIndex = this.buildUidIndex();
    const controller = new AbortController();
    this.abortController = controller;
    this.cancelled = false;
    let fetchedCount = 0;

    const cleanup = () => {
      this.cancelled = true;
      if (!controller.signal.aborted) controller.abort();
    };
    modal?.setOnCancel(cleanup);

    try {
      for await (const batch of fetchAllNotes(this.settings.apiToken, this.settings.clientId, controller.signal)) {
        if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();

        const matched = batch.filter(n => idSet.has(n.note_id));

        for (const note of matched) {
          if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();

          fetchedCount++;
          result.total++;
          const percent = Math.round((fetchedCount / noteIds.length) * 100);
          this.onProgress?.({
            processed: fetchedCount,
            total: noteIds.length,
            percent,
          });
          const noteToWrite = await this.enrichAudioNote(note, controller.signal);
          const writeResult = await this.writeNote(noteToWrite, uidIndex);
          switch (writeResult.status) {
            case 'created': result.created++; break;
            case 'updated': result.updated++; break;
            case 'skipped': result.skipped++; break;
            case 'failed': result.failed++; break;
          }
          this.recordItem(result, noteToWrite, writeResult);
        }

        if (fetchedCount >= noteIds.length) break;
      }

      this.onProgress?.({ percent: 100 });
      return result;
    } catch (err) {
      cleanup();
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new SyncCancelledError();
      }
      throw err;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }
}
