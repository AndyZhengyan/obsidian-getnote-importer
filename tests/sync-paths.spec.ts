import { describe, expect, it } from 'vitest';
import { buildNoteBaseName, getAudioAssetBaseName, getFileName, getFilePath, getKnowledgeBaseDir } from '../src/sync-paths';
import type { GetNoteNote, Settings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    authMode: 'openapi',
    openApiToken: '',
    openApiClientId: '',
    webApiToken: '',
    apiToken: 'test-token',
    clientId: 'test-client',
    webCsrfToken: '',
    folderName: '得到大脑',
    templateFilePath: '',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    filenamePrefix: '',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
    syncHistory: [],
    ...overrides,
  };
}

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: 1,
    note_id: 'note_001',
    title: '测试笔记',
    content: '正文内容',
    note_type: 'plain_text',
    source: 'app',
    tags: [],
    created_at: '2026-04-27T22:26:17+08:00',
    updated_at: '2026-04-28T10:00:00+08:00',
    ...overrides,
  };
}

describe('sync path helpers', () => {
  it('derives note filenames from the display title when no prefix is configured', () => {
    expect(getFileName(makeNote({ title: '我的笔记' }), makeSettings({ filenamePrefix: '' }))).toBe('我的笔记');
  });

  it('derives note filenames with formatted timestamp prefixes', () => {
    expect(getFileName(makeNote({ title: '我的笔记' }), makeSettings({ filenamePrefix: 'YYYY-MM-DD' }))).toBe('2026-04-27_我的笔记');
  });

  it('falls back to the display title when a timestamp prefix cannot be formatted', () => {
    expect(getFileName(makeNote({ title: '我的笔记', created_at: 'invalid' }), makeSettings({ filenamePrefix: 'YYYY-MM-DD' }))).toBe('我的笔记');
  });

  it('derives child note filenames from the parent base name and child title', () => {
    const settings = makeSettings({ filenamePrefix: 'getnote' });
    const child = makeNote({
      title: '原笔记标题',
      note_id: '1909246675068292528',
      parent_id: '1909193892067130512',
      is_child_note: true,
    });

    expect(getFileName(child, settings)).toBe('getnote_原笔记标题');
    expect(getFileName(child, settings, 'getnote_主笔记标题')).toBe('getnote_主笔记标题__原笔记标题');
  });

  it('derives vault and asset paths without changing existing naming rules', () => {
    const note = makeNote({ note_id: 'audio:001', title: '录音/标题' });
    const settings = makeSettings({ filenamePrefix: '' });

    expect(buildNoteBaseName(note, settings)).toBe('录音标题');
    expect(getFilePath('得到大脑/录音笔记', note, settings)).toBe('得到大脑/录音笔记/录音标题.md');
    expect(getAudioAssetBaseName(note, settings)).toBe('录音标题_audio_001');
  });

  it('derives knowledge base directories with the legacy unsafe-character replacement', () => {
    expect(getKnowledgeBaseDir('A/B:C*D?E"F<G>H|I')).toBe('知识库/A_B_C_D_E_F_G_H_I');
    expect(getKnowledgeBaseDir('   ')).toBe('知识库/(无标题)');
  });

  it('treats every remote folder name as a single safe local segment', () => {
    expect(getKnowledgeBaseDir('工作', ['../归档', 'asset', 'CON', '..', '尾随.']))
      .toBe('知识库/工作/__归档/_asset/_CON/_/尾随_');
  });
});
