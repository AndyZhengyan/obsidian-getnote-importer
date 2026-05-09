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
});
