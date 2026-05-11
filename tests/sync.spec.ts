import { describe, it, expect, vi, afterEach } from 'vitest';
import { App } from 'obsidian';
import GetNoteSyncPlugin from '../src/main';
import { SyncCancelledError, SyncEngine } from '../src/sync';
import { DEFAULT_SETTINGS } from '../src/types';

describe('SyncCancelledError', () => {
  it('has name SyncCancelledError', () => {
    expect(new SyncCancelledError().name).toBe('SyncCancelledError');
  });

  it('has message "Sync cancelled"', () => {
    expect(new SyncCancelledError().message).toBe('Sync cancelled');
  });

  it('is an instance of Error', () => {
    expect(new SyncCancelledError()).toBeInstanceOf(Error);
  });

  it('is caught by instanceof check', () => {
    try {
      throw new SyncCancelledError();
    } catch (err) {
      expect(err instanceof SyncCancelledError).toBe(true);
    }
  });
});

describe('GetNoteSyncPlugin runSync cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makePlugin() {
    const plugin = new GetNoteSyncPlugin(new App());
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      apiToken: 'test-token',
      clientId: 'test-client',
      syncHistory: [],
    };
    plugin.syncHistory = [];
    return plugin;
  }

  it('manual sync failure clears syncing state', async () => {
    vi.spyOn(SyncEngine.prototype, 'sync').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const plugin = makePlugin();

    await plugin['runSync']('full', { maxDays: 0, syncStartDate: '' });

    expect(plugin.isSyncing).toBe(false);
    expect(plugin.syncProgress.message).toContain('boom');
  });

  it('manual sync cancellation clears syncing state', async () => {
    vi.spyOn(SyncEngine.prototype, 'sync').mockRejectedValue(new SyncCancelledError());
    const plugin = makePlugin();

    await plugin['runSync']('full', { maxDays: 0, syncStartDate: '' });

    expect(plugin.isSyncing).toBe(false);
    expect(plugin.syncProgress.message).toContain('已取消');
  });

  it('manual sync success clears syncing state immediately', async () => {
    vi.spyOn(SyncEngine.prototype, 'sync').mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      total: 1,
      items: [],
    });
    const plugin = makePlugin();

    await plugin['runSync']('full', { maxDays: 0, syncStartDate: '' });

    expect(plugin.isSyncing).toBe(false);
    expect(plugin.currentSyncEngine).toBe(null);
    expect(plugin.syncProgress).toEqual({ message: '', count: '', percent: 0 });
  });

  it('registers scheduled sync interval with Obsidian lifecycle', () => {
    vi.useFakeTimers();
    const plugin = makePlugin();
    plugin.settings.scheduledSync = {
      enabled: true,
      intervalMinutes: 5,
      syncOnStart: true,
    };
    const registerInterval = vi.fn();
    Object.assign(plugin, { registerInterval });

    plugin.startAutoSync();

    expect(registerInterval).toHaveBeenCalledTimes(1);
    expect(registerInterval).toHaveBeenCalledWith(expect.anything());
  });

  it('disables maxDays when scheduled sync resumes from last synced timestamp', async () => {
    const syncScopeOptions: unknown[] = [];
    vi.spyOn(SyncEngine.prototype, 'sync').mockImplementation(function (this: SyncEngine) {
      syncScopeOptions.push(this['scopeOptions']);
      return Promise.resolve({ created: 0, updated: 0, skipped: 0, failed: 0, total: 0 });
    });
    const plugin = makePlugin();
    plugin.settings.maxDays = 30;
    plugin.settings.lastSyncEndTimestamp = '2026-05-09T10:00:00+08:00';

    plugin['doAutoSync']();

    await vi.waitFor(() => {
      expect(syncScopeOptions).toEqual([
        {
          maxDays: 0,
          syncStartDate: '2026-05-09T10:00:00+08:00',
        },
      ]);
    });
  });

  it('disables maxDays when scheduled sync uses configured start date', async () => {
    const syncScopeOptions: unknown[] = [];
    vi.spyOn(SyncEngine.prototype, 'sync').mockImplementation(function (this: SyncEngine) {
      syncScopeOptions.push(this['scopeOptions']);
      return Promise.resolve({ created: 0, updated: 0, skipped: 0, failed: 0, total: 0 });
    });
    const plugin = makePlugin();
    plugin.settings.maxDays = 30;
    plugin.settings.syncStartDate = '2026-05-09';
    plugin.settings.lastSyncEndTimestamp = '';

    plugin['doAutoSync']();

    await vi.waitFor(() => {
      expect(syncScopeOptions).toEqual([
        {
          maxDays: 0,
          syncStartDate: '2026-05-09',
        },
      ]);
      expect(plugin.syncHistory.at(-1)?.scope).toEqual({
        maxDays: 0,
        syncStartDate: '2026-05-09',
        selectedCount: undefined,
        selectedIds: undefined,
      });
    });
  });

  it('does not advance scheduled sync checkpoint when any note fails', async () => {
    vi.spyOn(SyncEngine.prototype, 'sync').mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 1,
      total: 2,
      items: [],
      lastNoteTimestamp: '2026-05-10T12:00:00+08:00',
    });
    const plugin = makePlugin();
    plugin.settings.lastSyncEndTimestamp = '2026-05-09T10:00:00+08:00';

    await plugin['runSync']('auto', {
      maxDays: 0,
      syncStartDate: plugin.settings.lastSyncEndTimestamp,
    });

    expect(plugin.settings.lastSyncEndTimestamp).toBe('2026-05-09T10:00:00+08:00');
  });
});
