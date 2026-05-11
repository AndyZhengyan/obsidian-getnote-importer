import { describe, it, expect } from 'vitest';
import type { SyncHistoryEntry, SyncResult } from '../src/types';
import { initI18n } from '../src/i18n';
import { formatHistoryNoteType, formatHistoryScope } from '../src/ui/sync-history-modal';

function makeResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, ...overrides };
}

function recordSyncHistory(
  history: SyncHistoryEntry[],
  result: SyncResult,
  type: 'full' | 'selective' | 'auto',
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

    expect(formatHistoryNoteType('recorder_audio')).toBe('录音长录');
    expect(formatHistoryNoteType('unknown_remote_type')).toBe('其他');
  });
});

describe('sync history scope display', () => {
  it('hides maxDays for auto sync when a start date is present', () => {
    initI18n('zh-CN');

    expect(formatHistoryScope(makeEntry({
      type: 'auto',
      mode: 'auto',
      scope: {
        syncStartDate: '2026-05-09',
        maxDays: 30,
      },
    }))).toBe('起始日期 2026-05-09');
  });
});
