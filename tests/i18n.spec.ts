import { describe, it, expect, beforeEach } from 'vitest';
import * as i18n from '../src/i18n';

describe('initI18n', () => {
  it('sets locale to zh for zh-CN', () => {
    i18n.initI18n('zh-CN');
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });

  it('sets locale to zh for zh-TW', () => {
    i18n.initI18n('zh-TW');
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });

  it('sets locale to zh for Chinese locale string', () => {
    i18n.initI18n('简体中文');
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });

  it('sets locale to en for en', () => {
    i18n.initI18n('en');
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });

  it('sets locale to en for en-US', () => {
    i18n.initI18n('en-US');
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });

  it('sets locale to en for unknown locale', () => {
    i18n.initI18n('fr-FR');
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });
});

describe('t() - Chinese translations', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('returns Chinese for settings.title', () => {
    expect(i18n.t('settings.title')).toBe('Get笔记导入');
  });

  it('returns Chinese for settings.desc', () => {
    expect(i18n.t('settings.desc')).toBe('🔄 Get笔记 → Obsidian，一键迁移无负担');
  });

  it('returns Chinese for settings.community', () => {
    expect(i18n.t('settings.community')).toBe('欢迎交流');
  });

  it('returns Chinese for sync.start', () => {
    expect(i18n.t('sync.start')).toBe('立即同步');
  });

  it('returns Chinese for sync.syncing', () => {
    expect(i18n.t('sync.syncing')).toBe('同步中...');
  });

  it('returns Chinese for picker.title', () => {
    expect(i18n.t('picker.title')).toBe('选择要同步的笔记');
  });

  it('returns Chinese for modal.done', () => {
    expect(i18n.t('modal.done')).toBe('同步完成');
  });

  it('returns Chinese for notice.autoSyncFailed', () => {
    expect(i18n.t('notice.autoSyncFailed')).toBe('[GetNote] 自动同步失败');
  });

  it('returns Chinese for error.invalidCredentials', () => {
    expect(i18n.t('error.invalidCredentials')).toBe('API Token 或 Client ID 无效，请检查设置');
  });
});

describe('t() - English translations', () => {
  beforeEach(() => {
    i18n.initI18n('en-US');
  });

  it('returns English for settings.desc', () => {
    expect(i18n.t('settings.desc')).toBe('🔄 Get笔记 → Obsidian，one-click migration');
  });

  it('returns English for settings.community', () => {
    expect(i18n.t('settings.community')).toBe('Welcome to discuss');
  });

  it('returns English for sync.start', () => {
    expect(i18n.t('sync.start')).toBe('Sync Now');
  });

  it('returns English for sync.syncing', () => {
    expect(i18n.t('sync.syncing')).toBe('Syncing...');
  });

  it('returns English for picker.title', () => {
    expect(i18n.t('picker.title')).toBe('Select notes to sync');
  });

  it('returns English for modal.done', () => {
    expect(i18n.t('modal.done')).toBe('Sync Complete');
  });

  it('returns English for notice.autoSyncFailed', () => {
    expect(i18n.t('notice.autoSyncFailed')).toBe('[GetNote] Auto sync failed');
  });

  it('returns English for error.invalidCredentials', () => {
    expect(i18n.t('error.invalidCredentials')).toBe('Invalid API Token or Client ID, please check settings');
  });
});

describe('t() - Variable substitution', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('substitutes single variable', () => {
    expect(i18n.t('picker.selected', { count: 5 })).toBe('已选 5 条');
  });

  it('substitutes multiple variables', () => {
    expect(i18n.t('modal.created', { created: 3 })).toBe('新增 3');
  });

  it('handles zero count', () => {
    expect(i18n.t('picker.selected', { count: 0 })).toBe('已选 0 条');
  });

  it('leaves unreplaced variables as placeholders', () => {
    expect(i18n.t('picker.selected', {})).toBe('已选 {count} 条');
  });

  it('substitutes English variables', () => {
    i18n.initI18n('en-US');
    expect(i18n.t('picker.selected', { count: 42 })).toBe('42 selected');
  });
});

describe('t() - Note type labels', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('returns correct Chinese type labels', () => {
    expect(i18n.t('picker.type.plain_text')).toBe('纯文本');
    expect(i18n.t('picker.type.link')).toBe('链接笔记');
    expect(i18n.t('picker.type.recorder_audio')).toBe('录音长录');
    expect(i18n.t('picker.type.immediate_audio')).toBe('即时录音');
    expect(i18n.t('picker.type.local_audio')).toBe('本地音频');
    expect(i18n.t('picker.type.unknown')).toBe('其他');
  });

  it('returns correct English type labels', () => {
    i18n.initI18n('en-US');
    expect(i18n.t('picker.type.plain_text')).toBe('Plain Text');
    expect(i18n.t('picker.type.link')).toBe('Link Note');
    expect(i18n.t('picker.type.recorder_audio')).toBe('Long Recording');
    expect(i18n.t('picker.type.immediate_audio')).toBe('Instant Recording');
    expect(i18n.t('picker.type.local_audio')).toBe('Local Audio');
    expect(i18n.t('picker.type.unknown')).toBe('Other');
  });
});

describe('t() - Fallback for missing keys', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('returns the key itself for unknown keys', () => {
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('returns empty string for empty key', () => {
    expect(i18n.t('')).toBe('');
  });
});

describe('t() - New picker keys', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('picker.loadMore with count', () => {
    expect(i18n.t('picker.loadMore', { count: 50 })).toBe('加载更多 (共 50 条)');
  });

  it('picker.loadingMore', () => {
    expect(i18n.t('picker.loadingMore')).toBe('加载更多...');
  });

  it('picker.search', () => {
    expect(i18n.t('picker.search')).toBe('搜索笔记...');
  });

  it('picker.noMatch', () => {
    expect(i18n.t('picker.noMatch')).toBe('没有匹配的笔记');
  });

  it('picker.loadMore in English', () => {
    i18n.initI18n('en');
    expect(i18n.t('picker.loadMore', { count: 50 })).toBe('Load more (50 total)');
  });

  it('picker.search in English', () => {
    i18n.initI18n('en');
    expect(i18n.t('picker.search')).toBe('Search notes...');
  });

  it('picker.noMatch in English', () => {
    i18n.initI18n('en');
    expect(i18n.t('picker.noMatch')).toBe('No matching notes');
  });
});

describe('t() - New settings keys', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('settings.testConnection', () => {
    expect(i18n.t('settings.testConnection')).toBe('测试连接');
  });

  it('settings.testingConnection', () => {
    expect(i18n.t('settings.testingConnection')).toBe('测试中...');
  });

  it('settings.connectionSuccess', () => {
    expect(i18n.t('settings.connectionSuccess')).toBe('连接成功');
  });

  it('settings.connectionError', () => {
    expect(i18n.t('settings.connectionError')).toBe('连接失败');
  });

  it('settings.maxDays.hint', () => {
    expect(i18n.t('settings.maxDays.hint')).toBe('0 = 不限制');
  });

  it('settings.interval.hint', () => {
    expect(i18n.t('settings.interval.hint')).toBe('最小 5 分钟');
  });

  it('settings.prefix.hint', () => {
    expect(i18n.t('settings.prefix.hint')).toBe('例：YYYY-MM-DD 或 YYYYMMDD_HHmm');
  });

  it('settings.lastSync', () => {
    expect(i18n.t('settings.lastSync')).toBe('上次同步');
  });

  it('settings.lastSync.never', () => {
    expect(i18n.t('settings.lastSync.never')).toBe('暂未同步');
  });

  it('settings.onboarding', () => {
    expect(i18n.t('settings.onboarding')).toBe('👋 欢迎使用！请先选择认证方式获取凭证，然后点击同步。');
  });

  it('settings.lastSync.result with vars', () => {
    expect(i18n.t('settings.lastSync.result', { time: '2026-05-01', created: 3, updated: 2 }))
      .toBe('2026-05-01 · 新增 3 更新 2');
  });

  it('settings keys in English', () => {
    i18n.initI18n('en');
    expect(i18n.t('settings.testConnection')).toBe('Test Connection');
    expect(i18n.t('settings.connectionSuccess')).toBe('Connection successful');
    expect(i18n.t('settings.maxDays.hint')).toBe('0 = no limit');
    expect(i18n.t('settings.interval.hint')).toBe('Minimum 5 minutes');
    expect(i18n.t('settings.lastSync.never')).toBe('Never synced');
    expect(i18n.t('settings.onboarding')).toBe('👋 Welcome! Please choose an auth method to get credentials, then click sync.');
  });
});

describe('t() - New sync keys', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('sync.started', () => {
    expect(i18n.t('sync.started')).toBe('Get笔记同步开始...');
  });

  it('sync.autoComplete', () => {
    expect(i18n.t('sync.autoComplete', { created: 2, updated: 1 }))
      .toBe('自动同步完成：新增 2 更新 1');
  });

  it('sync.autoFailRepeated', () => {
    expect(i18n.t('sync.autoFailRepeated', { count: 5 }))
      .toBe('自动同步连续失败 5 次，请检查设置');
  });

  it('sync keys in English', () => {
    i18n.initI18n('en');
    expect(i18n.t('sync.started')).toBe('GetNote sync started...');
    expect(i18n.t('sync.autoFailRepeated', { count: 3 }))
      .toBe('Auto sync failed 3 times, please check settings');
  });
});