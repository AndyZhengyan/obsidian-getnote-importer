import { describe, it, expect, beforeEach } from 'vitest';
import * as i18n from '../src/i18n';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

describe('initI18n', () => {
  it('sets locale to zh for zh-CN', () => {
    i18n.initI18n('zh-CN');
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });

  it('sets locale to zh for zh-TW', () => {
    i18n.initI18n('zh-TW');
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });

  it('sets locale to zh for Chinese locale string', () => {
    i18n.initI18n('简体中文');
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });

  it('sets locale to en for en', () => {
    i18n.initI18n('en');
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });

  it('sets locale to en for en-US', () => {
    i18n.initI18n('en-US');
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });

  it('sets locale to en for unknown locale', () => {
    i18n.initI18n('fr-FR');
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });
});

describe('t() - Chinese translations', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('returns Chinese for settings.title', () => {
    expect(i18n.t('settings.title')).toBe('⏪ 得到大脑（原Get笔记）Sync');
  });

  it('returns Chinese for settings.desc', () => {
    expect(i18n.t('settings.desc')).toBe('得到大脑（原Get笔记） ↔ Obsidian，一键同步无负担，');
  });

  it('returns Chinese for settings.community', () => {
    expect(i18n.t('settings.community')).toBe('欢迎交流、留下star');
  });

  it('returns Chinese GitHub documentation links', () => {
    expect(i18n.t('settings.communityUrl')).toContain('README_zh.md');
    expect(i18n.t('settings.webTipHelpUrl')).toContain('docs/web-mode-manual-token_zh.md');
    expect(i18n.t('settings.credentials.webTip')).toContain('临时鉴权');
    expect(i18n.t('settings.credentials.webTip')).toContain('约 30 分钟');
    expect(i18n.t('settings.credentials.webTip')).toContain('PRO 会员');
    expect(i18n.t('settings.credentials.webTip')).not.toContain('开发者工具');
  });

  it('returns Chinese for sync.start', () => {
    expect(i18n.t('sync.start')).toBe('按时间同步');
  });

  it('returns Chinese for manualSync.title', () => {
    expect(i18n.t('manualSync.title')).toBe('按时间同步');
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
    expect(i18n.t('notice.autoSyncFailed')).toBe('自动同步失败');
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
    expect(i18n.t('settings.desc')).toBe('得到大脑（原Get笔记） ↔ Obsidian, one-click sync');
  });

  it('returns English for settings.community', () => {
    expect(i18n.t('settings.community')).toBe('Welcome, leave a star');
  });

  it('returns English GitHub documentation links', () => {
    expect(i18n.t('settings.communityUrl')).toContain('README.md');
    expect(i18n.t('settings.webTipHelpUrl')).toContain('docs/web-mode-manual-token.md');
    expect(i18n.t('settings.credentials.webTip')).toContain('Temporary Auth');
    expect(i18n.t('settings.credentials.webTip')).toContain('about 30 minutes');
    expect(i18n.t('settings.credentials.webTip')).toContain('PRO');
    expect(i18n.t('settings.credentials.webTip')).not.toContain('DevTools');
  });

  it('returns English for sync.start', () => {
    expect(i18n.t('sync.start')).toBe('Sync by Time');
  });

  it('returns English for manualSync.title', () => {
    expect(i18n.t('manualSync.title')).toBe('Sync by Time');
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
    expect(i18n.t('notice.autoSyncFailed')).toBe('Auto sync failed');
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
    expect(i18n.t('picker.type.plain_text')).toBe('文字笔记');
    expect(i18n.t('picker.type.link')).toBe('链接笔记');
    expect(i18n.t('picker.type.recorder_audio')).toBe('录音笔记');
    expect(i18n.t('picker.type.img_text')).toBe('图片笔记');
    expect(i18n.t('picker.type.immediate_audio')).toBe('录音笔记');
    expect(i18n.t('picker.type.local_audio')).toBe('录音笔记');
    expect(i18n.t('picker.type.recorder_flash_audio')).toBe('录音卡笔记');
    expect(i18n.t('picker.type.unknown')).toBe('其他');
  });

  it('returns correct English type labels', () => {
    i18n.initI18n('en-US');
    expect(i18n.t('picker.type.plain_text')).toBe('Plain Text');
    expect(i18n.t('picker.type.link')).toBe('Link Note');
    expect(i18n.t('picker.type.recorder_audio')).toBe('Audio Note');
    expect(i18n.t('picker.type.img_text')).toBe('Image Note');
    expect(i18n.t('picker.type.immediate_audio')).toBe('Audio Note');
    expect(i18n.t('picker.type.local_audio')).toBe('Audio Note');
    expect(i18n.t('picker.type.recorder_flash_audio')).toBe('Recording Card Note');
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

  it('settings.noteTypes.label', () => {
    expect(i18n.t('settings.noteTypes.label')).toBe('同步笔记类型');
  });

  it('settings.interval.hint', () => {
    expect(i18n.t('settings.interval.hint')).toBe('最小 5 分钟');
  });

  it('settings.prefix.hint', () => {
    expect(i18n.t('settings.prefix.hint')).toBe('时间格式：YYYY / MM / DD / HH / mm / ss');
  });

  it('settings.lastSync', () => {
    expect(i18n.t('settings.lastSync')).toBe('上次同步');
  });

  it('settings.lastSync.never', () => {
    expect(i18n.t('settings.lastSync.never')).toBe('暂未同步');
  });

  it('settings.onboarding', () => {
    expect(i18n.t('settings.onboarding')).toBe('👋 欢迎使用！请先选择认证方式并填写凭证，然后点击同步。');
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
    expect(i18n.t('settings.noteTypes.label')).toBe('Note Types');
    expect(i18n.t('settings.interval.hint')).toBe('Minimum 5 minutes');
    expect(i18n.t('settings.lastSync.never')).toBe('Never synced');
    expect(i18n.t('settings.onboarding')).toBe('👋 Welcome! Choose an authentication mode and enter credentials first.');
  });
});

describe('t() - New sync keys', () => {
  beforeEach(() => {
    i18n.initI18n('zh-CN');
  });

  it('sync.started', () => {
    expect(i18n.t('sync.started')).toBe('同步开始...');
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
    expect(i18n.t('sync.started')).toBe('Sync started...');
    expect(i18n.t('sync.autoFailRepeated', { count: 3 }))
      .toBe('Auto sync failed 3 times, please check settings');
  });
});

describe('key usage in source code', () => {
  const SRC_DIR = join(__dirname, '..', 'src');
  const knownKeys = new Set(Object.keys(i18n.translations.zh));

  function* walkFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('ui')) {
        yield* walkFiles(path);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('test')) {
        yield path;
      }
    }
  }
  function* walkUi(): Generator<string> {
    const uiDir = join(SRC_DIR, 'ui');
    try {
      for (const entry of readdirSync(uiDir, { withFileTypes: true })) {
        if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          yield join(uiDir, entry.name);
        }
      }
    } catch { /* no ui dir */ }
  }

  it('every t() key used in source files has a translation', () => {
    const missing: string[] = [];

    for (const filePath of [walkFiles(SRC_DIR), walkUi()].flatMap(g => [...g]).filter(f => !f.includes('.test.'))) {
      const content = readFileSync(filePath, 'utf-8');
      const regex = /(?<![a-zA-Z.])t\(['"]([^'"]+)['"]\)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const key = match[1];
        if (!knownKeys.has(key)) {
          missing.push(`${key} (in ${filePath.replace(SRC_DIR, 'src')})`);
        }
      }
    }

    expect(missing, `Missing i18n keys:\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('locale symmetry', () => {
  it('all zh keys exist in en and vice versa', () => {
    const zhKeys = Object.keys(i18n.translations.zh).sort();
    const enKeys = Object.keys(i18n.translations.en).sort();

    const missingInEn = zhKeys.filter(k => !enKeys.includes(k));
    const missingInZh = enKeys.filter(k => !zhKeys.includes(k));

    const msg: string[] = [];
    if (missingInEn.length) msg.push(`Missing in en: ${missingInEn.join(', ')}`);
    if (missingInZh.length) msg.push(`Missing in zh: ${missingInZh.join(', ')}`);

    expect(msg, msg.join('\n')).toEqual([]);
  });
});
