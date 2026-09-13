// 得到大脑 API 响应类型

export interface GetNoteNote {
  id: string | number;  // OpenAPI: number → string via safeJsonParse; Web API: string
  note_id: string;
  parent_id?: string;
  children_count?: number;
  children_ids?: string[];
  is_child_note?: boolean;
  title: string;
  content: string;       // 正文（markdown），录音笔记为 AI 摘要
  note_type: NoteType;
  source: string;        // web | app
  tags: Tag[];
  created_at: string;    // "2026-04-27T22:26:17+08:00"
  updated_at: string;
  attachments?: Attachment[];  // 详情接口返回的附件列表
  audio?: string;             // 详情接口返回的原始转写文本
  linkOriginal?: LinkOriginal; // 链接笔记详情返回的网页原文
  assetFileName?: string;     // 内部使用：音频文件的文件名（不含扩展名）
  linkOriginalFileName?: string; // 内部使用：链接原文文件名（不含扩展名）
  assetPaths?: string[];      // 内部使用：所有附件文件的完整路径（图片、音频等）
  prime_id?: string;          // Web API detail identifier
  topic_id?: string;          // Knowledge-base topic identifier
  fetch_error?: string;       // Internal: per-note knowledge detail failure
  asset_error?: string;       // Internal: vault artifact conflict during enrichment
}

export interface LinkOriginal {
  title?: string;
  url?: string;
  content: string;
}

export interface Tag {
  name: string;
}

export interface SubscribedTopic {
  topic_id: string;
  name: string;
  source?: 'subscribed' | 'created';
}

export type KnownNoteType =
  | 'plain_text'
  | 'img_text'
  | 'link'
  | 'immediate_audio'
  | 'recorder_audio'
  | 'recorder_flash_audio'
  | 'audio_long'
  | 'local_audio'
  | 'audio'
  | 'class_audio'
  | 'internal_record'
  | 'meeting'
  | 'blogger_post';

export type NoteType = KnownNoteType | (string & {});

export interface ListResponse {
  data: {
    notes: GetNoteNote[];
    has_more: boolean;
    next_cursor: string;
  };
}

export interface RecallSearchResult {
  note_id: string;
  title: string;
  content: string;
  note_type: NoteType;
  updated_at?: string;
  created_at?: string;
  score?: number;
}

// 内部使用类型

export interface ScheduledSyncSettings {
  enabled: boolean;
  intervalMinutes: number;
  syncOnStart: boolean;
  enabledNoteTypes?: string[];  // undefined = all types, empty array = no types
  syncKnowledgeBases?: string[];  // empty / undefined = cross-KB sync disabled
}

export interface ReverseSyncSettings {
  /** Legacy two-way toggle; automatic upload now has its own opt-in. */
  enabled: boolean;
  uploadFolder?: string;
  autoUpload?: {
    enabled: boolean;
    mode: 'realtime' | 'interval';
    intervalMinutes: number;
  };
}

export type AttachmentKind = 'image' | 'audio' | 'video' | 'document' | 'other';

export interface AttachmentImportSettings {
  image: boolean;
  audio: boolean;
  audioTranscript?: boolean;
  video: boolean;
  document: boolean;
}

export const DEFAULT_ATTACHMENT_IMPORT: AttachmentImportSettings = {
  image: true,
  audio: true,
  audioTranscript: true,
  video: true,
  document: true,
};

export interface ApiQuotaState {
  exhausted: boolean;
  reason?: string;
  checkedAt?: number;
}

export type AuthMode = 'openapi' | 'web';

export interface Settings {
  authMode: AuthMode;
  openApiToken: string;
  openApiClientId: string;
  webApiToken: string;
  apiToken: string;
  clientId: string;
  webCsrfToken: string;
  folderName: string;
  filenamePrefix: string;
  datePathEnabled: boolean;
  datePathFormat: string;
  datePathCategoryOrigins: Record<string, { path: string; category: string }>;
  datePathAssetMoveEvidence: Record<string, {
    uid: string;
    sourcePath: string;
    targetPath: string;
  }>;
  templateFilePath: string;
  maxDays: number;
  syncStartDate: string;  // ISO date string, empty means no limit
  lastSyncEndTimestamp: string;  // ISO datetime of last synced note's updated_at
  scheduledSync: ScheduledSyncSettings;
  reverseSync: ReverseSyncSettings;
  attachmentImport: AttachmentImportSettings;
  ribbonActions: RibbonActionSettings;
  lastQuotaState?: ApiQuotaState;
  syncHistory: SyncHistoryEntry[];
  tagMigrationVersion: number;
  /**
   * Tag whitelist persisted at the settings level.
   * Empty array = no tag filter (sync all notes regardless of tags).
   */
  syncTags?: string[];
  /**
   * Local cache of tag names observed from previously synced notes. Used to
   * populate the tag dropdown without an extra network round trip.
   */
  tagCache?: TagCache;
  knowledgeBaseCache?: KnowledgeBaseCacheState;
}

export interface RibbonActionSettings {
  sync: boolean;
  search: boolean;
}

export interface TagCache {
  tags: string[];
  lastUpdated: number;
}

export interface SyncScopeOptions {
  maxDays: number;
  syncStartDate: string;
  enabledNoteTypes?: string[];
  /**
   * Tag whitelist. Empty/undefined means no tag-based filter.
   * Notes are kept when their tags intersect the whitelist (case-insensitive).
   */
  syncTags?: string[];
  syncKnowledgeBases?: string[];
  knowledgeBaseNames?: Record<string, string>;
  knowledgeBaseEntries?: Array<{ topicId: string; name: string; source?: 'subscribed' | 'created' }>;
}

export interface SyncHistoryScope {
  maxDays: number;
  syncStartDate: string;
  enabledNoteTypes?: string[];
  syncTags?: string[];
  selectedCount?: number;
  selectedIds?: string[];
}

export interface KnowledgeBaseCacheState {
  entries: { topicId: string; name: string; source?: 'subscribed' | 'created' }[];
  cacheUpdatedAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  authMode: 'openapi',
  openApiToken: '',
  openApiClientId: '',
  webApiToken: '',
  apiToken: '',
  clientId: '',
  webCsrfToken: '',
  folderName: '得到大脑',
  filenamePrefix: '',
  datePathEnabled: false,
  datePathFormat: 'YYYY/MM',
  datePathCategoryOrigins: {},
  datePathAssetMoveEvidence: {},
  templateFilePath: '',
  maxDays: 30,
  syncStartDate: '',
  lastSyncEndTimestamp: '',
  scheduledSync: {
    enabled: false,
    intervalMinutes: 30,
    syncOnStart: true,
  },
  reverseSync: {
    enabled: false,
    autoUpload: { enabled: false, mode: 'interval', intervalMinutes: 5 },
  },
  attachmentImport: { ...DEFAULT_ATTACHMENT_IMPORT },
  ribbonActions: {
    sync: true,
    search: true,
  },
  tagMigrationVersion: 0,
  syncHistory: [],
};

export interface AuthCredentials {
  token: string;
  clientId: string;
  authMode: AuthMode;
}

export function getAuthCredentials(settings: Settings): AuthCredentials {
  if (settings.authMode === 'web') {
    return {
      token: settings.webApiToken || settings.apiToken,
      clientId: '',
      authMode: 'web',
    };
  }

  return {
    token: settings.openApiToken || settings.apiToken,
    clientId: settings.openApiClientId || settings.clientId,
    authMode: 'openapi',
  };
}

export interface SyncHistoryEntry {
  id: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  timestamp: number;
  result: SyncResult;
  type: 'full' | 'selective' | 'auto' | 'upload';
  mode?: 'time' | 'selected' | 'knowledge-base' | 'auto' | 'local-upload' | 'date-path';
  scope?: SyncHistoryScope;
  status: 'success' | 'partial' | 'failed' | 'cancelled';
  error?: string;
}

export interface SyncProgressDetail {
  message: string;
  count: string;
  /** Undefined while the remote service has not reported a total yet. */
  percent?: number;
  phase?: 'active' | 'success' | 'failed' | 'cancelled';
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  items?: SyncResultItem[];
  lastNoteTimestamp?: string;  // updated_at of the last processed note
  checkpointBlocked?: boolean; // note-level failure requires retry from the existing durable checkpoint
  /**
   * Tag names observed on processed notes during the sync. Used to
   * incrementally update the local tag cache without an extra network call.
   */
  observedTags?: string[];
}

export interface SyncResultItem {
  noteId: string;
  title: string;
  noteType: string;
  updatedAt: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
}

export interface NoteCategory {
  dirName: string;
  noteType: string;
}

// note_type → 目录名映射
// 顶层目录统一为 5 个：纯文本 / 图片笔记 / 链接笔记 / 录音笔记 / 其他
// 订阅博主走"其他/订阅博主"子目录
// 内部 9 种 audio 类型（recorder_audio / recorder_flash_audio / immediate_audio /
// audio_long / local_audio / audio / class_audio / internal_record / meeting）
// 全部归入"录音笔记"，但 AUDIO_NOTE_TYPES 集合（sync.ts 内部使用）保持完整以解耦 UI 和 sync 逻辑
export const NOTE_CATEGORIES: NoteCategory[] = [
  { dirName: '纯文本', noteType: 'plain_text' },
  { dirName: '图片笔记', noteType: 'img_text' },
  { dirName: '链接笔记', noteType: 'link' },
  { dirName: '录音笔记', noteType: 'recorder_audio' },
  { dirName: '录音笔记', noteType: 'recorder_flash_audio' },
  { dirName: '录音笔记', noteType: 'immediate_audio' },
  { dirName: '录音笔记', noteType: 'audio_long' },
  { dirName: '录音笔记', noteType: 'local_audio' },
  { dirName: '录音笔记', noteType: 'audio' },
  { dirName: '录音笔记', noteType: 'class_audio' },
  { dirName: '录音笔记', noteType: 'internal_record' },
  { dirName: '录音笔记', noteType: 'meeting' },
  { dirName: '其他/订阅博主', noteType: 'blogger_post' },
];

export function getCategoryDir(noteType: string): string {
  const found = NOTE_CATEGORIES.find(c => c.noteType === noteType);
  return found ? found.dirName : '其他';
}

// 内部 9 种 audio 类型：用于把老用户的 enabledNoteTypes 一次性归到"录音笔记"组
// 重要：此集合与 sync.ts 中的 AUDIO_NOTE_TYPES 保持一致
export const INTERNAL_AUDIO_NOTE_TYPES: readonly string[] = [
  'recorder_audio',
  'recorder_flash_audio',
  'immediate_audio',
  'audio_long',
  'local_audio',
  'audio',
  'class_audio',
  'internal_record',
  'meeting',
];

export const CANONICAL_NOTE_TYPES: readonly string[] = [
  'plain_text',
  'img_text',
  'link',
  ...INTERNAL_AUDIO_NOTE_TYPES,
  'blogger_post',
];

/**
 * 老用户迁移：在 onload 阶段调用，把已保存的 enabledNoteTypes 统一为内部 note_type 集合。
 *
 * - 移除未知值（防御性，避免污染 sync 过滤）
 * - 保留所有规范内部类型（包括 9 种 audio）
 * - 保留已存在的 blogger_post（订阅博主从 UI 选项移除后仍默认同步）
 * - 数组空时（未选择任何类型）保持原样，由 sync 层显式视为"不限制"
 * - undefined 表示"全部类型"，保持原样
 */
export function migrateEnabledNoteTypes(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const valid = new Set(CANONICAL_NOTE_TYPES);
  return Array.from(new Set(value.filter(type => valid.has(type))));
}

export interface Attachment {
  type: 'audio' | 'image' | (string & {});
  url: string;
  title: string;
  duration?: number;  // milliseconds, only for audio
}
