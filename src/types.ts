// Get笔记 API 响应类型

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
  assetFileName?: string;     // 内部使用：音频文件的文件名（不含扩展名）
  assetPaths?: string[];      // 内部使用：所有附件文件的完整路径（图片、音频等）
  prime_id?: string;          // Web API detail identifier
}

export interface Tag {
  name: string;
}

export type KnownNoteType =
  | 'plain_text'
  | 'img_text'
  | 'link'
  | 'recorder_audio'
  | 'recorder_flash_audio'
  | 'immediate_audio'
  | 'audio_long'
  | 'local_audio';

export type NoteType = KnownNoteType | (string & {});

export interface ListResponse {
  data: {
    notes: GetNoteNote[];
    has_more: boolean;
    next_cursor: string;
  };
}

// 内部使用类型

export interface ScheduledSyncSettings {
  enabled: boolean;
  intervalMinutes: number;
  syncOnStart: boolean;
  enabledNoteTypes?: string[];  // undefined = all types, empty array = no types
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
  maxDays: number;
  syncStartDate: string;  // ISO date string, empty means no limit
  lastSyncEndTimestamp: string;  // ISO datetime of last synced note's updated_at
  scheduledSync: ScheduledSyncSettings;
  syncHistory: SyncHistoryEntry[];
}

export interface SyncScopeOptions {
  maxDays: number;
  syncStartDate: string;
  enabledNoteTypes?: string[];
}

export interface SyncHistoryScope {
  maxDays: number;
  syncStartDate: string;
  enabledNoteTypes?: string[];
  selectedCount?: number;
  selectedIds?: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  authMode: 'openapi',
  openApiToken: '',
  openApiClientId: '',
  webApiToken: '',
  apiToken: '',
  clientId: '',
  webCsrfToken: '',
  folderName: 'Get笔记',
  filenamePrefix: '',
  maxDays: 30,
  syncStartDate: '',
  lastSyncEndTimestamp: '',
  scheduledSync: {
    enabled: false,
    intervalMinutes: 30,
    syncOnStart: true,
  },
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
  type: 'full' | 'selective' | 'auto';
  mode?: 'time' | 'selected' | 'auto';
  scope?: SyncHistoryScope;
  status: 'success' | 'failed' | 'cancelled';
  error?: string;
}

export interface SyncProgressDetail {
  message: string;
  count: string;
  percent: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  items?: SyncResultItem[];
  lastNoteTimestamp?: string;  // updated_at of the last processed note
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
export const NOTE_CATEGORIES: NoteCategory[] = [
  { dirName: '纯文本', noteType: 'plain_text' },
  { dirName: '图片笔记', noteType: 'img_text' },
  { dirName: '链接笔记', noteType: 'link' },
  { dirName: '即时录音', noteType: 'immediate_audio' },
  { dirName: '录音长录', noteType: 'recorder_audio' },
  { dirName: '录音长录', noteType: 'recorder_flash_audio' },
  { dirName: '录音长录', noteType: 'audio_long' },
  { dirName: '本地音频', noteType: 'local_audio' },
];

export function getCategoryDir(noteType: string): string {
  const found = NOTE_CATEGORIES.find(c => c.noteType === noteType);
  return found ? found.dirName : '其他';
}

export interface Attachment {
  type: 'audio' | 'image' | (string & {});
  url: string;
  title: string;
  duration?: number;  // milliseconds, only for audio
}
