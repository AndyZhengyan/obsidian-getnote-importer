import { App, Modal, Plugin, getLanguage } from 'obsidian';
import ReactDOM from 'react-dom';
import { DEFAULT_SETTINGS, type Settings, type SyncHistoryScope, type SyncProgressDetail, type SyncHistoryEntry, type SyncResult, type SyncScopeOptions } from './types';
import { GetNoteSettingsTab } from './settings-tab';
import { SyncEngine, SyncCancelledError } from './sync';
import { showError, showNotice, showSuccess, showInfo } from './ui/notice';
import { NotePickerModal } from './ui/note-picker-modal';
import { ManualSyncModal } from './ui/manual-sync-modal';
import { initI18n, t } from './i18n';

const MAX_SYNC_HISTORY = 20;

function emptySyncResult(): SyncResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
}

function normalizeSyncHistory(value: unknown): SyncHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Partial<SyncHistoryEntry> => Boolean(entry) && typeof entry === 'object')
    .map((entry, index) => {
      const timestamp = typeof entry.timestamp === 'number'
        ? entry.timestamp
        : typeof entry.finishedAt === 'number'
          ? entry.finishedAt
          : Date.now();
      const startedAt = typeof entry.startedAt === 'number' ? entry.startedAt : timestamp;
      const finishedAt = typeof entry.finishedAt === 'number' ? entry.finishedAt : timestamp;
      const result = entry.result ?? emptySyncResult();
      const type: SyncHistoryEntry['type'] = entry.type === 'selective' || entry.type === 'auto' ? entry.type : 'full';
      const mode: SyncHistoryEntry['mode'] =
        entry.mode === 'selected' || entry.mode === 'auto' || entry.mode === 'time'
          ? entry.mode
          : type === 'selective'
            ? 'selected'
            : type === 'auto'
              ? 'auto'
              : 'time';
      const status: SyncHistoryEntry['status'] = entry.status === 'failed' || entry.status === 'cancelled' ? entry.status : 'success';
      const maybeScope = entry.scope;
      return {
        id: typeof entry.id === 'string' ? entry.id : `${timestamp}-${index}`,
        startedAt,
        finishedAt,
        durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : Math.max(0, finishedAt - startedAt),
        timestamp,
        result: {
          created: result.created ?? 0,
          updated: result.updated ?? 0,
          skipped: result.skipped ?? 0,
          failed: result.failed ?? 0,
          total: result.total ?? 0,
          items: Array.isArray(result.items) ? result.items : [],
        },
        type,
        mode,
        scope: maybeScope && typeof maybeScope === 'object'
          ? {
            maxDays: typeof maybeScope.maxDays === 'number' ? maybeScope.maxDays : 0,
            syncStartDate: typeof maybeScope.syncStartDate === 'string' ? maybeScope.syncStartDate : '',
            selectedCount: typeof maybeScope.selectedCount === 'number' ? maybeScope.selectedCount : undefined,
            selectedIds: Array.isArray(maybeScope.selectedIds) ? maybeScope.selectedIds.filter((id): id is string => typeof id === 'string') : undefined,
          }
          : undefined,
        status,
        error: typeof entry.error === 'string' ? entry.error : undefined,
      };
    })
    .slice(-MAX_SYNC_HISTORY);
}

export default class GetNoteSyncPlugin extends Plugin {
  settings!: Settings;
  isSyncing = false;
  syncProgress: SyncProgressDetail = { message: '', count: '', percent: 0 };
  syncHistory: SyncHistoryEntry[] = [];
  lastSyncResult: SyncHistoryEntry | null = null;
  private currentSyncEngine: SyncEngine | null = null;
  private autoSyncIntervalId: number | undefined;
  private settingsTab?: GetNoteSettingsTab;
  private lastProgressUpdate = 0;
  private autoSyncFailCount = 0;

  async onload(): Promise<void> {
    initI18n(getLanguage());

    const loaded = (await this.loadData()) as Partial<Settings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      scheduledSync: { ...DEFAULT_SETTINGS.scheduledSync, ...loaded?.scheduledSync },
      syncHistory: normalizeSyncHistory(loaded?.syncHistory),
    };
    this.syncHistory = this.settings.syncHistory;
    this.lastSyncResult = this.syncHistory.at(-1) ?? null;

    this.settingsTab = new GetNoteSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.addCommand({
      id: 'sync-notes',
      name: t('command.sync'),
      callback: () => this.openManualSyncModal(),
    });

    this.addRibbonIcon('book-lock', t('ribbon.tooltip'), () => this.openManualSyncModal());

    if (this.settings.scheduledSync.enabled) {
      if (this.settings.scheduledSync.syncOnStart) {
        void this.doAutoSync();
      }
      this.startAutoSync();
    }

  }

  onunload(): void {
    this.stopAutoSync();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getVaultFolders(): string[] {
    const folders = new Set<string>();
    for (const dir of this.app.vault.getAllFolders()) {
      const parts = dir.path.split('/');
      if (parts.length >= 1 && parts[0]) {
        folders.add(parts[0]);
      }
    }
    folders.delete(this.settings.folderName);
    return Array.from(folders).sort();
  }

  private refreshSettingsTab(): void {
    if (this.settingsTab) this.settingsTab.display();
  }

  startAutoSync(): void {
    this.stopAutoSync();
    const interval = Math.max(5, this.settings.scheduledSync.intervalMinutes) * 60 * 1000;
    this.autoSyncIntervalId = window.setInterval(() => {
      if (!this.isSyncing) {
        void this.doAutoSync();
      }
    }, interval);
    this.registerInterval(this.autoSyncIntervalId);
  }

  stopAutoSync(): void {
    if (this.autoSyncIntervalId !== undefined) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = undefined;
    }
  }

  cancelSync(): void {
    this.currentSyncEngine?.cancel();
  }

  private async recordSyncHistory(
    result: SyncResult,
    type: 'full' | 'selective' | 'auto',
    startedAt: number,
    scope: SyncHistoryScope,
    status: SyncHistoryEntry['status'] = 'success',
    error?: string
  ): Promise<void> {
    const finishedAt = Date.now();
    const entry: SyncHistoryEntry = {
      id: `${startedAt}-${finishedAt}-${type}`,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      timestamp: finishedAt,
      result,
      type,
      mode: type === 'selective' ? 'selected' : type === 'auto' ? 'auto' : 'time',
      scope,
      status,
      error,
    };
    this.syncHistory.push(entry);
    this.syncHistory = this.syncHistory.slice(-MAX_SYNC_HISTORY);
    this.settings.syncHistory = this.syncHistory;

    // lastSyncEndTimestamp only belongs to auto sync
    if (type === 'auto' && result.failed === 0 && result.lastNoteTimestamp) {
      this.settings.lastSyncEndTimestamp = result.lastNoteTimestamp;
    }

    this.lastSyncResult = entry;
    await this.saveSettings();
  }

  private async runSync(
    type: 'full' | 'selective' | 'auto',
    scopeOptions?: Partial<SyncScopeOptions>,
    selectedIds?: string[]
  ): Promise<void> {
    if (this.isSyncing) return;
    if (!this.settings.apiToken || !this.settings.clientId) {
      showError(t('notice.fillCredentials'));
      return;
    }

    const startedAt = Date.now();
    const resolvedSyncStartDate = scopeOptions?.syncStartDate ?? this.settings.syncStartDate;
    const resolvedScope: SyncHistoryScope = {
      maxDays: resolvedSyncStartDate ? 0 : scopeOptions?.maxDays ?? this.settings.maxDays,
      syncStartDate: resolvedSyncStartDate,
      selectedCount: selectedIds?.length,
      selectedIds,
    };
    this.isSyncing = true;
    this.syncProgress = { message: t('sync.fetching', { page: 1 }), count: '', percent: 0 };
    this.currentSyncEngine = null;
    this.refreshSettingsTab();
    showNotice(t('sync.started'));

    const engine = new SyncEngine(this.app, this.settings, (info) => this.setProgress(info), scopeOptions);
    this.currentSyncEngine = engine;
    engine.setOnCancel(() => this.cancelSync());
    let shouldResetSyncState = type === 'auto';

    try {
      const result = selectedIds
        ? await engine.syncNoteIds(selectedIds)
        : await engine.sync();

      await this.recordSyncHistory(result, type, startedAt, resolvedScope);

      if (type === 'auto') {
        this.autoSyncFailCount = 0;
        if (result.created > 0 || result.updated > 0) {
          showSuccess(t('notice.autoSynced', { created: result.created, updated: result.updated }));
        }
      } else {
        const hasChanges = result.created > 0 || result.updated > 0;
        if (hasChanges) {
          showSuccess(t('notice.syncComplete', { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed > 0 ? ` · ${t('modal.failed', { failed: result.failed })}` : '' }), 8000);
        } else {
          showInfo(t('notice.syncComplete', { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed > 0 ? ` · ${t('modal.failed', { failed: result.failed })}` : '' }), 8000);
        }
        this.syncProgress = { message: '', count: '', percent: 0 };
        this.isSyncing = false;
        this.currentSyncEngine = null;
        this.refreshSettingsTab();
        return;
      }
    } catch (err) {
      if (err instanceof SyncCancelledError) {
        await this.recordSyncHistory(emptySyncResult(), type, startedAt, resolvedScope, 'cancelled');
        if (type !== 'auto') {
          this.syncProgress = { message: t('modal.cancelled'), count: '', percent: 0 };
          shouldResetSyncState = true;
        }
      } else {
        const error = err instanceof Error ? err.message : String(err);
        await this.recordSyncHistory(emptySyncResult(), type, startedAt, resolvedScope, 'failed', error);

        if (type === 'auto') {
          this.autoSyncFailCount++;
          const isQuotaExceeded = error.includes('配额') || error.includes('quota') || error.includes('429');
          if (isQuotaExceeded) {
            this.stopAutoSync();
            this.settings.scheduledSync.enabled = false;
            await this.saveSettings();
            showNotice(t('notice.quotaExceededStop'), 20000);
          } else {
            const msg = this.autoSyncFailCount >= 3
              ? t('sync.autoFailRepeated', { count: this.autoSyncFailCount })
              : t('notice.autoSyncFailed');
            showNotice(msg, 15000);
          }
        } else {
          this.syncProgress = { message: t('notice.syncFailed', { msg: error }), count: '', percent: 0 };
          console.error(t('console.syncError'), err);
          shouldResetSyncState = true;
        }
      }
    } finally {
      if (shouldResetSyncState) {
        this.isSyncing = false;
        this.currentSyncEngine = null;
        if (type === 'auto') {
          this.syncProgress = { message: '', count: '', percent: 0 };
        }
        this.refreshSettingsTab();
      }
    }
  }

  private doAutoSync(): void {
    // Auto sync uses lastSyncEndTimestamp as cutoff: skip notes already synced last time.
    // This IS the early-exit mechanism — no separate lastSyncEndTimestamp logic needed in engine.
    const syncStartDate = this.settings.lastSyncEndTimestamp || this.settings.syncStartDate;
    const scopeOptions: Partial<SyncScopeOptions> = syncStartDate
      ? { syncStartDate, maxDays: 0 }
      : {};
    void this.runSync('auto', scopeOptions);
  }

  private setProgress(info: { page?: number; processed?: number; total?: number; created?: number; updated?: number; skipped?: number; failed?: number; percent?: number }) {
    this.syncProgress = {
      message: info.page ? t('sync.fetching', { page: info.page }) : t('sync.syncing'),
      count: info.processed && info.total
        ? t('sync.processingCount', { current: info.processed, total: info.total })
        : '',
      percent: info.percent ?? 0,
    };
    const now = Date.now();
    if (now - this.lastProgressUpdate > 300) {
      this.lastProgressUpdate = now;
      this.refreshSettingsTab();
    }
  }

  openManualSyncModal(): void {
    const wrapper = new ManualSyncModalWrapper(this.app, this);
    wrapper.open();
  }

  startSync(scopeOptions: SyncScopeOptions): void {
    void this.runSync('full', scopeOptions);
  }

  openNotePicker(): void {
    const wrapper = new NotePickerModalWrapper(this.app, this);
    wrapper.open();
  }

  syncSelectedNotes(noteIds: string[]): void {
    void this.runSync('selective', undefined, noteIds);
  }
}

class ManualSyncModalWrapper extends Modal {
  constructor(app: App, private plugin: GetNoteSyncPlugin) {
    super(app);
    this.titleEl.setText(t('manualSync.title'));
  }

  onOpen() {
    ReactDOM.render(
      <ManualSyncModal
        initialOptions={{ syncStartDate: '', maxDays: 0 }}
        onConfirm={(options) => {
          this.close();
          this.plugin.startSync(options);
        }}
        onCancel={() => this.close()}
      />,
      this.contentEl
    );
  }

  onClose() {
    ReactDOM.unmountComponentAtNode(this.contentEl);
  }
}

class NotePickerModalWrapper extends Modal {
  private abortController = new AbortController();

  constructor(app: App, private plugin: GetNoteSyncPlugin) {
    super(app);
    this.titleEl.setText(t('picker.title'));
  }

  onOpen() {
    ReactDOM.render(
      <NotePickerModal
        token={this.plugin.settings.apiToken}
        clientId={this.plugin.settings.clientId}
        abortSignal={this.abortController.signal}
        onConfirm={(noteIds) => {
          this.abortController.abort();
          this.close();
          this.plugin.syncSelectedNotes(noteIds);
        }}
        onCancel={() => {
          this.abortController.abort();
          this.close();
        }}
      />,
      this.contentEl
    );
  }

  onClose() {
    this.abortController.abort();
    ReactDOM.unmountComponentAtNode(this.contentEl);
  }
}
