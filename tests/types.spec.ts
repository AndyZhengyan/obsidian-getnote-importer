import { describe, it, expect } from 'vitest';
import { getCategoryDir, DEFAULT_SETTINGS, NOTE_CATEGORIES } from '../src/types';

describe('getCategoryDir', () => {
  it('plain_text → 纯文本', () => {
    expect(getCategoryDir('plain_text')).toBe('纯文本');
  });

  it('link → 链接笔记', () => {
    expect(getCategoryDir('link')).toBe('链接笔记');
  });

  it('immediate_audio → 即时录音', () => {
    expect(getCategoryDir('immediate_audio')).toBe('即时录音');
  });

  it('recorder_audio → 录音长录', () => {
    expect(getCategoryDir('recorder_audio')).toBe('录音长录');
  });

  it('recorder_flash_audio → 录音长录', () => {
    expect(getCategoryDir('recorder_flash_audio')).toBe('录音长录');
  });

  it('audio_long → 录音长录', () => {
    expect(getCategoryDir('audio_long')).toBe('录音长录');
  });

  it('local_audio → 本地音频', () => {
    expect(getCategoryDir('local_audio')).toBe('本地音频');
  });

  it('未知类型 → 其他', () => {
    expect(getCategoryDir('unknown_type')).toBe('其他');
  });

  it('空字符串 → 其他', () => {
    expect(getCategoryDir('')).toBe('其他');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('folderName 默认为 Get笔记', () => {
    expect(DEFAULT_SETTINGS.folderName).toBe('Get笔记');
  });

  it('maxDays 默认为 30', () => {
    expect(DEFAULT_SETTINGS.maxDays).toBe(30);
  });

  it('scheduledSync 默认关闭', () => {
    expect(DEFAULT_SETTINGS.scheduledSync.enabled).toBe(false);
  });

  it('syncHistory 默认空数组', () => {
    expect(DEFAULT_SETTINGS.syncHistory).toEqual([]);
  });

  it('scheduledSync 默认间隔 30 分钟', () => {
    expect(DEFAULT_SETTINGS.scheduledSync.intervalMinutes).toBe(30);
  });

  it('apiToken 和 clientId 默认空', () => {
    expect(DEFAULT_SETTINGS.authMode).toBe('openapi');
    expect(DEFAULT_SETTINGS.apiToken).toBe('');
    expect(DEFAULT_SETTINGS.clientId).toBe('');
    expect(DEFAULT_SETTINGS.webCsrfToken).toBe('');
  });
});

describe('NOTE_CATEGORIES', () => {
  it('每个分类目录名都不为空', () => {
    for (const cat of NOTE_CATEGORIES) {
      expect(cat.dirName).toBeTruthy();
    }
  });

  it('不包含重复映射', () => {
    const seen = new Set<string>();
    for (const cat of NOTE_CATEGORIES) {
      const key = `${cat.noteType}->${cat.dirName}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
