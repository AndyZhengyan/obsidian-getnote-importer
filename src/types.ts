// Get笔记 API 响应类型

export interface GetNoteNote {
  id: number;            // 64位整数，JSON 解析前需预处理
  note_id: string;       // 字符串版本，用于文件名
  title: string;
  content: string;       // 正文（markdown），录音笔记为 AI 摘要
  note_type: NoteType;
  source: string;        // web | app
  tags: Tag[];
  created_at: string;    // "2026-04-27T22:26:17+08:00"
  updated_at: string;
}

export interface Tag {
  name: string;
}

export type NoteType =
  | 'plain_text'
  | 'link'
  | 'recorder_audio'
  | 'recorder_flash_audio'
  | 'immediate_audio'
  | 'audio_long'
  | 'local_audio'
  | string;

export interface ListResponse {
  data: {
    notes: GetNoteNote[];
    has_more: boolean;
    next_cursor: string;
  };
}

// 内部使用类型

export type SyncMode = 'incremental' | 'full';

export interface Settings {
  apiToken: string;
  clientId: string;
  folderName: string;
  syncMode: SyncMode;
  maxDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiToken: '',
  clientId: '',
  folderName: 'Get笔记',
  syncMode: 'incremental',
  maxDays: 30,
};

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
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
