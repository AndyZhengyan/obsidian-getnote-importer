import { parseYaml, type App, type TFile } from 'obsidian';
import { addNotesToKnowledgeBase, createNote, fetchNoteDetail } from './api';
import { updateNote } from './api-clients/openapi-client';
import { createSourceHash, parseSourceBody, SOURCE_BODY_START, SOURCE_BODY_END } from './source-body';
import { renderNote } from './note-parser';
import { getAuthCredentials, getCategoryDir, type GetNoteNote, type Settings, type SyncResult, type SyncResultItem } from './types';
import { t } from './i18n';
import { buildCanonicalCategoryDir } from './date-paths';
import { getFileName } from './sync-paths';

export interface EditableContent { title: string; body: string; tags: string[] }
export interface LocalSyncNote extends EditableContent {
  uid: string; primeId?: string; baseline?: string; remoteBaseline?: string; raw: string; frontmatterEnd: number;
}
interface LocalDraft extends EditableContent { raw: string; frontmatterEnd: number; topicId?: string }
function parseDraftFields(text: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(text);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('bidirectional.invalid'));
  return parsed as Record<string, unknown>;
}
export type SyncDirection = 'equal' | 'upload' | 'download' | 'conflict';
export interface SyncOptions { direction?: 'upload' | 'download' | 'both'; paths?: string[]; folder?: string }
export type ConflictChoice = 'upload' | 'download' | 'skip';
export interface SyncConflict { path: string; local: EditableContent; remote: EditableContent }
export type ResolveSyncConflict = (conflict: SyncConflict) => Promise<ConflictChoice>;

export function insideSyncFolder(path: string, folder: string): boolean {
  const normalized = folder.replace(/^\/+|\/+$/g, '');
  return !normalized || path.startsWith(`${normalized}/`);
}
export function contentHash(note: EditableContent): string {
  return createSourceHash(note.title, note.tags, note.body);
}
export function syncDirection(local: string, remote: string, baseline?: string, remoteBaseline = baseline): SyncDirection {
  if (local === remote) return 'equal';
  if (!baseline) return 'conflict';
  if (local === baseline && remote === remoteBaseline) return 'equal';
  if (remote === remoteBaseline) return 'upload';
  if (local === baseline) return 'download';
  return 'conflict';
}
export function readSyncNote(raw: string, fallbackTitle = ''): LocalSyncNote | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!block) return null;
  const fm: unknown = parseYaml(block[1]);
  if (!fm || typeof fm !== 'object') return null;
  const fields = fm as Record<string, unknown>;
  if (typeof fields.uid !== 'string' || !fields.uid) return null;
  if (fields.note_type !== undefined && fields.note_type !== 'plain_text') throw new Error(t('bidirectional.unsupported'));
  const title = fields.title ?? fallbackTitle;
  const tags = fields.tags ?? [];
  if (typeof title !== 'string' || !Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw new Error(t('bidirectional.invalid'));
  }
  const source = parseSourceBody(raw.slice(block[0].length));
  if (source.kind === 'invalid' || (source.kind === 'absent' && fields.dedao_sync_schema !== undefined)) throw new Error(t('bidirectional.invalid'));
  return {
    uid: fields.uid, primeId: typeof fields.prime_id === 'string' ? fields.prime_id : undefined, title, tags: tags as string[], body: source.kind === 'valid' ? source.body : raw.slice(block[0].length),
    baseline: typeof fields.dedao_bidirectional_hash === 'string' ? fields.dedao_bidirectional_hash
      : typeof fields.dedao_source_hash === 'string' ? fields.dedao_source_hash : undefined,
    remoteBaseline: typeof fields.dedao_remote_hash === 'string' ? fields.dedao_remote_hash : undefined,
    raw, frontmatterEnd: block[0].length,
  };
}

function readLocalDraft(raw: string, fallbackTitle: string, prepared?: EditableContent): LocalDraft {
  if (!raw.trim()) throw new Error(t('reverseSync.skip.emptyBody'));
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!block && /^---\r?\n/.test(raw)) throw new Error(t('bidirectional.invalid'));
  if (!block) return { title: fallbackTitle, tags: [], body: raw, raw, frontmatterEnd: 0 };
  const fields = parseDraftFields(block[1]);
  if (!Object.keys(fields).length) return { title: fallbackTitle, tags: [], body: raw, raw, frontmatterEnd: 0 };
  if (fields.uid !== undefined || fields.prime_id !== undefined || fields.dedao_sync_schema !== undefined
    || fields.dedao_source_hash !== undefined || fields.dedao_upload_state !== undefined) throw new Error(t('bidirectional.uploadUncertain'));
  if (fields.note_type !== undefined && fields.note_type !== 'plain_text') throw new Error(t('bidirectional.unsupported'));
  const title = typeof fields.title === 'string' && fields.title.trim() ? fields.title : fallbackTitle;
  const topicId = typeof fields.topic_id === 'string' && fields.topic_id.trim() ? fields.topic_id : undefined;
  const tags = Array.isArray(fields.tags) ? fields.tags : prepared?.tags ?? fields.tags ?? [];
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) throw new Error(t('bidirectional.invalid'));
  const remainder = raw.slice(block[0].length);
  const source = parseSourceBody(remainder);
  if (source.kind === 'invalid') throw new Error(t('bidirectional.invalid'));
  const body = source.kind === 'valid' ? source.body : remainder;
  if (!body.trim()) throw new Error(t('bidirectional.invalid'));
  return { title, tags: tags as string[], body, raw, frontmatterEnd: block[0].length, topicId };
}

function uploadFields(raw: string, values: Record<string, unknown>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const block = match && Object.keys(parseDraftFields(match[1])).length ? match : null;
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  if (!block) {
    return `---${newline}${Object.entries(values).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(newline)}${newline}---${newline}${raw}`;
  }
  let header = block[0];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}: ${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}:[^\\r\\n]*(?:\\r?\\n(?:[ \\t]+[^\\r\\n]*|-[ \\t]+[^\\r\\n]*))*`, 'm');
    header = pattern.test(header) ? header.replace(pattern, () => line) : header.replace(/---(\r?\n)?$/, () => `${line}${newline}---${newline}`);
  }
  return header + raw.slice(block[0].length);
}

// Replace only managed scalar/list fields and the marked source body. Preserve
// user frontmatter, appendix, links and the file path byte-for-byte.
export function replaceSyncContent(local: LocalSyncNote, next: EditableContent, remoteHash = contentHash(next)): string {
  if (next.body.includes(SOURCE_BODY_START) || next.body.includes(SOURCE_BODY_END)) throw new Error(t('bidirectional.invalid'));
  let header = local.raw.slice(0, local.frontmatterEnd);
  const newline = header.includes('\r\n') ? '\r\n' : '\n';
  const fields: Record<string, unknown> = {
    title: next.title, tags: next.tags, dedao_source_hash: contentHash(next), dedao_bidirectional_hash: contentHash(next), dedao_remote_hash: remoteHash,
  };
  for (const [key, value] of Object.entries(fields)) {
    // Consume an existing block-style YAML list as well as flow/scalar values.
    const pattern = new RegExp(`^${key}:[^\\r\\n]*(?:\\r?\\n(?:[ \\t]+[^\\r\\n]*|-[ \\t]+[^\\r\\n]*))*`, 'm');
    const line = `${key}: ${JSON.stringify(value)}`;
    header = pattern.test(header) ? header.replace(pattern, () => line)
      : header.replace(/---(\r?\n)?$/, () => `${line}${newline}---${newline}`);
  }
  const remainder = local.raw.slice(local.frontmatterEnd);
  if (parseSourceBody(remainder).kind === 'absent') return header + next.body;
  const start = remainder.indexOf(SOURCE_BODY_START) + SOURCE_BODY_START.length;
  const end = remainder.indexOf(SOURCE_BODY_END);
  return header + remainder.slice(0, start) + newline + next.body.replace(/\r\n?/g, '\n').replace(/\n/g, newline) + newline + remainder.slice(end);
}

function remoteContent(note: Partial<GetNoteNote>, uid: string): EditableContent {
  if (typeof note.title !== 'string' || typeof note.content !== 'string' || note.note_type !== 'plain_text' || !Array.isArray(note.tags)) {
    throw new Error(t('bidirectional.unsupported'));
  }
  const id = note.note_id ?? note.id;
  if (id !== undefined && String(id) !== uid) throw new Error(t('bidirectional.invalid'));
  // Compare the same projection that the importer writes (title and tag normalization).
  const projected = readSyncNote(renderNote({ ...note, note_id: uid, id: uid,
    created_at: note.created_at ?? '', updated_at: note.updated_at ?? '', source: note.source ?? '',
  } as GetNoteNote));
  if (!projected) throw new Error(t('bidirectional.invalid'));
  return projected;
}

// Old importer versions had no source markers and appended relation links.
// Bootstrap only a byte-equivalent body (apart from edge whitespace and known
// generated relation links), never use modification times as overwrite authority.
function bootstrapLegacy(local: LocalSyncNote, remote: EditableContent): string | undefined {
  if (local.baseline || parseSourceBody(local.raw.slice(local.frontmatterEnd)).kind !== 'absent') return undefined;
  const fields = parseDraftFields(local.raw.slice(0, local.frontmatterEnd).replace(/^---\r?\n/, '').replace(/\r?\n---(?:\r?\n)?$/, ''));
  const imported = fields.source === '得到大脑' && fields.created !== undefined;
  const fallback = remote.body.slice(0, 10).replace(/[\\/:*?"<>|]/g, '').trim();
  if (local.title !== remote.title && !(imported && local.title.trim() === fallback)) return undefined;
  if (createSourceHash('', local.tags, '') !== createSourceHash('', remote.tags, '')) return undefined;
  const body = local.body.replace(/\r\n?/g, '\n');
  const core = remote.body.replace(/\r\n?/g, '\n').trim();
  if (!core || !body.trimStart().startsWith(core)) return undefined;
  const start = body.length - body.trimStart().length;
  const suffix = body.slice(start + core.length);
  if (suffix.trim() && !(imported && /^(?:\s*> (?:⬆️ 主笔记|⬇️ 追加笔记): \[\[[^\]\r\n]+\]\])*\s*$/.test(suffix))) return undefined;
  const marked = local.raw.slice(0, local.frontmatterEnd) + body.slice(0, start)
    + SOURCE_BODY_START + '\n' + core + '\n' + SOURCE_BODY_END + suffix;
  const hash = contentHash({ ...local, body: core });
  return uploadFields(marked, { dedao_sync_schema: 1, dedao_source_hash: hash, dedao_bidirectional_hash: hash, dedao_remote_hash: contentHash(remote) });
}

export function isRemoteNoteMissing(error: unknown): boolean {
  return error instanceof Error && /笔记不存在|note.*(?:not found|does not exist)|\b404\b/i.test(error.message);
}

export class BidirectionalSyncEngine {
  private controller = new AbortController();
  constructor(private app: App, private settings: Settings, private resolve?: ResolveSyncConflict) {}
  cancel(): void { this.controller.abort(); }
  private checkCancelled(): void {
    if (this.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  private uploadTarget(draft: LocalDraft, categoryOverride?: string): string {
    const createdAt = new Date().toISOString();
    const note = { note_id: '', id: '', title: draft.title, content: draft.body, tags: draft.tags.map(name => ({ name })),
      note_type: 'plain_text', source: 'app', created_at: createdAt, updated_at: createdAt } as GetNoteNote;
    const category = categoryOverride ?? getCategoryDir(note.note_type);
    const dir = this.settings.datePathEnabled
      ? buildCanonicalCategoryDir(this.settings.folderName, category, createdAt, this.settings.datePathFormat)
      : `${this.settings.folderName}/${category}`;
    return `${dir}/${getFileName(note, this.settings)}.md`;
  }
  private knowledgeBaseForFile(file: TFile, fields: Record<string, unknown>): { topicId: string; writable: boolean; categoryDir: string } | undefined {
    const explicit = typeof fields.topic_id === 'string' && fields.topic_id.trim() ? fields.topic_id.trim() : undefined;
    const entries = this.settings.knowledgeBaseCache?.entries ?? [];
    const byId = explicit ? entries.find(entry => entry.topicId === explicit) : undefined;
    if (explicit && !byId) throw new Error(t('bidirectional.knowledgeBaseMissing'));
    if (byId) return { topicId: byId.topicId, writable: byId.source !== 'subscribed', categoryDir: `知识库/${byId.name.replace(/[\\/:*?"<>|]/g, '_').trim()}` };
    const parts = file.path.split('/');
    const index = parts.indexOf('知识库');
    if (index < 0 || !parts[index + 1]) return undefined;
    const name = parts[index + 1];
    const matches = entries.filter(item => item.name.replace(/[\\/:*?"<>|]/g, '_').trim() === name);
    if (matches.length > 1) throw new Error(t('bidirectional.knowledgeBaseMissing'));
    const entry = matches[0];
    return entry ? { topicId: entry.topicId, writable: entry.source !== 'subscribed', categoryDir: `知识库/${name}` } : { topicId: '', writable: false, categoryDir: `知识库/${name}` };
  }
  private async archive(file: TFile, targetPath: string): Promise<void> {
    if ((!insideSyncFolder(targetPath, this.settings.folderName) && targetPath !== file.path) || targetPath.split('/').some(part => !part || part === '.' || part === '..')
      || targetPath.includes('\\') || !targetPath.endsWith('.md')) throw new Error(t('bidirectional.invalid'));
    if (targetPath !== file.path) {
      if (this.app.vault.getAbstractFileByPath(targetPath)) throw new Error(t('settings.datePath.issue.targetConflict'));
      const dir = targetPath.slice(0, targetPath.lastIndexOf('/'));
      if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
      await this.app.fileManager.renameFile(file, targetPath);
    }
    await this.app.vault.process(file, raw => uploadFields(raw, { dedao_upload_state: 'complete' }));
  }
  async uploadNewFile(file: TFile, prepared?: EditableContent & { raw: string }, options?: { folder?: string }): Promise<SyncResultItem> {
    const auth = getAuthCredentials(this.settings);
    if (auth.authMode !== 'openapi') throw new Error(t('bidirectional.openApiOnly'));
    const raw = await this.app.vault.read(file);
    if (!insideSyncFolder(file.path, options?.folder ?? this.settings.folderName)) throw new Error(t('bidirectional.invalid'));
    if (prepared && prepared.raw !== raw) throw new Error(t('bidirectional.changed'));
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    const fields = block ? parseDraftFields(block[1]) : {};
    if ((fields?.dedao_upload_state === 'archive' || fields?.dedao_upload_state === 'attach')
      && typeof fields.uid === 'string' && typeof fields.dedao_upload_target === 'string') {
      if (fields.dedao_upload_state === 'attach') {
        const knowledgeBase = this.knowledgeBaseForFile(file, fields);
        if (!knowledgeBase?.topicId) throw new Error(t('bidirectional.knowledgeBaseMissing'));
        if (!knowledgeBase.writable) throw new Error(t('bidirectional.knowledgeBaseReadOnly'));
        await addNotesToKnowledgeBase({ token: auth.token, clientId: auth.clientId, topicId: knowledgeBase.topicId,
          noteIds: [fields.uid], authMode: auth.authMode, signal: this.controller.signal });
        await this.app.vault.process(file, current => uploadFields(current, { dedao_upload_state: 'archive' }));
      }
      await this.archive(file, fields.dedao_upload_target);
      return { noteId: fields.uid, title: file.basename, noteType: 'plain_text', updatedAt: '', status: 'updated' };
    }
    const draft = readLocalDraft(raw, file.basename || file.path.split('/').pop()!.replace(/\.md$/i, ''), prepared);
    const knowledgeBase = this.knowledgeBaseForFile(file, fields);
    if (knowledgeBase && !knowledgeBase.topicId) throw new Error(t('bidirectional.knowledgeBaseMissing'));
    if (knowledgeBase && !knowledgeBase.writable) throw new Error(t('bidirectional.knowledgeBaseReadOnly'));
    const submitted: EditableContent = prepared ?? { ...draft, tags: [...new Set(draft.tags.map(tag => tag.trim()).filter(Boolean))].slice(0, 10),
      body: draft.body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, target: string) => `[${alt.trim() || target.trim()}](${target.trim()})`) };
    const targetPath = insideSyncFolder(file.path, this.settings.folderName)
      ? this.uploadTarget(draft, knowledgeBase?.categoryDir).replace(/^\//, '') : file.path;
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing && existing !== file) throw new Error(t('settings.datePath.issue.targetConflict'));
    const hash = contentHash(draft);
    const remoteHash = contentHash(remoteContent({ id: 'projection', title: submitted.title, content: submitted.body, tags: submitted.tags.map(name => ({ name })), note_type: 'plain_text' }, 'projection'));
    this.checkCancelled();
    // Persist intent before POST. If its outcome is unknown, never blindly repeat
    // a non-idempotent create request, including after a restart.
    const pending = uploadFields(raw, { title: draft.title, ...(knowledgeBase ? { topic_id: knowledgeBase.topicId } : {}),
      dedao_upload_state: 'pending', dedao_upload_target: targetPath });
    await this.app.vault.process(file, current => {
      if (current !== raw) throw new Error(t('bidirectional.changed'));
      return pending;
    });
    const created = await createNote({ token: auth.token, clientId: auth.clientId, authMode: auth.authMode,
      title: submitted.title, content: submitted.body, noteType: 'plain_text', tags: submitted.tags, signal: this.controller.signal });
    // Save identity even after cancellation or concurrent edits. Preserve current
    // text, using the submitted snapshot only as the merge baseline.
    try {
      await this.app.vault.process(file, current => uploadFields(current, {
        uid: created.noteId, note_type: 'plain_text', dedao_source_hash: hash, dedao_bidirectional_hash: hash,
        dedao_remote_hash: remoteHash,
        ...(knowledgeBase ? { topic_id: knowledgeBase.topicId, dedao_upload_state: 'attach' } : { dedao_upload_state: 'archive' }),
        dedao_upload_target: targetPath,
      }));
    } catch {
      throw new Error(t('bidirectional.uploadSaveFailed', { uid: created.noteId }));
    }
    if (knowledgeBase) {
      await addNotesToKnowledgeBase({ token: auth.token, clientId: auth.clientId, topicId: knowledgeBase.topicId,
        noteIds: [created.noteId], authMode: auth.authMode, signal: this.controller.signal });
      await this.app.vault.process(file, current => uploadFields(current, { dedao_upload_state: 'archive' }));
    }
    this.checkCancelled();
    await this.archive(file, targetPath);
    return { noteId: created.noteId, title: draft.title, noteType: 'plain_text', updatedAt: '', status: 'created' };
  }
  async sync(selectedIds?: string[], options: SyncOptions = {}): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
    if (!options.direction && !this.settings.reverseSync.enabled) return result;
    const mode = options.direction ?? 'both';
    const folder = options.folder ?? this.settings.folderName;
    const inScope = (file: TFile) => insideSyncFolder(file.path, folder);
    const auth = getAuthCredentials(this.settings);
    if (mode !== 'download' && auth.authMode !== 'openapi') throw new Error(t('bidirectional.openApiOnly'));
    const files = this.app.vault.getMarkdownFiles().filter(file => inScope(file) && (!options.paths || options.paths.includes(file.path)));
    const entries: Array<{ file: TFile; local: LocalSyncNote }> = [];
    const drafts: TFile[] = [];
    const counts = new Map<string, number>();
    for (const file of files) {
      this.checkCancelled();
      try {
        const raw = await this.app.vault.read(file);
        const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
        const metadata = block ? parseDraftFields(block[1]) : {};
        if (selectedIds && (typeof metadata.uid !== 'string' || !selectedIds.includes(metadata.uid))) continue;
        if (metadata.note_type !== undefined && metadata.note_type !== 'plain_text') continue;
        const local = readSyncNote(raw, file.basename);
        if (mode !== 'download' && local && (metadata.dedao_upload_state === 'archive' || metadata.dedao_upload_state === 'attach')) {
          await this.uploadNewFile(file, undefined, { folder });
        }
        if (!local) {
          if (mode === 'download' || selectedIds || file.path.split('/').some(part => part === 'asset' || part === 'assets' || part === '_original' || part.startsWith('.'))) continue;
          readLocalDraft(raw, file.basename);
          drafts.push(file);
          continue;
        }
        if (selectedIds && !selectedIds.includes(local.uid)) continue;
        entries.push({ file, local: readSyncNote(await this.app.vault.read(file), file.basename)! }); counts.set(local.uid, (counts.get(local.uid) ?? 0) + 1);
      } catch (error) {
        this.checkCancelled();
        // Unsupported files are visible, but never written through the text API.
        result.skipped++; result.total++;
        result.items!.push({ noteId: file.path, title: file.basename, noteType: '', updatedAt: '', status: 'skipped', error: String(error) });
      }
    }
    for (const file of drafts) {
      this.checkCancelled();
      result.total++;
      const item = await (async (): Promise<SyncResultItem> => {
        try {
          return await this.uploadNewFile(file, undefined, { folder });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          return { noteId: file.path, title: file.basename, noteType: 'plain_text', updatedAt: '', status: 'failed', error: error instanceof Error ? error.message : String(error) };
        }
      })();
      result[item.status]++;
      result.items!.push(item);
    }
    for (const entry of entries) {
      const { file } = entry;
      let { local } = entry;
      this.checkCancelled();
      const item: SyncResultItem = { noteId: local.uid, title: local.title, noteType: 'plain_text', updatedAt: '', status: 'skipped' };
      result.total++;
      try {
        if (counts.get(local.uid) !== 1) throw new Error(t('bidirectional.duplicate'));
        if (mode === 'upload' && local.baseline === contentHash(local)) {
          result.skipped++; result.items!.push(item);
          continue;
        }
        if (auth.authMode === 'web' && !local.primeId) throw new Error(t('reverseSync.skip.missingWebDetailId'));
        const getRemote = async () => remoteContent(await fetchNoteDetail(auth.authMode === 'web' ? local.primeId! : local.uid, auth.token, auth.clientId, this.controller.signal, auth.authMode), local.uid);
        const remote = await getRemote();
        const bootstrapped = bootstrapLegacy(local, remote);
        if (bootstrapped) {
          await this.app.vault.process(file, current => {
            if (current !== local.raw) throw new Error(t('bidirectional.changed'));
            return bootstrapped;
          });
          local = readSyncNote(bootstrapped, file.basename)!;
        }
        let direction: SyncDirection | 'skip' = syncDirection(contentHash(local), contentHash(remote), local.baseline, local.remoteBaseline);
        if (direction === 'conflict' && !local.baseline && !this.resolve) {
          item.status = 'skipped'; item.error = t('bidirectional.baselineMissing');
          result[item.status]++; result.items!.push(item);
          continue;
        }
        if (direction === 'conflict') direction = this.resolve
          ? await this.resolve({ path: file.path, local, remote }) : 'skip';
        this.checkCancelled();
        if ((mode === 'download' && direction === 'upload') || (mode === 'upload' && direction === 'download')) {
          result.skipped++; result.items!.push(item);
          continue;
        }
        if (direction === 'skip') {
          item.status = 'failed'; item.error = t('bidirectional.conflict');
        } else {
          // A preview or HTTP request may outlive edits in either side.
          if (!inScope(file) || this.app.vault.getAbstractFileByPath(file.path) !== file
            || await this.app.vault.read(file) !== local.raw) throw new Error(t('bidirectional.changed'));
          if (direction !== 'equal' && contentHash(await getRemote()) !== contentHash(remote)) throw new Error(t('bidirectional.changed'));
          this.checkCancelled();
          if (!inScope(file) || this.app.vault.getAbstractFileByPath(file.path) !== file
            || await this.app.vault.read(file) !== local.raw) throw new Error(t('bidirectional.changed'));
          let next: EditableContent = direction === 'download' ? remote : local;
          if (direction === 'upload') {
            const tagsChanged = createSourceHash('', local.tags, '') !== createSourceHash('', remote.tags, '');
            await updateNote({ token: auth.token, clientId: auth.clientId, id: local.uid, signal: this.controller.signal,
              ...(local.title !== remote.title ? { title: local.title } : {}),
              ...(local.body !== remote.body ? { content: local.body } : {}),
              ...(tagsChanged ? { tags: local.tags } : {}),
            });
            const verified = await getRemote();
            if (contentHash(verified) !== contentHash(local)) throw new Error(t('bidirectional.unconfirmed'));
            next = verified;
          }
          this.checkCancelled();
          const updated = replaceSyncContent(local, next, direction === 'upload' ? contentHash(next) : contentHash(remote));
          if (updated !== local.raw) await this.app.vault.process(file, current => {
            if (current !== local.raw) throw new Error(t('bidirectional.changed'));
            return updated;
          });
          if (direction !== 'equal') item.status = 'updated';
        }
      } catch (error) {
        this.checkCancelled();
        item.status = isRemoteNoteMissing(error) ? 'skipped' : 'failed';
        item.error = isRemoteNoteMissing(error) ? t('bidirectional.remoteMissing') : error instanceof Error ? error.message : String(error);
      }
      result[item.status]++; result.items!.push(item);
    }
    return result;
  }
}
