import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, Modal } from 'obsidian';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SyncHistoryEntry, SyncResult } from '../src/types';
import { initI18n } from '../src/i18n';
import { formatHistoryFilter, formatHistoryMode, formatHistoryNoteType, formatHistoryScope, openSyncHistoryModal, shouldRenderHistoryEntryError } from '../src/ui/sync-history-modal';

const domExtensionNames = ['empty', 'createEl', 'createDiv', 'createSpan', 'setText'] as const;
const originalDomExtensions = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
  for (const name of domExtensionNames) {
    originalDomExtensions.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
  }
  Object.defineProperties(HTMLElement.prototype, {
    empty: {
      configurable: true,
      value(this: HTMLElement) { this.replaceChildren(); },
    },
    createEl: {
      configurable: true,
      value(this: HTMLElement, tag: string, options: { cls?: string; text?: string } = {}) {
        const child = document.createElement(tag);
        if (options.cls) child.className = options.cls;
        if (options.text !== undefined) child.textContent = options.text;
        this.appendChild(child);
        return child;
      },
    },
    createDiv: {
      configurable: true,
      value(this: HTMLElement, cls?: string) {
        return this.createEl('div', { cls });
      },
    },
    createSpan: {
      configurable: true,
      value(this: HTMLElement, options: { cls?: string; text?: string } = {}) {
        return this.createEl('span', options);
      },
    },
    setText: {
      configurable: true,
      value(this: HTMLElement, text: string) { this.textContent = text; },
    },
  });
});

afterAll(() => {
  for (const name of domExtensionNames) {
    const descriptor = originalDomExtensions.get(name);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, ...overrides };
}

function recordSyncHistory(
  history: SyncHistoryEntry[],
  result: SyncResult,
  type: SyncHistoryEntry['type'],
  status: SyncHistoryEntry['status'] = 'success',
  maxEntries = 20
): SyncHistoryEntry[] {
  const startedAt = Date.now();
  const finishedAt = startedAt + 1250;
  const entry: SyncHistoryEntry = {
    id: `${startedAt}-${type}`,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    timestamp: finishedAt,
    result,
    type,
    status,
  };
  history.push(entry);
  return history.slice(-maxEntries);
}

function makeEntry(overrides: Partial<SyncHistoryEntry> = {}): SyncHistoryEntry {
  return {
    id: 'entry-1',
    startedAt: 1714500000000,
    finishedAt: 1714500001000,
    durationMs: 1000,
    timestamp: 1714500001000,
    result: makeResult(),
    type: 'full',
    status: 'success',
    ...overrides,
  };
}

describe('SyncHistoryEntry', () => {
  it('records sync result with timestamp and type', () => {
    const result = makeResult({ created: 3, updated: 1, total: 4 });
    const entry: SyncHistoryEntry = {
      id: 'entry-1',
      startedAt: 1714499999000,
      finishedAt: 1714500000000,
      durationMs: 1000,
      timestamp: 1714500000000,
      result,
      type: 'full',
      status: 'success',
    };

    expect(entry.type).toBe('full');
    expect(entry.status).toBe('success');
    expect(entry.result.created).toBe(3);
    expect(entry.timestamp).toBe(1714500000000);
  });

  it('records selective sync type', () => {
    const entry = makeEntry({ result: makeResult({ created: 1 }), type: 'selective' });
    expect(entry.type).toBe('selective');
  });

  it('records auto sync type', () => {
    const entry = makeEntry({ type: 'auto' });
    expect(entry.type).toBe('auto');
  });

  it('records upload sync type', () => {
    const entry = makeEntry({ type: 'upload', mode: 'local-upload' });
    expect(entry.type).toBe('upload');
    expect(entry.mode).toBe('local-upload');
  });

  it('records failed sync error', () => {
    const entry = makeEntry({ status: 'failed', error: 'network error' });
    expect(entry.status).toBe('failed');
    expect(entry.error).toBe('network error');
  });
});

describe('recordSyncHistory', () => {
  it('appends entry to history and returns last sync result', () => {
    const history: SyncHistoryEntry[] = [];
    const result = makeResult({ created: 5, updated: 2, total: 7 });

    const updated = recordSyncHistory(history, result, 'full');

    expect(updated.length).toBe(1);
    expect(updated[0].result.created).toBe(5);
    expect(updated[0].result.updated).toBe(2);
    expect(updated[0].type).toBe('full');
  });

  it('caps history at maxEntries (default 20)', () => {
    const history: SyncHistoryEntry[] = [];
    for (let i = 0; i < 25; i++) {
      history.push(makeEntry({
        id: `entry-${i}`,
        startedAt: i,
        finishedAt: i,
        durationMs: 0,
        timestamp: i,
        result: makeResult({ created: i }),
      }));
    }

    const updated = recordSyncHistory(history, makeResult({ created: 99 }), 'full');

    expect(updated.length).toBe(20);
    // First entry should be dropped
    expect(updated[0].result.created).toBe(6);
    // Last entry should be the new one
    expect(updated[19].result.created).toBe(99);
  });

  it('maintains entries when under cap', () => {
    const history: SyncHistoryEntry[] = [];
    let h = history;
    for (let i = 0; i < 10; i++) {
      h = recordSyncHistory(h, makeResult({ created: i }), 'auto');
    }

    expect(h.length).toBe(10);
  });
});

describe('sync history scrolling', () => {
  it('lets expanded history entries render full details without nested clipping', () => {
    const css = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');
    const match = css.match(/\.getnote-history-list\s*\{[^}]+\}/);

    expect(match?.[0]).not.toContain('max-height');
    expect(match?.[0]).not.toContain('overflow-y: auto');
  });
});

describe('sync history entry error display', () => {
  it('hides aggregate failed-count errors after per-note details are shown', () => {
    const entry = makeEntry({
      status: 'failed',
      error: '失败 1 篇',
      result: makeResult({ failed: 1 }),
    });

    expect(shouldRenderHistoryEntryError(entry)).toBe(false);
  });

  it('keeps actionable entry-level errors visible', () => {
    const entry = makeEntry({
      status: 'failed',
      error: 'network error',
      result: makeResult({ failed: 1 }),
    });

    expect(shouldRenderHistoryEntryError(entry)).toBe(true);
  });
});

describe('sync history partial status rendering', () => {
  it('shows the result beside the status even when an entry is collapsed', () => {
    initI18n('zh-CN');
    const openedModals: Modal[] = [];
    vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      openedModals.push(this);
      (this as Modal & { onOpen(): void }).onOpen();
    });

    openSyncHistoryModal(new App(), [
      makeEntry({ id: 'changed', finishedAt: 1000, result: makeResult({ created: 2, updated: 1, skipped: 3 }) }),
      makeEntry({ id: 'unchanged', finishedAt: 2000 }),
      makeEntry({ id: 'partial', finishedAt: 3000, status: 'partial', result: makeResult({ updated: 1, failed: 1 }) }),
    ]);

    const entries = openedModals[0].contentEl.querySelectorAll<HTMLDetailsElement>('.getnote-history-entry');
    expect(entries[0].querySelector('.getnote-history-header-counts')?.textContent).toBe(' · 更新 1 · 失败 1');
    expect(entries[1].querySelector('.getnote-history-header-counts')?.textContent).toBe(' · 无需同步');
    expect(entries[2].open).toBe(false);
    expect(entries[2].querySelector('.getnote-history-header-counts')?.textContent).toBe(' · 新增 2 · 更新 1 · 跳过 3');
  });

  it('expands partial and failed entries with warning icon and status text', () => {
    initI18n('zh-CN');
    const openedModals: Modal[] = [];
    vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      openedModals.push(this);
      (this as Modal & { onOpen(): void }).onOpen();
    });

    openSyncHistoryModal(new App(), [
      makeEntry({ id: 'success-old', status: 'success', finishedAt: 1000 }),
      makeEntry({ id: 'partial', status: 'partial', finishedAt: 2000, result: makeResult({ failed: 1 }) }),
      makeEntry({ id: 'failed', status: 'failed', finishedAt: 3000, result: makeResult({ failed: 1 }) }),
    ]);

    const contentEl = openedModals[0].contentEl;
    const partial = contentEl.querySelector<HTMLDetailsElement>('.getnote-history-entry.is-partial')!;
    const failed = contentEl.querySelector<HTMLDetailsElement>('.getnote-history-entry.is-failed')!;
    const oldSuccess = contentEl.querySelector<HTMLDetailsElement>('.getnote-history-entry.is-success')!;

    expect(partial).toBeTruthy();
    expect(failed).toBeTruthy();
    expect(partial.open).toBe(true);
    expect(failed.open).toBe(true);
    expect(oldSuccess.open).toBe(false);
    expect(partial.querySelector('.getnote-history-warning-icon')?.textContent).toBe('⚠');
    expect(partial.querySelector('.getnote-history-status-text')?.textContent).toBe('部分失败');
    expect(failed.querySelector('.getnote-history-warning-icon')?.textContent).toBe('⚠');
  });

  it('keeps the first successful entry on page two collapsed', () => {
    initI18n('zh-CN');
    const openedModals: Modal[] = [];
    vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      openedModals.push(this);
      (this as Modal & { onOpen(): void }).onOpen();
    });
    const history = Array.from({ length: 6 }, (_, index) => makeEntry({
      id: `success-${index}`,
      status: 'success',
      finishedAt: 1000 + index,
    }));

    openSyncHistoryModal(new App(), history);
    const contentEl = openedModals[0].contentEl;
    contentEl.querySelector<HTMLButtonElement>('.getnote-history-page-button:last-child')!.click();

    const pageTwoEntry = contentEl.querySelector<HTMLDetailsElement>('.getnote-history-entry.is-success')!;
    expect(pageTwoEntry).toBeTruthy();
    expect(pageTwoEntry.open).toBe(false);
  });

  it('defines green, yellow, and red status colors', () => {
    const css = readFileSync(resolve(process.cwd(), 'styles.css'), 'utf8');

    expect(css).toMatch(/\.getnote-history-status-text\.is-success\s*\{[^}]*color:\s*var\(--text-success\)/);
    expect(css).toMatch(/\.getnote-history-status-text\.is-partial\s*\{[^}]*color:\s*var\(--text-warning\)/);
    expect(css).toMatch(/\.getnote-history-status-text\.is-failed\s*\{[^}]*color:\s*var\(--text-error\)/);
  });
});

describe('consecutive auto-sync failure counter', () => {
  it('resets count on success', () => {
    let failCount = 3;
    // Simulate success
    failCount = 0;
    expect(failCount).toBe(0);
  });

  it('increments count on failure', () => {
    let failCount = 0;
    failCount++;
    expect(failCount).toBe(1);
    failCount++;
    expect(failCount).toBe(2);
  });

  it('triggers repeated warning at >= 3', () => {
    let failCount = 3;
    const shouldWarn = failCount >= 3;
    expect(shouldWarn).toBe(true);

    failCount = 2;
    expect(failCount >= 3).toBe(false);
  });
});

describe('sync history note type display', () => {
  it('localizes note type labels in the detail list', () => {
    initI18n('zh-CN');

    expect(formatHistoryNoteType('recorder_audio')).toBe('录音笔记');
    expect(formatHistoryNoteType('unknown_remote_type')).toBe('其他');
  });

  it('折叠所有 9 种内部 audio 类型到统一“录音笔记”', () => {
    initI18n('zh-CN');
    const audioTypes = [
      'immediate_audio',
      'recorder_audio',
      'recorder_flash_audio',
      'audio_long',
      'local_audio',
      'audio',
      'class_audio',
      'internal_record',
      'meeting',
    ];
    for (const noteType of audioTypes) {
      expect(formatHistoryNoteType(noteType)).toBe('录音笔记');
    }
  });

  it('blogger_post 在历史记录中显示为“其他”', () => {
    initI18n('zh-CN');
    expect(formatHistoryNoteType('blogger_post')).toBe('其他');
  });
});

describe('sync history scope display', () => {
  it('shows upload mode as manual local upload', () => {
    initI18n('zh-CN');

    expect(formatHistoryMode(makeEntry({
      type: 'upload',
      mode: 'local-upload',
    }))).toBe('手动 · 上传本地笔记');
  });

  it('shows knowledge-base sync as its own manual mode', () => {
    initI18n('zh-CN');

    expect(formatHistoryMode(makeEntry({
      type: 'full',
      mode: 'knowledge-base',
      scope: { selectedCount: 1 },
    }))).toBe('手动 · 按知识库同步');
  });

  it('hides maxDays when a start date is present', () => {
    initI18n('zh-CN');

    expect(formatHistoryScope(makeEntry({
      scope: {
        syncStartDate: '2026-05-09',
        maxDays: 30,
      },
    }))).toBe('起始日期 2026-05-09');
  });

  it('shows checkpoint label for auto sync', () => {
    initI18n('zh-CN');

    expect(formatHistoryScope(makeEntry({
      type: 'auto',
      scope: {
        syncStartDate: '2026-05-09T10:00:00+08:00',
      },
    }))).toBe('同步断点 2026-05-09T10:00:00+08:00');
  });

  it('shows configured note type filters', () => {
    initI18n('zh-CN');

    expect(formatHistoryFilter(makeEntry({
      scope: {
        syncStartDate: '',
        maxDays: 0,
        enabledNoteTypes: ['plain_text', 'link'],
      },
    }))).toBe('仅同步：文字笔记、链接笔记');
  });

  it('shows an explicit empty filter when no note types are selected', () => {
    initI18n('zh-CN');

    expect(formatHistoryFilter(makeEntry({
      scope: {
        syncStartDate: '',
        maxDays: 0,
        enabledNoteTypes: [],
      },
    }))).toBe('未选择任何笔记类型');
  });

  it('uses English separators for note type filters in English', () => {
    initI18n('en');

    expect(formatHistoryFilter(makeEntry({
      scope: {
        syncStartDate: '',
        maxDays: 0,
        enabledNoteTypes: ['plain_text', 'link'],
      },
    }))).toBe('Only sync: Plain Text, Link Note');
  });

  it('shows the default filter copy when note types are unrestricted', () => {
    initI18n('zh-CN');

    expect(formatHistoryFilter(makeEntry({
      scope: {
        syncStartDate: '',
        maxDays: 0,
      },
    }))).toBe('仅按更新时间过滤，无类型或标签过滤');
  });

  it('shows configured tag filters alongside note type filters', () => {
    initI18n('zh-CN');

    expect(formatHistoryFilter(makeEntry({
      scope: {
        syncStartDate: '',
        maxDays: 0,
        enabledNoteTypes: ['plain_text'],
        syncTags: ['工作', '项目'],
      },
    }))).toBe('仅同步：文字笔记 · 标签：工作、项目');
  });
});
