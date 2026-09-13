import { BidirectionalSyncEngine } from './bidirectional-sync';
import { resolveSyncConflict } from './ui/sync-conflict-modal';
import { App, Modal, Notice, Platform, Plugin, getLanguage, type DataAdapter, type Editor, type Menu, type TFile } from 'obsidian';
import ReactDOM from 'react-dom';
import { DEFAULT_SETTINGS, getAuthCredentials, migrateEnabledNoteTypes, type RecallSearchResult, type Settings, type SyncHistoryScope, type SyncProgressDetail, type SyncHistoryEntry, type SyncResult, type SyncScopeOptions } from './types';
import { GetNoteSettingsTab } from './settings-tab';
import { SyncEngine, SyncCancelledError } from './sync';
import { showError, showNotice, showSuccess } from './ui/notice';
import { NotePickerModal } from './ui/note-picker-modal';
import { TopicPickerModal, type TopicPickerSelection } from './ui/topic-picker-modal';
import { ManualSyncModal } from './ui/manual-sync-modal';
import { LocalUploadModal } from './ui/local-upload-modal';
import { initI18n, t } from './i18n';
import { ReverseSyncEngine, type ReverseSyncResult } from './reverse-sync';
import { migrateSyncedNoteTags } from './tag-migration';
import { getLastQuotaState, resetQuotaState } from './api-clients/openapi-client';
import { fetchNotes, fetchRecallSearch, setWebTokenRefreshHandler } from './api';
import { mergeTagCache } from './utils/tag-aggregator';
import { SearchPanel, findSyncedNoteFile } from './ui/search-view';
import {
  migrateDatePaths,
  type DatePathMigrationOptions,
  type DatePathMigrationResult,
  type DatePathMigrationTarget,
} from './date-path-migration';
import { validateDatePathFormat } from './date-paths';
import { createDesktopWebAuthManager, type DesktopWebAuthManager } from './desktop-web-auth';
import { WebTokenRefreshCoordinator } from './web-token-refresh';

const SYNC_HISTORY_RETENTION_DAYS = 30;
const SYNC_HISTORY_RETENTION_MS = SYNC_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TAG_MIGRATION_VERSION = 2;
const LEGACY_PLUGIN_IDS = ['obsidian-getnote-importer', 'getnote-importer'] as const;
const PLUGIN_DATA_FILE = 'data.json';
const LEGACY_PLUGIN_MIGRATION_NOTICE = '已经从旧的 GetNote Importer 迁移成功，请手动停止和卸载 GetNote Importer';
const CLOSE_FLOATING_SELECTS_EVENT = 'getnote-close-floating-selects';

type PluginDataMigrationAdapter = Pick<DataAdapter, 'exists' | 'mkdir' | 'copy'>;

export async function migrateLegacyPluginData(adapter: PluginDataMigrationAdapter, currentPluginId: string): Promise<boolean> {
  if (!currentPluginId || LEGACY_PLUGIN_IDS.includes(currentPluginId as typeof LEGACY_PLUGIN_IDS[number])) return false;

  const currentDir = `.obsidian/plugins/${currentPluginId}`;
  const currentDataPath = `${currentDir}/${PLUGIN_DATA_FILE}`;

  if (await adapter.exists(currentDataPath)) return false;

  const legacyDataPath = await findExistingLegacyDataPath(adapter);
  if (!legacyDataPath) return false;

  if (!(await adapter.exists(currentDir))) {
    await adapter.mkdir(currentDir);
  }
  await adapter.copy(legacyDataPath, currentDataPath);
  return true;
}

export function notifyLegacyPluginDataMigrated(migrated: boolean): void {
  if (!migrated) return;
  new Notice(LEGACY_PLUGIN_MIGRATION_NOTICE, 10000);
}

function closeFloatingSelects(): void {
  const hostDocument = typeof activeDocument === 'undefined' ? document : activeDocument;
  const hostWindow = hostDocument.defaultView
    ?? (typeof activeWindow === 'undefined' ? window : activeWindow);
  const closeEvent = hostDocument.createEvent('Event');
  closeEvent.initEvent(CLOSE_FLOATING_SELECTS_EVENT, false, false);
  hostWindow.dispatchEvent(closeEvent);
}

async function findExistingLegacyDataPath(adapter: PluginDataMigrationAdapter): Promise<string | null> {
  for (const legacyPluginId of LEGACY_PLUGIN_IDS) {
    const legacyDataPath = `.obsidian/plugins/${legacyPluginId}/${PLUGIN_DATA_FILE}`;
    if (await adapter.exists(legacyDataPath)) return legacyDataPath;
  }
  return null;
}

function emptySyncResult(): SyncResult {
  return { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
}

function retainRecentSyncHistory(entries: SyncHistoryEntry[], now = Date.now()): SyncHistoryEntry[] {
  const cutoff = now - SYNC_HISTORY_RETENTION_MS;
  return entries.filter(entry => entry.timestamp >= cutoff);
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
      const type: SyncHistoryEntry['type'] =
        entry.type === 'selective' || entry.type === 'auto' || entry.type === 'upload' ? entry.type : 'full';
      const mode: SyncHistoryEntry['mode'] =
        entry.mode === 'selected' || entry.mode === 'knowledge-base' || entry.mode === 'auto' || entry.mode === 'time' || entry.mode === 'local-upload' || entry.mode === 'date-path'
          ? entry.mode
          : type === 'upload'
            ? 'local-upload'
          : type === 'selective'
            ? 'selected'
            : type === 'auto'
              ? 'auto'
              : 'time';
      const status: SyncHistoryEntry['status'] = entry.status === 'partial' || entry.status === 'failed' || entry.status === 'cancelled'
        ? entry.status
        : (result.failed ?? 0) > 0
          ? 'partial'
          : 'success';
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
        enabledNoteTypes: 'enabledNoteTypes' in maybeScope && Array.isArray(maybeScope.enabledNoteTypes)
          ? maybeScope.enabledNoteTypes.filter((type): type is string => typeof type === 'string')
          : undefined,
            selectedCount: typeof maybeScope.selectedCount === 'number' ? maybeScope.selectedCount : undefined,
            selectedIds: Array.isArray(maybeScope.selectedIds) ? maybeScope.selectedIds.filter((id): id is string => typeof id === 'string') : undefined,
          }
          : undefined,
        status,
        error: typeof entry.error === 'string' ? entry.error : undefined,
      };
    })
    .filter(entry => entry.timestamp >= Date.now() - SYNC_HISTORY_RETENTION_MS);
}

export default class GetNoteSyncPlugin extends Plugin {
  declare settings: Settings;
  isSyncing = false;
  isDatePathMigrationRunning = false;
  syncProgress: SyncProgressDetail = { message: '', count: '', percent: undefined, phase: 'active' };
  syncHistory: SyncHistoryEntry[] = [];
  lastSyncResult: SyncHistoryEntry | null = null;
  private currentSyncEngine: { cancel(): void } | null = null;
  private autoSyncIntervalId: number | undefined;
  private quotaTickIntervalId: number | undefined;
  private settingsTab?: GetNoteSettingsTab;
  private syncRibbonEl?: HTMLElement;
  private searchRibbonEl?: HTMLElement;
  private lastProgressUpdate = 0;
  private syncProgressResultTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncFailCount = 0;
  private desktopWebAuthManager: DesktopWebAuthManager | null = null;
  private webTokenRefreshCoordinator: WebTokenRefreshCoordinator | null = null;

  async onload(): Promise<void> {
    initI18n(getLanguage());

    try {
      const migratedLegacyData = await migrateLegacyPluginData(this.app.vault.adapter, this.manifest.id);
      notifyLegacyPluginDataMigrated(migratedLegacyData);
    } catch {
      // Migration is best-effort; startup should continue even if the vault adapter refuses the copy.
    }

    const loaded = (await this.loadData()) as Partial<Settings> | null;
    const migratedOpenApiToken = loaded?.openApiToken ?? (loaded?.authMode === 'openapi' ? loaded?.apiToken : '') ?? '';
    const migratedWebApiToken = loaded?.webApiToken ?? (loaded?.authMode === 'web' ? loaded?.apiToken : '') ?? '';
    const migratedOpenApiClientId = loaded?.openApiClientId ?? loaded?.clientId ?? '';
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      openApiToken: migratedOpenApiToken,
      openApiClientId: migratedOpenApiClientId,
      webApiToken: migratedWebApiToken,
      scheduledSync: {
        ...DEFAULT_SETTINGS.scheduledSync,
        ...loaded?.scheduledSync,
        enabledNoteTypes: migrateEnabledNoteTypes(
          'enabledNoteTypes' in (loaded?.scheduledSync ?? {}) && Array.isArray(loaded?.scheduledSync?.enabledNoteTypes)
            ? loaded.scheduledSync.enabledNoteTypes.filter((type): type is string => typeof type === 'string')
            : undefined
        ),
        syncKnowledgeBases: 'syncKnowledgeBases' in (loaded?.scheduledSync ?? {}) && Array.isArray(loaded?.scheduledSync?.syncKnowledgeBases)
          ? loaded.scheduledSync.syncKnowledgeBases.filter((id): id is string => typeof id === 'string')
          : [],
      },
      reverseSync: { ...DEFAULT_SETTINGS.reverseSync, ...loaded?.reverseSync,
        enabled: loaded?.reverseSync?.enabled === true || loaded?.reverseSync?.autoUpload?.enabled === true,
        autoUpload: undefined,
      },
      ribbonActions: { ...DEFAULT_SETTINGS.ribbonActions, ...loaded?.ribbonActions },
      syncHistory: normalizeSyncHistory(loaded?.syncHistory),
    };
    this.syncHistory = this.settings.syncHistory;
    this.lastSyncResult = this.syncHistory.filter(entry => entry.mode !== 'date-path').at(-1) ?? null;
    this.desktopWebAuthManager = createDesktopWebAuthManager({
      isDesktopApp: Platform.isDesktopApp,
    });
    if (this.desktopWebAuthManager) {
      const coordinator = new WebTokenRefreshCoordinator({
        captureToken: (validate, options) => this.desktopWebAuthManager!.captureToken(validate, options),
        validate: async token => {
          await fetchNotes({
            token,
            clientId: '',
            authMode: 'web',
            sinceId: '0',
            limit: 1,
            skipWebTokenRefresh: true,
          });
        },
        persist: async token => {
          this.settings.webApiToken = token;
          if (this.settings.authMode === 'web') this.settings.apiToken = token;
          await this.saveSettings();
          this.updateSettingsRuntimeState();
        },
        notifyFailure: () => showError(t('error.webApiSessionExpired'), 10000),
      });
      this.webTokenRefreshCoordinator = coordinator;
      setWebTokenRefreshHandler({
        getToken: () => {
          const credentials = getAuthCredentials(this.settings);
          return credentials.authMode === 'web' ? credentials.token : '';
        },
        refresh: () => coordinator.refresh(),
      });
    }

    this.app.workspace.onLayoutReady(() => {
      void this.migrateExistingTags();
    });

    this.settingsTab = new GetNoteSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.addCommand({
      id: 'sync-notes',
      name: t('command.sync'),
      callback: () => this.openManualSyncModal(),
    });

    this.addCommand({
      id: 'sync-all-subscribed-knowledge',
      name: t('command.syncAllSubscribedKnowledge'),
      callback: () => this.syncAllSubscribedKnowledge(),
    });

    this.addCommand({
      id: 'upload-local-notes',
      name: t('command.uploadLocal'),
      callback: () => this.openLocalUploadModal(),
    });

    this.addCommand({
      id: 'open-search-view',
      name: t('command.search'),
      callback: () => void this.openSearchView(),
    });

    this.registerRibbonActions();
    this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
      const selectedText = editor.getSelection().trim();
      if (!selectedText) return;
      menu.addItem(item => {
        item
          .setTitle(t('search.contextMenu'))
          .setIcon('brain-circuit')
          .onClick(() => void this.openSearchView(selectedText));
      });
    }));

    // Clear stale quota-exhausted state if it's from a prior UTC+8 day
    await this.clearStaleQuotaState();

    // Always run the hourly quota check so the banner clears at UTC+8 midnight
    // even for users who never enable auto-sync.
    if (this.quotaTickIntervalId === undefined) {
      this.quotaTickIntervalId = window.setInterval(() => this.clearStaleQuotaState(), 60 * 60 * 1000);
      this.registerInterval(this.quotaTickIntervalId);
    }


    if (this.settings.scheduledSync.enabled) {
      if (this.settings.scheduledSync.syncOnStart) {
        void this.doAutoSync();
      }
      this.startAutoSync();
    }

  }

  onunload(): void {
    this.stopAutoSync();
    this.currentSyncEngine?.cancel();
    if (this.syncProgressResultTimer) clearTimeout(this.syncProgressResultTimer);
    setWebTokenRefreshHandler(null);
    this.webTokenRefreshCoordinator = null;
    this.desktopWebAuthManager?.dispose();
  }

  isDesktopWebAuthAvailable(): boolean {
    return this.desktopWebAuthManager !== null;
  }

  async captureDesktopWebToken(): Promise<string> {
    if (!this.desktopWebAuthManager) throw new Error(t('settings.webAuth.desktopOnly'));
    return this.desktopWebAuthManager.captureToken(async token => {
      await fetchNotes({
        token,
        clientId: '',
        authMode: 'web',
        sinceId: '0',
        limit: 1,
        skipWebTokenRefresh: true,
      });
    });
  }

  async clearDesktopWebAuthSession(): Promise<void> {
    await this.desktopWebAuthManager?.clearSession();
  }

  private registerRibbonActions(): void {
    this.syncRibbonEl = this.addRibbonIcon('book-lock', t('ribbon.tooltip'), () => this.openManualSyncModal(true));
    this.searchRibbonEl = this.addRibbonIcon('brain-circuit', t('ribbon.searchTooltip'), () => void this.openSearchView());
    this.refreshRibbonActions();
  }

  refreshRibbonActions(): void {
    this.syncRibbonEl?.classList.toggle('getnote-ribbon-action-hidden', !this.settings.ribbonActions.sync);
    this.searchRibbonEl?.classList.toggle('getnote-ribbon-action-hidden', !this.settings.ribbonActions.search);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }


  async applyDatePathSettings(
    target: DatePathMigrationTarget,
    options: DatePathMigrationOptions = {},
  ): Promise<DatePathMigrationResult> {
    if (this.isSyncing) throw new Error('Cannot reorganize date paths while sync is running');
    if (this.isDatePathMigrationRunning) throw new Error('Date-path migration is already running');
    const format = target.format.trim();
    if (!validateDatePathFormat(format)) throw new Error('Invalid date path format');

    this.isDatePathMigrationRunning = true;
    const previous = {
      enabled: this.settings.datePathEnabled,
      format: this.settings.datePathFormat,
      categoryOrigins: this.settings.datePathCategoryOrigins,
      assetMoveEvidence: this.settings.datePathAssetMoveEvidence,
    };
    let targetPersisted = false;
    try {
      this.settings.datePathEnabled = target.enabled;
      this.settings.datePathFormat = format;
      try {
        const startedAt = Date.now();
        const result = await migrateDatePaths(
          this.app,
          this.settings.folderName,
          { enabled: target.enabled, format },
          {
            source: { enabled: previous.enabled, format: previous.format },
            categoryOrigins: previous.categoryOrigins,
            assetMoveEvidence: previous.assetMoveEvidence,
            rebuildCategories: options.rebuildCategories,
            beforeExecute: async (categoryOrigins, assetMoveEvidence) => {
              this.settings.datePathCategoryOrigins = categoryOrigins;
              this.settings.datePathAssetMoveEvidence = assetMoveEvidence;
              await this.saveSettings();
              targetPersisted = true;
            },
          },
        );
        await this.recordDatePathMigrationHistory(result, startedAt);
        return result;
      } catch (error) {
        if (!targetPersisted) {
          this.settings.datePathEnabled = previous.enabled;
          this.settings.datePathFormat = previous.format;
          this.settings.datePathCategoryOrigins = previous.categoryOrigins;
          this.settings.datePathAssetMoveEvidence = previous.assetMoveEvidence;
        }
        throw error;
      }
    } finally {
      this.isDatePathMigrationRunning = false;
    }
  }

  async previewDatePathSettings(
    target: DatePathMigrationTarget,
    options: DatePathMigrationOptions = {},
  ): Promise<DatePathMigrationResult> {
    if (this.isSyncing) throw new Error('Cannot reorganize date paths while sync is running');
    if (this.isDatePathMigrationRunning) throw new Error('Date-path migration is already running');
    const format = target.format.trim();
    if (!validateDatePathFormat(format)) throw new Error('Invalid date path format');

    return migrateDatePaths(
      this.app,
      this.settings.folderName,
      { enabled: target.enabled, format },
      {
        source: {
          enabled: this.settings.datePathEnabled,
          format: this.settings.datePathFormat,
        },
        categoryOrigins: this.settings.datePathCategoryOrigins,
        assetMoveEvidence: this.settings.datePathAssetMoveEvidence,
        rebuildCategories: options.rebuildCategories,
        dryRun: true,
        beforeExecute: async () => {},
      },
    );
  }

  /**
   * If a previously recorded quota check happened on a prior calendar day in
   * UTC+8, the daily quota has since reset — clear the exhausted state so the
   * banner goes away without requiring a successful sync first.
   */
  private async clearStaleQuotaState(): Promise<void> {
    const state = this.settings.lastQuotaState;
    if (!state?.exhausted || state.reason !== 'quota_day' || !state.checkedAt) return;
    const checkedAt = new Date(state.checkedAt);
    if (Number.isNaN(checkedAt.getTime())) return;
    // Compute the UTC+8 day boundary at the moment the check happened
    const tzOffsetMin = checkedAt.getTimezoneOffset() + (-8 * 60);
    const localDate = new Date(checkedAt.getTime() - tzOffsetMin * 60 * 1000);
    const checkedDay = localDate.toISOString().slice(0, 10);
    const nowLocal = new Date(Date.now() - (new Date().getTimezoneOffset() + -8 * 60) * 60 * 1000);
    const today = nowLocal.toISOString().slice(0, 10);
    if (checkedDay !== today) {
      this.settings.lastQuotaState = undefined;
      resetQuotaState();
      await this.saveSettings();
      this.updateSettingsRuntimeState();
    }
  }

  private async migrateExistingTags(): Promise<void> {
    if (this.settings.tagMigrationVersion >= TAG_MIGRATION_VERSION) return;

    try {
      const result = await migrateSyncedNoteTags(this.app.vault, this.settings.folderName);
      if (result.scanned === 0) return;
      this.settings.tagMigrationVersion = TAG_MIGRATION_VERSION;
      await this.saveSettings();
    } catch (error) {
      console.error('[DedaoBrain] Failed to migrate synced note tags', error);
    }
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

  private updateSettingsRuntimeState(): void {
    this.settingsTab?.updateRuntimeState();
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
    type: SyncHistoryEntry['type'],
    startedAt: number,
    scope: SyncHistoryScope,
    status: SyncHistoryEntry['status'] = 'success',
    error?: string,
    mode?: SyncHistoryEntry['mode'],
    updateLastSyncResult = true,
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
      mode: mode ?? (type === 'selective' ? 'selected' : type === 'auto' ? 'auto' : type === 'upload' ? 'local-upload' : 'time'),
      scope,
      status,
      error,
    };
    this.syncHistory.push(entry);
    this.syncHistory = retainRecentSyncHistory(this.syncHistory);
    this.settings.syncHistory = this.syncHistory;

    // Incrementally merge newly observed tag names into the local cache.
    // The SyncEngine exposes any tag names it observed during the sync in
    // `result.observedTags` (populated lazily — older SyncResult payloads may
    // not include it, so default to an empty array).
    const observedTags = ((result as { observedTags?: string[] }).observedTags ?? []);
    if (observedTags.length > 0 || scope.syncTags?.length) {
      const incoming = Array.from(new Set([
        ...observedTags,
        ...(scope.syncTags ?? []),
      ]));
      this.settings.tagCache = mergeTagCache(this.settings.tagCache, incoming);
    }

    // lastSyncEndTimestamp only belongs to auto sync
    // Ordinary partial failures may still advance; retryable knowledge-base failures keep the old checkpoint.
    if (type === 'auto' && (status === 'success' || status === 'partial') && !result.checkpointBlocked) {
      this.settings.lastSyncEndTimestamp = result.lastNoteTimestamp ?? new Date(finishedAt).toISOString();
    }

    if (updateLastSyncResult) this.lastSyncResult = entry;
    await this.saveSettings();
  }

  private async recordDatePathMigrationHistory(
    result: DatePathMigrationResult,
    startedAt: number,
  ): Promise<void> {
    const items = result.issues.map(migrationIssue => ({
      noteId: migrationIssue.uid ?? migrationIssue.path,
      title: migrationIssue.path,
      noteType: 'plain_text',
      updatedAt: new Date().toISOString(),
      status: migrationIssue.code === 'rename-failed' || migrationIssue.code === 'rollback-failed'
        ? 'failed' as const
        : 'skipped' as const,
      error: migrationIssue.message,
    }));
    await this.recordSyncHistory(
      {
        created: result.moved,
        updated: 0,
        skipped: result.skipped,
        failed: result.failed,
        total: result.scanned,
        items,
      },
      'full',
      startedAt,
      { maxDays: 0, syncStartDate: '' },
      result.failed > 0 ? 'partial' : 'success',
      undefined,
      'date-path',
      false,
    );
    this.updateSettingsRuntimeState();
  }

  /** Reconcile only existing text notes returned by this download's filters. */
  private async reconcileDownloadedNotes(result: SyncResult, automatic: boolean): Promise<void> {
    const ids = [...new Set((result.items ?? []).filter(item => item.status === 'skipped' && item.noteType === 'plain_text')
      .map(item => item.noteId))];
    if (!ids.length) return;
    const reconciler = new BidirectionalSyncEngine(this.app, this.settings,
      automatic ? undefined : conflict => resolveSyncConflict(this.app, conflict, 'download'));
    this.currentSyncEngine = reconciler;
    let changes: SyncResult;
    try {
      changes = await reconciler.sync(ids, { direction: 'download' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new SyncCancelledError();
      throw error;
    }
    const reconciled = new Set((changes.items ?? []).map(item => item.noteId));
    result.items = (result.items ?? []).filter(item => {
      if (!reconciled.has(item.noteId)) return true;
      result[item.status]--; result.total--;
      return false;
    });
    for (const key of ['created', 'updated', 'skipped', 'failed', 'total'] as const) result[key] += changes[key];
    result.items.push(...(changes.items ?? []));
  }

  private async runSync(
    type: 'full' | 'selective' | 'auto',
    scopeOptions?: Partial<SyncScopeOptions>,
    selectedIds?: string[]
  ): Promise<void> {
    if (this.isSyncing || this.isDatePathMigrationRunning) return;
    const credentials = getAuthCredentials(this.settings);
    if (!credentials.token || (credentials.authMode !== 'web' && !credentials.clientId)) {
      showError(t('notice.fillCredentials'));
      return;
    }

    const startedAt = Date.now();
    const resolvedSyncStartDate = scopeOptions?.syncStartDate ?? this.settings.syncStartDate;
    const resolvedEnabledNoteTypes = scopeOptions?.enabledNoteTypes;
    const resolvedSyncTags = scopeOptions?.syncTags;
    const resolvedScope: SyncHistoryScope = {
      maxDays: resolvedSyncStartDate ? 0 : scopeOptions?.maxDays ?? this.settings.maxDays,
      syncStartDate: resolvedSyncStartDate,
      ...(resolvedEnabledNoteTypes !== undefined ? { enabledNoteTypes: resolvedEnabledNoteTypes } : {}),
      ...(resolvedSyncTags !== undefined && resolvedSyncTags.length > 0 ? { syncTags: resolvedSyncTags } : {}),
      selectedCount: selectedIds?.length,
      selectedIds,
    };
    this.isSyncing = true;
    this.syncProgress = { message: t('sync.fetching', { page: 1 }), count: '', percent: undefined, phase: 'active' };
    this.currentSyncEngine = null;
    this.updateSettingsRuntimeState();
    showNotice(t('sync.started'));

    const engine = new SyncEngine(this.app, this.settings, (info) => this.setProgress(info), scopeOptions);
    this.currentSyncEngine = engine;
    engine.setOnCancel(() => this.cancelSync());
    let shouldResetSyncState = type === 'auto';

    try {
      const result = selectedIds
        ? await engine.syncNoteIds(selectedIds)
        : await engine.sync();
      if (type === 'auto' && this.settings.reverseSync.enabled && credentials.authMode === 'openapi') {
        const reconciler = new BidirectionalSyncEngine(this.app, this.settings,
          type === 'auto' ? undefined : conflict => resolveSyncConflict(this.app, conflict, 'both'));
        this.currentSyncEngine = reconciler;
        const changes = await reconciler.sync(undefined, { direction: 'both' });
        const reconciledIds = new Set((changes.items ?? []).map(item => item.noteId));
        result.items = (result.items ?? []).filter(item => {
          if (item.status !== 'skipped' || !reconciledIds.has(item.noteId)) return true;
          result.skipped--;
          result.total--;
          return false;
        });
        result.created += changes.created;
        result.updated += changes.updated;
        result.skipped += changes.skipped;
        result.failed += changes.failed;
        result.total += changes.total;
        (result.items ??= []).push(...(changes.items ?? []));
      }
      else await this.reconcileDownloadedNotes(result, type === 'auto');

      const status: SyncHistoryEntry['status'] = result.failed > 0 ? 'partial' : 'success';
      await this.recordSyncHistory(result, type, startedAt, resolvedScope, status);

        // Clear exhausted quota state on successful sync
        if (credentials.authMode === 'openapi' && this.settings.lastQuotaState?.exhausted) {
          this.settings.lastQuotaState = undefined;
          resetQuotaState();
          await this.saveSettings();
        }

      if (type === 'auto') {
        if (status === 'partial') {
          this.autoSyncFailCount++;
          if (this.autoSyncFailCount === 3) {
            showError(t('notice.autoSyncPartialThreshold'));
          }
        } else {
          this.autoSyncFailCount = 0;
        }
        if (status === 'success' && (result.created > 0 || result.updated > 0 || result.skipped > 0)) {
          showNotice(t('notice.autoSynced', { created: result.created, updated: result.updated, skipped: result.skipped }));
        }
      } else {
        if (status === 'partial') {
          showError(t('notice.syncPartial', {
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
          }), 15000);
        } else {
          showSuccess(t('notice.syncComplete', {
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            failed: '',
          }), 8000);
        }
        this.finishSyncProgress(
          status === 'partial' ? 'failed' : 'success',
          status === 'partial'
            ? t('notice.syncPartial', {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
              failed: result.failed,
            })
            : t('notice.syncComplete', {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
              failed: '',
            }),
        );
        return;
      }
      this.finishSyncProgress(
        status === 'partial' ? 'failed' : 'success',
        status === 'partial' ? t('notice.syncPartial', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
        }) : t('notice.syncComplete', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: '',
        }),
      );
      shouldResetSyncState = false;
    } catch (err) {
      if (err instanceof SyncCancelledError) {
        await this.recordSyncHistory(emptySyncResult(), type, startedAt, resolvedScope, 'cancelled');
        this.finishSyncProgress('cancelled', t('modal.cancelled'));
        shouldResetSyncState = false;
      } else {
        const error = err instanceof Error ? err.message : String(err);
        await this.recordSyncHistory(emptySyncResult(), type, startedAt, resolvedScope, 'failed', error);

        const isQuotaExceeded = error.includes('配额') || error.includes('quota') || error.includes('429');
        if (credentials.authMode === 'openapi' && isQuotaExceeded) {
          this.settings.lastQuotaState = getLastQuotaState();
          await this.saveSettings();
        }

        if (type === 'auto') {
          this.autoSyncFailCount++;
          const isAuthError = error.includes('401') || error.includes('鉴权') || error.includes('Token 无效') || error.includes('Invalid') || error.includes('unauthorized') || error.includes('expired');
          if (isQuotaExceeded) {
            this.stopAutoSync();
            this.settings.scheduledSync.enabled = false;
            showError(t('notice.quotaExceededStop'));
          } else if (isAuthError) {
            showError(t('notice.autoSyncAuthFailed', { msg: error }));
          } else {
            showError(t('notice.autoSyncFailedWithMsg', { msg: error }));
          }
          this.finishSyncProgress('failed', t('notice.syncFailed', { msg: error }));
          shouldResetSyncState = false;
        } else {
          this.finishSyncProgress('failed', t('notice.syncFailed', { msg: error }));
          console.error(t('console.syncError'), err);
          shouldResetSyncState = false;
        }
      }
    } finally {
      if (shouldResetSyncState) {
        this.isSyncing = false;
        this.currentSyncEngine = null;
        if (type === 'auto') {
          this.syncProgress = { message: '', count: '', percent: undefined, phase: 'active' };
        }
        this.updateSettingsRuntimeState();
      }
    }
  }

  private doAutoSync(): void {
    // Auto sync uses lastSyncEndTimestamp as cutoff: skip notes already synced last time.
    // This IS the early-exit mechanism — no separate lastSyncEndTimestamp logic needed in engine.
    const syncStartDate = this.settings.lastSyncEndTimestamp || this.settings.syncStartDate;
    const enabledNoteTypes = this.settings.scheduledSync.enabledNoteTypes;
    const syncTags = this.settings.syncTags;
    const syncKnowledgeBases = this.settings.scheduledSync.syncKnowledgeBases;
    const knowledgeBaseNames = this.settings.scheduledSync.syncKnowledgeBases?.length
      ? Object.fromEntries(
          (this.settings.knowledgeBaseCache?.entries ?? [])
            .filter(entry => this.settings.scheduledSync.syncKnowledgeBases!.includes(entry.topicId))
            .map(entry => [entry.topicId, entry.name])
        )
      : undefined;
    const scopeOptions: Partial<SyncScopeOptions> = syncStartDate
      ? {
          syncStartDate,
          maxDays: 0,
          ...(enabledNoteTypes !== undefined ? { enabledNoteTypes } : {}),
          ...(syncTags !== undefined && syncTags.length > 0 ? { syncTags } : {}),
          ...(syncKnowledgeBases?.length ? { syncKnowledgeBases } : {}),
          ...(knowledgeBaseNames ? { knowledgeBaseNames } : {}),
          knowledgeBaseEntries: this.settings.knowledgeBaseCache?.entries,
        }
      : {
          ...(enabledNoteTypes !== undefined ? { enabledNoteTypes } : {}),
          ...(syncTags !== undefined && syncTags.length > 0 ? { syncTags } : {}),
          ...(syncKnowledgeBases?.length ? { syncKnowledgeBases } : {}),
          ...(knowledgeBaseNames ? { knowledgeBaseNames } : {}),
          knowledgeBaseEntries: this.settings.knowledgeBaseCache?.entries,
        };
    void this.runSync('auto', scopeOptions);
  }

  private setProgress(info: { page?: number; processed?: number; total?: number; created?: number; updated?: number; skipped?: number; failed?: number; percent?: number }) {
    this.syncProgress = {
      message: info.page ? t('sync.fetching', { page: info.page }) : t('sync.syncing'),
      count: info.processed && info.total
        ? t('sync.processingCount', { current: info.processed, total: info.total })
        : '',
      percent: info.percent,
      phase: 'active',
    };
    const now = Date.now();
    if (now - this.lastProgressUpdate > 300) {
      this.lastProgressUpdate = now;
      this.updateSettingsRuntimeState();
    }
  }

  private finishSyncProgress(phase: 'success' | 'failed' | 'cancelled', message: string): void {
    this.isSyncing = false;
    this.currentSyncEngine = null;
    this.syncProgress = {
      message,
      count: '',
      percent: phase === 'success' ? 100 : undefined,
      phase,
    };
    this.updateSettingsRuntimeState();
    if (this.syncProgressResultTimer) clearTimeout(this.syncProgressResultTimer);
    this.syncProgressResultTimer = setTimeout(() => {
      if (this.syncProgress.phase !== phase || this.syncProgress.message !== message) return;
      this.syncProgress = { message: '', count: '', percent: undefined, phase: 'active' };
      this.syncProgressResultTimer = null;
      this.updateSettingsRuntimeState();
    }, 3000);
  }

  openManualSyncModal(showOpenSettings = false): void {
    if (this.isDatePathMigrationRunning) return;
    closeFloatingSelects();
    const wrapper = new ManualSyncModalWrapper(this.app, this, showOpenSettings);
    wrapper.open();
  }

  openSettingsTab(): void {
    // Obsidian's `app.setting` is internal API; the public TypeScript
    // bindings (1.13+) do not expose it, but the runtime still supports
    // it. Revisit if Obsidian ships a public replacement.
    // @ts-expect-error — internal API, see comment above
    this.app.setting.open();
    // @ts-expect-error — internal API, see comment above
    this.app.setting.openTabById(this.manifest.id);
  }

  startSync(scopeOptions: SyncScopeOptions): void {
    void this.runSync('full', scopeOptions);
  }

  openNotePicker(): void {
    if (this.isDatePathMigrationRunning) return;
    closeFloatingSelects();
    const wrapper = new NotePickerModalWrapper(this.app, this);
    wrapper.open();
  }

  syncSelectedNotes(noteIds: string[], enabledNoteTypes?: string[], syncTags?: string[]): void {
    void this.runSync('selective', {
      maxDays: 0,
      syncStartDate: '',
      ...(enabledNoteTypes !== undefined ? { enabledNoteTypes } : {}),
      ...(syncTags !== undefined ? { syncTags } : {}),
    }, noteIds);
  }

  async syncSearchResult(noteId: string): Promise<void> {
    await this.runSync('selective', { maxDays: 0, syncStartDate: '' }, [noteId]);
  }

  openSearchView(query = ''): void {
    new GetNoteSearchModal(this.app, this, query).open();
  }

  async searchRecall(query: string, signal: AbortSignal): Promise<RecallSearchResult[]> {
    const credentials = getAuthCredentials(this.settings);
    if (!credentials.token || !credentials.clientId) {
      throw new Error(t('notice.fillCredentials'));
    }
    return fetchRecallSearch({
      query,
      token: credentials.token,
      clientId: credentials.clientId,
      authMode: credentials.authMode,
      signal,
      topK: 10,
    });
  }

  findSyncedNoteFile(noteId: string): TFile | null {
    return findSyncedNoteFile(this.app, this.settings.folderName, noteId);
  }

  async openLocalNote(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  syncSubscribedKnowledge(): void {
    if (this.isDatePathMigrationRunning) return;
    closeFloatingSelects();
    const wrapper = new TopicPickerModalWrapper(this.app, this);
    wrapper.open();
  }

  syncSubscribedKnowledgeNotes(selection: string[] | TopicPickerSelection): void {
    const syncOptions = Array.isArray(selection)
      ? { selectedNoteIds: selection }
      : selection;
    void this.runSubscribedKnowledgeSync(syncOptions);
  }

  syncAllSubscribedKnowledge(): void {
    void this.runSubscribedKnowledgeSync({ syncAll: true });
  }


  private async runSubscribedKnowledgeSync(syncOptions?: TopicPickerSelection): Promise<void> {
    if (this.isSyncing || this.isDatePathMigrationRunning) return;
    const credentials = getAuthCredentials(this.settings);
    if (!credentials.token || (credentials.authMode !== 'web' && !credentials.clientId)) {
      showError(t('notice.fillCredentials'));
      return;
    }

    const startedAt = Date.now();
    this.isSyncing = true;
    this.syncProgress = { message: t('sync.subscribedKnowledge.fetching'), count: '', percent: undefined, phase: 'active' };
    this.currentSyncEngine = null;
    this.updateSettingsRuntimeState();
    showNotice(t('sync.subscribedKnowledge.started'));

    const engine = new SyncEngine(this.app, this.settings, (info) => this.setProgress(info), {
      syncTags: syncOptions?.syncTags,
    });
    this.currentSyncEngine = engine;
    engine.setOnCancel(() => this.cancelSync());

    let progressFinished = false;
    try {
      const result = await engine.syncSubscribedKnowledge(undefined, syncOptions);
      await this.reconcileDownloadedNotes(result, false);
      await this.recordSyncHistory(result, 'full', startedAt, {
        maxDays: 0,
        syncStartDate: '',
        selectedCount: syncOptions?.selectedNoteIds?.length,
        selectedIds: syncOptions?.selectedNoteIds,
      }, result.failed > 0 ? 'partial' : 'success', undefined, 'knowledge-base');
      if (result.failed > 0) {
        showError(t('notice.syncPartial', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
        }), 15000);
      } else {
        showSuccess(t('notice.syncComplete', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: '',
        }), 8000);
      }
      this.finishSyncProgress(
        result.failed > 0 ? 'failed' : 'success',
        result.failed > 0 ? t('notice.syncPartial', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
        }) : t('notice.syncComplete', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: '',
        }),
      );
      progressFinished = true;
    } catch (err) {
      if (err instanceof SyncCancelledError) {
        await this.recordSyncHistory(emptySyncResult(), 'full', startedAt, {
          maxDays: 0,
          syncStartDate: '',
          selectedCount: syncOptions?.selectedNoteIds?.length,
          selectedIds: syncOptions?.selectedNoteIds,
        }, 'cancelled', undefined, 'knowledge-base');
        this.finishSyncProgress('cancelled', t('modal.cancelled'));
        progressFinished = true;
        return;
      }
      const error = err instanceof Error ? err.message : String(err);
      await this.recordSyncHistory(emptySyncResult(), 'full', startedAt, {
        maxDays: 0,
        syncStartDate: '',
        selectedCount: syncOptions?.selectedNoteIds?.length,
        selectedIds: syncOptions?.selectedNoteIds,
      }, 'failed', error, 'knowledge-base');
      this.finishSyncProgress('failed', t('notice.syncFailed', { msg: error }));
      progressFinished = true;
      console.error(t('console.syncError'), err);
      showError(t('notice.syncFailed', { msg: error }));
    } finally {
      if (!progressFinished) {
        this.isSyncing = false;
        this.currentSyncEngine = null;
        this.syncProgress = { message: '', count: '', percent: undefined, phase: 'active' };
        this.updateSettingsRuntimeState();
      }
    }
  }

  openLocalUploadModal(): void {
    if (this.isDatePathMigrationRunning) return;
    const credentials = getAuthCredentials(this.settings);
    if (!credentials.token || (credentials.authMode !== 'web' && !credentials.clientId)) {
      showError(t('notice.fillCredentials'));
      return;
    }
    closeFloatingSelects();
    const wrapper = new LocalUploadModalWrapper(this.app, this);
    wrapper.open();
  }

  uploadSelectedLocalNotes(files: TFile[]): void {
    void this.reverseSyncToGetNote(files);
  }

  private async reverseSyncToGetNote(files?: TFile[]): Promise<void> {
    if (this.isSyncing || this.isDatePathMigrationRunning) return;
    const startedAt = Date.now();
    this.isSyncing = true;
    this.syncProgress = { message: t('reverseSync.running'), count: '', percent: undefined, phase: 'active' };
    this.updateSettingsRuntimeState();

    let progressFinished = false;
    try {
      const engine = new ReverseSyncEngine(this.app, this.settings, (progress) => {
        const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : undefined;
        this.syncProgress = {
          message: t('reverseSync.running'),
          count: `${t('modal.countProgress', { processed: progress.processed })} ${progress.title}`,
          percent,
          phase: 'active',
        };
        this.updateSettingsRuntimeState();
      });
      this.currentSyncEngine = engine;
      const result = files ? await engine.syncFiles(files) : await engine.syncBack();
      await this.recordUploadHistory(result, startedAt, files?.map(file => file.path));
      if (result.failed > 0) {
        showError(t('notice.syncPartial', {
          created: result.created,
          updated: 0,
          skipped: result.skipped,
          failed: result.failed,
        }), 15000);
      } else {
        showSuccess(t('reverseSync.complete', {
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
        }), 8000);
      }
      this.finishSyncProgress(
        result.failed > 0 ? 'failed' : 'success',
        result.failed > 0 ? t('notice.syncPartial', {
          created: result.created,
          updated: 0,
          skipped: result.skipped,
          failed: result.failed,
        }) : t('reverseSync.complete', {
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
      progressFinished = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        await this.recordUploadHistory({
          created: 0,
          skipped: 0,
          failed: 0,
          total: files?.length ?? 0,
          items: [],
        }, startedAt, files?.map(file => file.path), t('modal.cancelled'), 'cancelled');
        this.finishSyncProgress('cancelled', t('modal.cancelled'));
        progressFinished = true;
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.recordUploadHistory({
        created: 0,
        skipped: 0,
        failed: files?.length ?? 0,
        total: files?.length ?? 0,
        items: (files ?? []).map(file => ({
          noteId: file.path,
          title: file.basename || file.path.split('/').pop()?.replace(/\.md$/i, '') || file.path,
          noteType: 'plain_text',
          updatedAt: new Date().toISOString(),
          status: 'failed',
          error: message,
        })),
      }, startedAt, files?.map(file => file.path), message);
      this.finishSyncProgress('failed', t('reverseSync.failed', { msg: message }));
      progressFinished = true;
      showError(t('reverseSync.failed', { msg: message }));
      return;
    } finally {
      if (!progressFinished) {
        this.isSyncing = false;
        this.currentSyncEngine = null;
        this.syncProgress = { message: '', count: '', percent: undefined, phase: 'active' };
        this.updateSettingsRuntimeState();
      }
    }
  }

  private async recordUploadHistory(
    result: ReverseSyncResult,
    startedAt: number,
    selectedIds?: string[],
    error?: string,
    status?: SyncHistoryEntry['status']
  ): Promise<void> {
    const syncResult: SyncResult = {
      created: result.created,
      updated: 0,
      skipped: result.skipped,
      failed: result.failed,
      total: result.total,
      items: result.items,
    };
    await this.recordSyncHistory(
      syncResult,
      'upload',
      startedAt,
      {
        maxDays: 0,
        syncStartDate: '',
        selectedCount: selectedIds?.length,
        selectedIds,
      },
      status ?? (error ? 'failed' : result.failed > 0 ? 'partial' : 'success'),
      error ?? (result.failed > 0 ? t('reverseSync.failedCount', { failed: result.failed }) : undefined)
    );
  }
}

class GetNoteSearchModal extends Modal {
  private readonly autoSearchKey: number;

  constructor(app: App, private plugin: GetNoteSyncPlugin, private query = '') {
    super(app);
    this.autoSearchKey = query.trim() ? 1 : 0;
    this.titleEl.textContent = t('search.title');
    this.modalEl.classList.add('getnote-search-modal');
  }

  onOpen(): void {
    ReactDOM.render(
      <SearchPanel
        initialQuery={this.query}
        autoSearchKey={this.autoSearchKey}
        onSearch={(query, signal) => this.plugin.searchRecall(query, signal)}
        resolveLocalFile={(noteId) => this.plugin.findSyncedNoteFile(noteId)}
        onOpenLocal={(file) => this.plugin.openLocalNote(file)}
        onSyncNote={(noteId) => this.plugin.syncSearchResult(noteId)}
      />,
      this.contentEl
    );
  }

  onClose(): void {
    ReactDOM.unmountComponentAtNode(this.contentEl);
  }
}

class ManualSyncModalWrapper extends Modal {
  constructor(
    app: App,
    private plugin: GetNoteSyncPlugin,
    private showOpenSettings: boolean,
  ) {
    super(app);
    this.titleEl.setText(t('manualSync.title'));
  }

  onOpen() {
    ReactDOM.render(
      <ManualSyncModal
        initialOptions={{
          syncStartDate: this.plugin.settings.syncStartDate,
          maxDays: this.plugin.settings.maxDays,
          syncTags: this.plugin.settings.syncTags,
        }}
        tagOptions={this.plugin.settings.tagCache?.tags ?? []}
        {...(this.showOpenSettings ? {
          onOpenSettings: () => {
            this.close();
            this.plugin.openSettingsTab();
          },
        } : {})}
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
        token={getAuthCredentials(this.plugin.settings).token}
        clientId={getAuthCredentials(this.plugin.settings).clientId}
        authMode={getAuthCredentials(this.plugin.settings).authMode}
        abortSignal={this.abortController.signal}
        initialSyncTags={this.plugin.settings.syncTags ?? []}
        tagOptions={this.plugin.settings.tagCache?.tags ?? []}
        onConfirm={(noteIds, enabledNoteTypes, syncTags) => {
          this.abortController.abort();
          this.close();
          this.plugin.syncSelectedNotes(noteIds, enabledNoteTypes, syncTags);
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

class TopicPickerModalWrapper extends Modal {
  private abortController = new AbortController();

  constructor(app: App, private plugin: GetNoteSyncPlugin) {
    super(app);
    this.titleEl.setText(t('topicPicker.title'));
  }

  onOpen() {
    ReactDOM.render(
      <TopicPickerModal
        token={getAuthCredentials(this.plugin.settings).token}
        clientId={getAuthCredentials(this.plugin.settings).clientId}
        authMode={getAuthCredentials(this.plugin.settings).authMode}
        abortSignal={this.abortController.signal}
        initialSyncTags={this.plugin.settings.syncTags ?? []}
        tagOptions={this.plugin.settings.tagCache?.tags ?? []}
        onConfirm={(selection) => {
          this.abortController.abort();
          this.close();
          this.plugin.syncSubscribedKnowledgeNotes(selection);
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

class LocalUploadModalWrapper extends Modal {
  constructor(app: App, private plugin: GetNoteSyncPlugin) {
    super(app);
    this.titleEl.setText(t('upload.title'));
  }

  onOpen() {
    ReactDOM.render(
      <LocalUploadModal
        files={this.app.vault.getMarkdownFiles()}
        initialFolder={this.plugin.settings.reverseSync.uploadFolder || this.plugin.settings.folderName}
        syncFolder={this.plugin.settings.folderName}
        onConfirm={(files) => {
          this.close();
          this.plugin.uploadSelectedLocalNotes(files);
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
