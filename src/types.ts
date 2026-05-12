// Get笔记 API 响应类型

export interface GetNoteNote {
  id: number;            // 64位整数，JSON 解析前需预处理
  note_id: string;
  title: string;
  content: string;       // 正文（markdown），录音笔记为 AI 摘要
  note_type: NoteType;
  source: string;        // web | app
  tags: Tag[];
  created_at: string;    // "2026-04-27T22:26:17+08:00"
  updated_at: string;
  attachments?: Attachment[];  // 详情接口返回的附件列表
  audio?: string;             // 详情接口返回的原始转写文本
  assetFileName?: string;     // 内部使用：音频/转写文件的文件名（含前缀）
}

export interface Tag {
  name: string;
}

export type KnownNoteType =
  | 'plain_text'
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
}

export interface Settings {
  apiToken: string;
  clientId: string;
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
  checkpointTime?: string;  // for auto sync: the lastSyncEndTimestamp used as cutoff, for display in history
}

export interface SyncHistoryScope {
  maxDays: number;
  syncStartDate: string;
  selectedCount?: number;
  selectedIds?: string[];
  checkpointTime?: string;  // lastNoteTimestamp from auto sync, used for display label
}

export const DEFAULT_SETTINGS: Settings = {
  apiToken: '',
  clientId: '',
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
  type: 'audio' | (string & {});
  url: string;
  title: string;
  duration: number;  // 毫秒
}
