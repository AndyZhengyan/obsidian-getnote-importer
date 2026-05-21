import { App, TFile } from 'obsidian';
import { fetchAllNotes, fetchNoteChildren, fetchNoteDetail } from './api';
import { formatDateTime, formatTimestampPrefix, renderNote, generateDisplayTitle } from './note-parser';
import { getCategoryDir } from './types';
import { getAuthCredentials, type GetNoteNote, type Settings, type SyncResult, type SyncResultItem, type SyncScopeOptions } from './types';
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

function parseNoteCreatedTime(note: GetNoteNote): number | null {
  const parsed = Date.parse(note.created_at);
  return Number.isNaN(parsed) ? null : parsed;
}

function isSortedByCreatedDesc(notes: GetNoteNote[]): boolean {
  let previous: number | null = null;
  for (const note of notes) {
    const current = parseNoteCreatedTime(note);
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
  file?: TFile;
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
    const syncStartDate = scopeOptions?.syncStartDate ?? settings.syncStartDate;
    this.scopeOptions = {
      maxDays: syncStartDate ? 0 : scopeOptions?.maxDays ?? settings.maxDays,
      syncStartDate,
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

  private buildBaseName(note: GetNoteNote): string {
    const rawTitle = generateDisplayTitle(note);
    const displayTitle = rawTitle || t('picker.noTitle');
    const prefix = this.settings.filenamePrefix?.trim();
    if (!prefix) return displayTitle;

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

  private getFileName(note: GetNoteNote, parentBaseName?: string): string {
    // 子文档用父文档 baseName + 子文档标题，不用 note_id
    if (parentBaseName) {
      const childTitle = generateDisplayTitle(note) || t('picker.noTitle');
      return `${parentBaseName}__${childTitle}`;
    }
    return this.buildBaseName(note);
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

      const res = await fetch(attachment.url);
      if (res.status < 200 || res.status >= 300) {
        console.error(`[GetNote] Audio download failed: ${res.status}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      await this.app.vault.createBinary(targetPath, arrayBuffer);
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

  /**
   * Check if a note and all its artifacts already exist in the vault and are up to date.
   * Uses UID-based lookup so renamed/moved files are still found.
   */
  private preCheckNote(
    note: GetNoteNote,
    uidIndex: Map<string, TFile>
  ): { exists: boolean; file?: TFile } {
    const existingFile = uidIndex.get(note.note_id);
    if (!existingFile) return { exists: false };

    const contentChanged = this.isContentChanged(existingFile, note);
    if (contentChanged) return { exists: false, file: existingFile };

    // For audio notes, verify attachments exist as well
    if (AUDIO_NOTE_TYPES.has(note.note_type)) {
      const categoryDir = getCategoryDir(note.note_type);
      const basePath = `${this.settings.folderName}/${categoryDir}`;
      const assetDir = `${basePath}/asset`;
      const baseFilename = this.getFileName(note);

      if (
        !this.app.vault.getAbstractFileByPath(`${assetDir}/${baseFilename}_audio.mp3`) ||
        !this.app.vault.getAbstractFileByPath(`${assetDir}/${baseFilename}_transcript.md`)
      ) {
        return { exists: false, file: existingFile };
      }
    }

    return { exists: true, file: existingFile };
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
    uidIndex: Map<string, TFile>,
    parentBaseName?: string,
    parentFileName?: string,
    childFileNames?: string[]
  ): Promise<WriteNoteResult> {
    try {
      const categoryDir = await this.ensureCategoryDir(getCategoryDir(note.note_type));
      let targetPath = `${categoryDir}/${this.getFileName(note, parentBaseName)}.md`;
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

      const content = renderNote(note, note.assetFileName, parentFileName, childFileNames);

      if (existingByUid) {
        const contentChanged = this.isContentChanged(existingByUid, note);
        const pathChanged = existingByUid.path !== targetPath;

        if (!contentChanged && !pathChanged) return { status: 'skipped', file: existingByUid };

        if (pathChanged) {
          await this.app.vault.rename(existingByUid, targetPath);
        }
        await this.app.vault.modify(existingByUid, content);
        return { status: 'updated', file: existingByUid };
      } else if (existingAtTarget instanceof TFile) {
        // File exists at target path but wasn't in uidIndex - check content
        const contentChanged = this.isContentChanged(existingAtTarget, note);
        await this.app.vault.modify(existingAtTarget, content);
        uidIndex.set(note.note_id, existingAtTarget);
        return { status: contentChanged ? 'updated' : 'skipped', file: existingAtTarget };
      } else {
        try {
          await this.app.vault.create(targetPath, content);
          const created = this.app.vault.getAbstractFileByPath(targetPath);
          if (created && created instanceof TFile) {
            uidIndex.set(note.note_id, created);
          }
          return { status: 'created', file: created instanceof TFile ? created : undefined };
        } catch (createErr) {
          // File was created by another process between check and create
          const existing = this.app.vault.getAbstractFileByPath(targetPath);
          if (existing instanceof TFile) {
            const contentChanged = this.isContentChanged(existing, note);
            await this.app.vault.modify(existing, content);
            uidIndex.set(note.note_id, existing);
            return { status: contentChanged ? 'updated' : 'skipped', file: existing };
          }
          throw createErr;
        }
      }
    } catch (err) {
      console.error(`[GetNote] Write failed [${generateDisplayTitle(note) || note.note_id}]:`, err);
      return {
        status: 'failed',
        file: undefined,
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

  private applyWriteResult(result: SyncResult, writeResult: WriteNoteResult): void {
    switch (writeResult.status) {
      case 'created': result.created++; break;
      case 'updated': result.updated++; break;
      case 'skipped': result.skipped++; break;
      case 'failed': result.failed++; break;
    }
  }

  private mergeNoteDetail(note: GetNoteNote, detail: Partial<GetNoteNote>): GetNoteNote {
    const childrenIds = detail.children_ids && detail.children_ids.length >= (note.children_ids?.length ?? 0)
      ? detail.children_ids
      : note.children_ids;
    return {
      ...note,
      ...detail,
      id: detail.id ?? note.id,
      note_id: detail.note_id ?? note.note_id,
      title: detail.title ?? note.title,
      content: detail.content ?? note.content,
      note_type: detail.note_type ?? note.note_type,
      source: detail.source ?? note.source,
      tags: detail.tags ?? note.tags,
      created_at: detail.created_at ?? note.created_at,
      updated_at: detail.updated_at ?? note.updated_at,
      parent_id: detail.parent_id ?? note.parent_id,
      children_count: detail.children_count ?? note.children_count,
      // Don't overwrite relation fields that were already populated by list data;
      // some detail responses omit them.
      children_ids: childrenIds,
      is_child_note: note.is_child_note ?? detail.is_child_note,
    };
  }

  private needsRelationDetail(note: GetNoteNote): boolean {
    return (note.children_count ?? 0) > (note.children_ids?.length ?? 0);
  }

  private async enrichAudioNote(note: GetNoteNote, signal: AbortSignal): Promise<GetNoteNote> {
    const needsAudioDetail = AUDIO_NOTE_TYPES.has(note.note_type);
    if (!needsAudioDetail && !this.needsRelationDetail(note)) {
      return note;
    }
    const credentials = getAuthCredentials(this.settings);
    if (credentials.authMode === 'web' && !needsAudioDetail) {
      return note;
    }

    try {
      // For Web API, use prime_id (not id/note_id) for the detail URL
      const detailId = (note as { prime_id?: string }).prime_id ?? note.note_id;
      const noteDetail = await fetchNoteDetail(
        detailId,
        credentials.token,
        credentials.clientId,
        signal,
        credentials.authMode
      );
      const enrichedNote = this.mergeNoteDetail(note, noteDetail);
      if (!needsAudioDetail) {
        return enrichedNote;
      }
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
      console.warn(`[GetNote] Failed to enrich note ${note.note_id}:`, err);
      return note;
    }
  }

  private async fetchAppendNotes(
    parent: GetNoteNote,
    signal: AbortSignal,
    result: SyncResult
  ): Promise<GetNoteNote[]> {
    const credentials = getAuthCredentials(this.settings);
    if (credentials.authMode === 'web' && (parent.children_count ?? 0) > 0) {
      const parentDetailId = (parent as { prime_id?: string }).prime_id ?? parent.note_id;
      try {
        const children = await fetchNoteChildren(
          parentDetailId,
          credentials.token,
          signal,
          credentials.authMode
        );
        const appendNotes: GetNoteNote[] = [];
        for (const child of children) {
          const baseChild: GetNoteNote = {
            ...child,
            parent_id: child.parent_id || parent.note_id,
            is_child_note: child.is_child_note ?? true,
          };
          appendNotes.push(await this.enrichAudioNote(baseChild, signal));
        }
        return appendNotes;
      } catch (err) {
        result.failed++;
        const failedNote: GetNoteNote = {
          id: parentDetailId,
          note_id: parentDetailId,
          title: '',
          content: '',
          note_type: 'plain_text',
          source: parent.source,
          tags: [],
          created_at: parent.created_at,
          updated_at: parent.updated_at,
          parent_id: parent.note_id,
          is_child_note: true,
        };
        this.recordItem(result, failedNote, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        console.warn(`[GetNote] Failed to fetch append notes for ${parentDetailId}:`, err);
      }
      return [];
    }

    const childIds = parent.children_ids ?? [];
    if (!childIds.length) return [];

    const appendNotes: GetNoteNote[] = [];
    for (const childId of childIds) {
      try {
        const childDetail = await fetchNoteDetail(
          childId,
          credentials.token,
          credentials.clientId,
          signal,
          credentials.authMode
        );
        const baseChild: GetNoteNote = {
          id: childDetail.id ?? childId,
          note_id: childDetail.note_id ?? childId,
          title: childDetail.title ?? '',
          content: childDetail.content ?? '',
          note_type: childDetail.note_type ?? 'plain_text',
          source: childDetail.source ?? parent.source,
          tags: childDetail.tags ?? [],
          created_at: childDetail.created_at ?? parent.created_at,
          updated_at: childDetail.updated_at ?? parent.updated_at,
          parent_id: childDetail.parent_id ?? parent.note_id,
          children_count: childDetail.children_count,
          children_ids: childDetail.children_ids,
          is_child_note: childDetail.is_child_note ?? true,
        };
        const child = await this.enrichAudioNote(this.mergeNoteDetail(baseChild, childDetail), signal);
        appendNotes.push(child);
      } catch (err) {
        result.failed++;
        const failedNote: GetNoteNote = {
          id: childId,
          note_id: childId,
          title: '',
          content: '',
          note_type: 'plain_text',
          source: parent.source,
          tags: [],
          created_at: parent.created_at,
          updated_at: parent.updated_at,
          parent_id: parent.note_id,
          is_child_note: true,
        };
        this.recordItem(result, failedNote, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        console.warn(`[GetNote] Failed to fetch append note ${childId}:`, err);
      }
    }
    return appendNotes;
  }

  private filterNotesByDateRange(notes: GetNoteNote[]): GetNoteNote[] {
    const { syncStartDate } = this.scopeOptions;
    if (!syncStartDate) return notes;

    const startTime = parseSyncBoundaryTime(syncStartDate);
    if (startTime === null) return notes;

    return notes.filter(note => {
      const updated = parseNoteUpdatedTime(note);
      return updated !== null && updated > startTime;
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
    const seenNoteIds = new Set<string>();
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
      const credentials = getAuthCredentials(this.settings);
      for await (const notes of fetchAllNotes(credentials.token, credentials.clientId, controller.signal, null, credentials.authMode)) {
        if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
        pageCount++;
        this.onProgress?.({ page: pageCount, percent: 0 });

        const recentNotes = this.filterRecentNotes(notes);
        const filtered = this.filterNotesByDateRange(recentNotes);

        for (const note of filtered) {
          if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
          if (seenNoteIds.has(note.note_id)) continue;
          seenNoteIds.add(note.note_id);
          result.total++;
          const noteToWrite = await this.enrichAudioNote(note, controller.signal);

          const appendNotes = await this.fetchAppendNotes(noteToWrite, controller.signal, result);
          const parentBaseName = this.buildBaseName(noteToWrite);
          const parentFileName = this.getFileName(noteToWrite);
          // 子文档完整文件名（用于父文档的 wiki 链接）
          const childFileNames = appendNotes.map(child => this.getFileName(child, parentBaseName));

          // 写入父文档（含子文档链接）
          const writeResult = await this.writeNote(noteToWrite, uidIndex, undefined, undefined, childFileNames);
          this.applyWriteResult(result, writeResult);
          this.recordItem(result, noteToWrite, writeResult);

          // 写入子文档（链接回父文档）
          for (const appendNote of appendNotes) {
            if (seenNoteIds.has(appendNote.note_id)) continue;
            seenNoteIds.add(appendNote.note_id);
            result.total++;
            const appendWriteResult = await this.writeNote(appendNote, uidIndex, parentBaseName, parentFileName);
            this.applyWriteResult(result, appendWriteResult);
            this.recordItem(result, appendNote, appendWriteResult);
          }

          const updatedTime = parseNoteUpdatedTime(note);
          if (updatedTime !== null && (lastNoteTimestampTime === null || updatedTime > lastNoteTimestampTime)) {
            lastNoteTimestampTime = updatedTime;
            result.lastNoteTimestamp = note.updated_at;
          }
        }

        // List APIs page by created_at DESC. Once the oldest created note in this page
        // is older than the cutoff, later pages can be skipped after this page's
        // still-valid notes have been processed.
        if (cutoffTime !== null && notes.length > 0 && isSortedByCreatedDesc(notes)) {
          const oldestNote = notes[notes.length - 1];
          const oldestTime = parseNoteCreatedTime(oldestNote);
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
    const seenNoteIds = new Set<string>();
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
      const credentials = getAuthCredentials(this.settings);
      for await (const batch of fetchAllNotes(credentials.token, credentials.clientId, controller.signal, null, credentials.authMode)) {
        if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();

        const matched = batch.filter(n => idSet.has(n.note_id));

        for (const note of matched) {
          if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
          if (seenNoteIds.has(note.note_id)) continue;
          seenNoteIds.add(note.note_id);

          fetchedCount++;
          result.total++;
          const percent = Math.round((fetchedCount / noteIds.length) * 100);
          this.onProgress?.({
            processed: fetchedCount,
            total: noteIds.length,
            percent,
          });
          // Pre-check: skip if note and attachments already exist and are up-to-date.
          // Uses UID-based lookup so renamed/moved files are still found.
          const preCheck = this.preCheckNote(note, uidIndex);
          if (preCheck.exists) {
            result.skipped++;
            this.recordItem(result, note, { status: 'skipped' });
            const mayHaveAppendNotes = (note.children_count ?? 0) > 0 || Boolean(note.children_ids?.length);
            if (!mayHaveAppendNotes) {
              continue;
            }
          }
          const noteToWrite = await this.enrichAudioNote(note, controller.signal);

          const appendNotes = await this.fetchAppendNotes(noteToWrite, controller.signal, result);
          const parentBaseName = this.buildBaseName(noteToWrite);
          const parentFileName = this.getFileName(noteToWrite);
          const childFileNames = appendNotes.map(child => this.getFileName(child, parentBaseName));

          if (!preCheck.exists) {
            const writeResult = await this.writeNote(noteToWrite, uidIndex, undefined, parentFileName, childFileNames);
            this.applyWriteResult(result, writeResult);
            this.recordItem(result, noteToWrite, writeResult);
          }

          // 写入子文档（链接回父文档）
          for (const appendNote of appendNotes) {
            if (seenNoteIds.has(appendNote.note_id)) continue;
            seenNoteIds.add(appendNote.note_id);
            result.total++;
            const appendWriteResult = await this.writeNote(appendNote, uidIndex, parentBaseName, parentFileName);
            this.applyWriteResult(result, appendWriteResult);
            this.recordItem(result, appendNote, appendWriteResult);
          }
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
