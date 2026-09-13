import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { SettingItem } from './setting-item';
import { SyncButton } from './sync-button';
import { OAuthButton } from './oauth-button';
import { openSyncHistoryModal } from '../ui/sync-history-modal';
import { NoteTypeSelect } from '../ui/note-type-select';
import { TagSelect } from '../ui/tag-select';
import { KnowledgeBaseSelect } from '../ui/knowledge-base-select';
import { Toggle } from './toggle';
import { getAuthCredentials, type AttachmentImportSettings, type AuthMode, type Settings, type SyncHistoryEntry, type SyncProgressDetail } from '../types';
import { App, AbstractInputSuggest } from 'obsidian';
import { fetchNotes } from '../api';
import { t } from '../i18n';
import { ExternalLink } from './external-link';
import { getLocalDateInputValue } from '../ui/date-input';
import { validateDatePathFormat } from '../date-paths';
import type {
  DatePathMigrationIssueCode,
  DatePathMigrationOptions,
  DatePathMigrationResult,
  DatePathMigrationTarget,
} from '../date-path-migration';
import type { DatePathConfirmationRequest } from '../ui/date-path-confirm-modal';

type SuggestionProvider = (query: string) => string[];

class PathSuggest extends AbstractInputSuggest<string> {
  private readonly el: HTMLInputElement;
  private readonly getPaths: SuggestionProvider;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    getPaths: SuggestionProvider,
    onSelect: (value: string) => void,
  ) {
    super(app, inputEl);
    this.el = inputEl;
    this.getPaths = getPaths;
    this.onSelect((value) => onSelect(value));
  }

  getSuggestions(query: string): string[] {
    return this.getPaths(query);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.el.value = value;
    this.el.dispatchEvent(new Event('input'));
    this.close();
  }
}

function getFolderSuggestions(app: App, query: string): string[] {
  const normalizedQuery = (query ?? '').toLowerCase();
  return app.vault
    .getAllFolders()
    .map(folder => folder.path)
    .filter(path => !normalizedQuery || path.toLowerCase().includes(normalizedQuery));
}

function getTemplateFileSuggestions(app: App, query: string): string[] {
  const normalizedQuery = (query ?? '').trim().toLowerCase();
  return Array.from(new Set(
    app.vault
      .getMarkdownFiles()
      .map(file => file.path)
      .filter(Boolean),
  ))
    .filter(path => !normalizedQuery || path.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 50);
}

export type OnboardingState = 'first-run' | 'needs-credentials' | 'needs-auto-sync' | 'ready' | 'configured';
export type ConnectionHealth = 'unverified' | 'healthy' | 'error';

function getLatestAutomaticSync(syncHistory: SyncHistoryEntry[]): SyncHistoryEntry | undefined {
  for (let index = syncHistory.length - 1; index >= 0; index -= 1) {
    const entry = syncHistory[index];
    if (entry.type === 'auto' || entry.mode === 'auto') return entry;
  }
  return undefined;
}

export function inferConnectionHealth(syncHistory: SyncHistoryEntry[]): ConnectionHealth {
  const latestAutomaticSync = getLatestAutomaticSync(syncHistory);
  if (latestAutomaticSync?.status === 'success') return 'healthy';
  if (latestAutomaticSync?.status === 'failed') return 'error';
  return 'unverified';
}

export function computeOnboardingState(settings: Settings): OnboardingState {
  const hasHistory = settings.syncHistory.length > 0;
  const hasAutoSyncHistory = settings.syncHistory.some(entry => entry.type === 'auto' || entry.mode === 'auto');
  const hasCredentials = getAuthCredentials(settings).token !== '';
  if (!hasCredentials) return hasHistory ? 'needs-credentials' : 'first-run';
  if (!settings.scheduledSync.enabled) return 'needs-auto-sync';
  return hasAutoSyncHistory ? 'configured' : 'ready';
}

interface SettingsComponentProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  startSync: () => void;
  isSyncing: boolean;
  openNotePicker: () => void;
  startSubscribedKnowledgeSync: () => void;
  openLocalUpload: () => void;
  startAutoSync: () => void;
  stopAutoSync: () => void;
  cancelSync: () => void;
  app: App;
  syncProgress?: SyncProgressDetail;
  lastSyncTime?: number;
  syncHistory?: SyncHistoryEntry[];
  initialKnowledgeBaseCache?: { entries: Array<{ topicId: string; name: string; source?: 'subscribed' | 'created' }>; cacheUpdatedAt?: number };
  applyDatePathSettings?: (target: DatePathMigrationTarget, options?: DatePathMigrationOptions) => Promise<DatePathMigrationResult>;
  previewDatePathSettings?: (target: DatePathMigrationTarget, options?: DatePathMigrationOptions) => Promise<DatePathMigrationResult>;
  confirmDatePathMigration?: (request: DatePathConfirmationRequest) => Promise<boolean>;
  desktopWebAuthAvailable?: boolean;
  startDesktopWebAuth?: () => Promise<string>;
  clearDesktopWebAuth?: () => Promise<void>;
}

export function SettingsComponent({
  settings,
  updateSetting,
  startSync,
  isSyncing,
  openNotePicker,
  startSubscribedKnowledgeSync,
  openLocalUpload,
  startAutoSync,
  stopAutoSync,
  cancelSync,
  app,
  syncProgress,
  lastSyncTime,
  syncHistory = [],
  initialKnowledgeBaseCache,
  applyDatePathSettings,
  previewDatePathSettings,
  confirmDatePathMigration,
  desktopWebAuthAvailable = false,
  startDesktopWebAuth,
  clearDesktopWebAuth,
}: SettingsComponentProps) {
  const [bidirectional, setBidirectional] = useState(settings.reverseSync.enabled);
  const [authMode, setAuthMode] = useState<AuthMode>(settings.authMode);
  const initialOpenApiToken = settings.openApiToken || (settings.authMode === 'openapi' ? settings.apiToken : '');
  const initialOpenApiClientId = settings.openApiClientId || settings.clientId;
  const initialWebApiToken = settings.webApiToken || (settings.authMode === 'web' ? settings.apiToken : '');
  const initiallyHasCredentials = settings.authMode === 'web'
    ? Boolean(initialWebApiToken.trim())
    : Boolean(initialOpenApiToken.trim() && initialOpenApiClientId.trim());
  const [apiTokenOpenapi, setApiTokenOpenapi] = useState(initialOpenApiToken);
  const [clientIdOpenapi, setClientIdOpenapi] = useState(initialOpenApiClientId);
  const [apiTokenWeb, setApiTokenWeb] = useState(initialWebApiToken);
  const apiTokenOpenapiRef = useRef(initialOpenApiToken);
  const apiTokenWebRef = useRef(initialWebApiToken);
  const [showApiToken, setShowApiToken] = useState(false);
  const [folderName, setFolderName] = useState(settings.folderName);
  const [filenamePrefix, setFilenamePrefix] = useState(settings.filenamePrefix);
  const [appliedDatePathEnabled, setAppliedDatePathEnabled] = useState(settings.datePathEnabled);
  const [appliedDatePathFormat, setAppliedDatePathFormat] = useState(settings.datePathFormat || 'YYYY/MM');
  const [datePathEnabled, setDatePathEnabled] = useState(settings.datePathEnabled);
  const [datePathFormat, setDatePathFormat] = useState(settings.datePathFormat || 'YYYY/MM');
  const [datePathMigrationBusy, setDatePathMigrationBusy] = useState(false);
  const [datePathMigrationResult, setDatePathMigrationResult] = useState<DatePathMigrationResult | null>(null);
  const [datePathMigrationFailed, setDatePathMigrationFailed] = useState(false);
  const [templateFilePath, setTemplateFilePath] = useState(settings.templateFilePath);
  // Only show actual lastSyncEndTimestamp — do NOT fallback to syncStartDate
  const lastSyncedTo = settings.lastSyncEndTimestamp || '';
  const [scheduledEnabled, setScheduledEnabled] = useState(settings.scheduledSync.enabled);
  const [scheduledDetailsOpen, setScheduledDetailsOpen] = useState(false);
  const [scheduledNoteTypes, setScheduledNoteTypes] = useState<string[] | undefined>(settings.scheduledSync.enabledNoteTypes);
  const [syncTags, setSyncTags] = useState<string[]>(settings.syncTags ?? []);
  const [scheduledKnowledgeBases, setScheduledKnowledgeBases] = useState<string[]>(settings.scheduledSync.syncKnowledgeBases ?? []);
  const [credentialsDetailsOpen, setCredentialsDetailsOpen] = useState(!initiallyHasCredentials);
  const [syncDetailsOpen, setSyncDetailsOpen] = useState(true);
  const [advancedDetailsOpen, setAdvancedDetailsOpen] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [desktopWebAuthBusy, setDesktopWebAuthBusy] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionHealthOverride, setConnectionHealthOverride] = useState<ConnectionHealth | null>(null);
  const [connectionErrorMsg, setConnectionErrorMsg] = useState('');
  const [connectionExpiryMin, setConnectionExpiryMin] = useState<number | null>(null);
  const intervalWarningTimeoutRef = useRef<number | null>(null);
  const connectionStatusTimeoutRef = useRef<number | null>(null);
  const [intervalWarning, setIntervalWarning] = useState(false);
  const credentials = getAuthCredentials({ ...settings, authMode, openApiToken: apiTokenOpenapi, openApiClientId: clientIdOpenapi, webApiToken: apiTokenWeb });
  const currentSyncHistory = syncHistory.length > 0 ? syncHistory : settings.syncHistory;
  const connectionHealth = connectionHealthOverride ?? inferConnectionHealth(currentSyncHistory);
  const latestSync = currentSyncHistory[currentSyncHistory.length - 1];
  const syncStatusLabel = isSyncing
    ? t('syncHistory.status.syncing')
    : latestSync?.status === 'failed'
      ? t('settings.syncStatus.lastFailed')
      : t('syncHistory.status.idle');
  const onboardingState = computeOnboardingState({
    ...settings,
    authMode,
    openApiToken: apiTokenOpenapi,
    openApiClientId: clientIdOpenapi,
    webApiToken: apiTokenWeb,
    scheduledSync: { ...settings.scheduledSync, enabled: scheduledEnabled },
    syncHistory: currentSyncHistory,
  });
  const onboardingMessageKey = onboardingState === 'first-run'
    ? 'settings.onboarding.firstRun'
    : onboardingState === 'needs-credentials'
      ? 'settings.onboarding.needsCredentials'
      : onboardingState === 'needs-auto-sync'
        ? 'settings.onboarding.needsAutoSync'
        : 'settings.onboarding.ready';
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [pendingStartDate, setPendingStartDate] = useState(settings.syncStartDate);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  const resetConnectionVerification = useCallback(() => {
    setConnectionHealthOverride('unverified');
    setConnectionStatus('idle');
    setConnectionErrorMsg('');
    setConnectionExpiryMin(null);
    if (connectionStatusTimeoutRef.current !== null) {
      window.clearTimeout(connectionStatusTimeoutRef.current);
      connectionStatusTimeoutRef.current = null;
    }
  }, []);

  const attachmentKinds = ['image', 'audio', 'audioTranscript', 'video', 'document'] as const;
  // updateSetting persists by mutating plugin.settings, but does not rerender
  // this component. Keep an immediate UI copy so the master toggle can update
  // every child without waiting for the settings page to be reopened.
  const [attachmentImport, setAttachmentImport] = useState<AttachmentImportSettings>(() => ({
    image: settings.attachmentImport?.image !== false,
    audio: settings.attachmentImport?.audio !== false,
    audioTranscript: settings.attachmentImport?.audioTranscript !== false,
    video: settings.attachmentImport?.video !== false,
    document: settings.attachmentImport?.document !== false,
  }));
  const allAttachmentsOn = attachmentKinds.every(
    k => attachmentImport[k] !== false,
  );
  const anyAttachmentsOn = attachmentKinds.some(
    k => attachmentImport[k] !== false,
  );
  const handleMasterAttachmentChange = (value: boolean) => {
    const nextAttachmentImport: AttachmentImportSettings = {
      image: value,
      audio: value,
      audioTranscript: value,
      video: value,
      document: value,
    };
    setAttachmentImport(nextAttachmentImport);
    updateSetting('attachmentImport', nextAttachmentImport);
  };
  const handleChildAttachmentChange = (kind: typeof attachmentKinds[number], value: boolean) => {
    if (!anyAttachmentsOn) return;
    const nextAttachmentImport: AttachmentImportSettings = {
      ...attachmentImport,
      [kind]: value,
    };
    setAttachmentImport(nextAttachmentImport);
    updateSetting('attachmentImport', nextAttachmentImport);
  };

  useEffect(() => {
    if (!settings.syncStartDate && !settings.lastSyncEndTimestamp) {
      updateSetting('syncStartDate', getLocalDateInputValue());
    }
  }, []);

  // Lazily seed the tag cache from the first page of notes the first time
  // the settings tab is opened with an empty cache. This avoids an empty
  // "Tags" dropdown before the user has run a sync. We only run once per
  // session (guarded by lastUpdated === 0); later runs come from the sync
  // engine populating observedTags.
  useEffect(() => {
    const cache = settings.tagCache;
    if (!cache || (cache.tags && cache.tags.length > 0)) return;
    if (cache?.lastUpdated && cache.lastUpdated > 0) return;
    if (!credentials.token) return;
    if (credentials.authMode !== 'web' && !credentials.clientId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchNotes({
          token: credentials.token,
          clientId: credentials.clientId,
          authMode: credentials.authMode,
          sinceId: '0',
        });
        if (cancelled) return;
        const observed = result.notes.flatMap(n => (n.tags ?? []).map(t => t.name)).filter(Boolean);
        if (observed.length === 0) return;
        updateSetting('tagCache', {
          tags: Array.from(new Set(observed)).sort((a, b) => a.localeCompare(b)),
          lastUpdated: Date.now(),
        });
      } catch {
        // Network failure is non-fatal — user can still sync to populate.
      }
    })();
    return () => { cancelled = true; };
  }, [credentials.token, credentials.clientId, credentials.authMode]);

  useEffect(() => {
    const inputEl = folderInputRef.current;
    if (!inputEl) return;

    const suggest = new PathSuggest(app, inputEl, (query) => getFolderSuggestions(app, query), (value) => {
      setFolderName(value);
      updateSetting('folderName', value);
    });

    return () => suggest.close();
  }, [app]);

  useEffect(() => {
    const inputEl = templateFileInputRef.current;
    if (!inputEl) return;

    const suggest = new PathSuggest(app, inputEl, (query) => getTemplateFileSuggestions(app, query), (value) => {
      setTemplateFilePath(value);
      updateSetting('templateFilePath', value);
    });

    return () => suggest.close();
  }, [app]);

  const handleAuthModeChange = useCallback(
    (value: AuthMode) => {
      setAuthMode(value);
      updateSetting('authMode', value);
      updateSetting('apiToken', (value === 'web' ? apiTokenWebRef.current : apiTokenOpenapiRef.current).trim());
      if (value === 'openapi') updateSetting('clientId', clientIdOpenapi.trim());
      resetConnectionVerification();
    },
    [clientIdOpenapi, resetConnectionVerification, updateSetting]
  );

  const handleApiTokenOpenapiChange = useCallback(
    (value: string) => {
      apiTokenOpenapiRef.current = value;
      setApiTokenOpenapi(value);
      updateSetting('openApiToken', value.trim());
      if (authMode === 'openapi') updateSetting('apiToken', value.trim());
      resetConnectionVerification();
    },
    [authMode, resetConnectionVerification, updateSetting]
  );

  const handleClientIdOpenapiChange = useCallback(
    (value: string) => {
      setClientIdOpenapi(value);
      updateSetting('openApiClientId', value.trim());
      updateSetting('clientId', value.trim());
      resetConnectionVerification();
    },
    [resetConnectionVerification, updateSetting]
  );

  const handleApiTokenWebChange = useCallback(
    (value: string) => {
      apiTokenWebRef.current = value;
      setApiTokenWeb(value);
      updateSetting('webApiToken', value.trim());
      if (authMode === 'web') updateSetting('apiToken', value.trim());
      resetConnectionVerification();
    },
    [authMode, resetConnectionVerification, updateSetting]
  );

  const handleFolderChange = useCallback(
    (value: string) => {
      const clean = value.replace(/[\\:*?"<>|]/g, '').trim() || t('settings.folder.placeholder');
      setFolderName(clean);
      updateSetting('folderName', clean);
    },
    [updateSetting]
  );

  const handleFilenamePrefixChange = useCallback(
    (value: string) => {
      setFilenamePrefix(value);
      updateSetting('filenamePrefix', value);
    },
    [updateSetting]
  );

  const normalizedDatePathFormat = datePathFormat.trim();
  const datePathDirty =
    datePathEnabled !== appliedDatePathEnabled
    || normalizedDatePathFormat !== appliedDatePathFormat;
  const datePathFormatValid = validateDatePathFormat(normalizedDatePathFormat);

  const runDatePathMigration = async (mode: 'apply' | 'reconcile') => {
    if (isSyncing || datePathMigrationBusy || !datePathFormatValid) return;
    const target = {
      enabled: datePathEnabled,
      format: normalizedDatePathFormat,
    };
    const options = mode === 'reconcile' ? { rebuildCategories: true } : undefined;
    setDatePathMigrationBusy(true);
    setDatePathMigrationFailed(false);
    try {
      const preview = await previewDatePathSettings?.(target, options);
      const confirmed = await confirmDatePathMigration?.({
        mode,
        current: {
          enabled: appliedDatePathEnabled,
          format: appliedDatePathFormat,
        },
        target,
        preview,
      });
      if (!confirmed || !applyDatePathSettings) return;
      const result = await applyDatePathSettings(target, options);
      setAppliedDatePathEnabled(target.enabled);
      setAppliedDatePathFormat(target.format);
      setDatePathFormat(target.format);
      setDatePathMigrationResult(result);
    } catch (error) {
      console.error('[DedaoBrain] Date-path migration failed', error);
      setDatePathMigrationFailed(true);
    } finally {
      setDatePathMigrationBusy(false);
    }
  };

  const datePathIssueLabel = (code: DatePathMigrationIssueCode): string => {
    switch (code) {
      case 'invalid-metadata': return t('settings.datePath.issue.invalidMetadata');
      case 'unsafe-path': return t('settings.datePath.issue.unsafePath');
      case 'missing-generated-asset': return t('settings.datePath.issue.missingAsset');
      case 'shared-asset': return t('settings.datePath.issue.sharedAsset');
      case 'duplicate-uid': return t('settings.datePath.issue.duplicateUid');
      case 'target-conflict': return t('settings.datePath.issue.targetConflict');
      case 'inbound-link': return t('settings.datePath.issue.inboundLink');
      case 'rename-failed': return t('settings.datePath.issue.renameFailed');
      case 'rollback-failed': return t('settings.datePath.issue.rollbackFailed');
      default: return t('settings.datePath.issue.unknown');
    }
  };

  const datePathIssueSummary = (issues: DatePathMigrationResult['issues']): string => {
    const counts = new Map<DatePathMigrationIssueCode, number>();
    for (const migrationIssue of issues) {
      counts.set(migrationIssue.code, (counts.get(migrationIssue.code) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([code, count]) => `${datePathIssueLabel(code)} ${count}`)
      .join(' · ');
  };

  const handleTemplateFilePathChange = useCallback(
    (value: string) => {
      setTemplateFilePath(value);
      updateSetting('templateFilePath', value.trim());
    },
    [updateSetting]
  );

  const handleRibbonActionChange = (action: 'sync' | 'search', enabled: boolean) => {
    updateSetting('ribbonActions', {
      ...settings.ribbonActions,
      [action]: enabled,
    });
  };

  const handleSyncStartDateChange = (value: string) => {
    updateSetting('syncStartDate', value);
  };

  const handleResetCheckpointClick = () => {
    if (isSyncing) return;
    setPendingStartDate(getLocalDateInputValue());
    setResetDialogOpen(true);
  };

  const handleResetSave = () => {
    if (isSyncing) return;
    // Reject empty input — silently writing '' would cause the sync engine to
    // fall back to maxDays (default 30), surprising users who simply cleared
    // the field by accident. Keep the previous syncStartDate unchanged.
    if (pendingStartDate === '') {
      setResetDialogOpen(false);
      return;
    }
    updateSetting('lastSyncEndTimestamp', '');
    if (pendingStartDate !== settings.syncStartDate) {
      updateSetting('syncStartDate', pendingStartDate);
    }
    setResetDialogOpen(false);
  };

  const handleResetCancel = () => {
    setPendingStartDate(settings.syncStartDate);
    setResetDialogOpen(false);
  };

  const handleScheduledEnabled = (checked: boolean) => {
    updateSetting('scheduledSync', {
      ...settings.scheduledSync,
      enabledNoteTypes: scheduledNoteTypes,
      syncKnowledgeBases: scheduledKnowledgeBases,
      enabled: checked,
    });
    setScheduledEnabled(checked);
    if (!checked) setScheduledDetailsOpen(false);
    if (checked) {
      startAutoSync();
    } else {
      stopAutoSync();
    }
  };

  const handleScheduledInterval = (value: string) => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 5) {
      setIntervalWarning(true);
      if (intervalWarningTimeoutRef.current !== null) {
        window.clearTimeout(intervalWarningTimeoutRef.current);
      }
      updateSetting('scheduledSync', {
        ...settings.scheduledSync,
        enabledNoteTypes: scheduledNoteTypes,
        syncKnowledgeBases: scheduledKnowledgeBases,
        intervalMinutes: 5,
      });
      intervalWarningTimeoutRef.current = window.setTimeout(() => {
        setIntervalWarning(false);
        intervalWarningTimeoutRef.current = null;
      }, 3000);
    } else {
      updateSetting('scheduledSync', {
        ...settings.scheduledSync,
        enabledNoteTypes: scheduledNoteTypes,
        syncKnowledgeBases: scheduledKnowledgeBases,
        intervalMinutes: n,
      });
    }
  };

  const handleScheduledOnStart = (checked: boolean) => {
    updateSetting('scheduledSync', {
      ...settings.scheduledSync,
      enabledNoteTypes: scheduledNoteTypes,
      syncKnowledgeBases: scheduledKnowledgeBases,
      syncOnStart: checked,
    });
  };

  const handleScheduledNoteTypes = (value: string[] | undefined) => {
    setScheduledNoteTypes(value);
    updateSetting('scheduledSync', { ...settings.scheduledSync, enabledNoteTypes: value, syncKnowledgeBases: scheduledKnowledgeBases });
  };

  const handleScheduledKnowledgeBases = (value: string[]) => {
    setScheduledKnowledgeBases(value);
    updateSetting('scheduledSync', {
      ...settings.scheduledSync,
      enabledNoteTypes: scheduledNoteTypes,
      syncKnowledgeBases: value,
    });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionErrorMsg('');
    setConnectionExpiryMin(null);
    if (connectionStatusTimeoutRef.current !== null) {
      window.clearTimeout(connectionStatusTimeoutRef.current);
      connectionStatusTimeoutRef.current = null;
    }
    const token = authMode === 'web' ? apiTokenWeb.trim() : apiTokenOpenapi.trim();
    const cid = authMode === 'web' ? '' : clientIdOpenapi.trim();
    try {
      await fetchNotes({
        token,
        clientId: cid,
        authMode,
        sinceId: '0',
        limit: 1,
      });
      if (authMode === 'web') {
        try {
          const tokenStr = token.replace(/^Bearer\s+/i, '');
          const payload: unknown = JSON.parse(atob(tokenStr.split('.')[1]));
          if (payload && typeof payload === 'object' && 'exp' in payload) {
            const exp = payload.exp;
            if (typeof exp === 'number') {
              const remaining = Math.round((exp - Date.now() / 1000) / 60);
              if (remaining > 0) setConnectionExpiryMin(remaining);
            }
          }
        } catch { /* ignore */ }
      }
      setConnectionStatus('success');
      setConnectionHealthOverride('healthy');
      setCredentialsDetailsOpen(false);
      connectionStatusTimeoutRef.current = window.setTimeout(() => {
        setConnectionStatus('idle');
        setConnectionExpiryMin(null);
        connectionStatusTimeoutRef.current = null;
      }, 4000);
    } catch (err) {
      setConnectionStatus('error');
      setConnectionHealthOverride('error');
      setCredentialsDetailsOpen(true);
      setConnectionErrorMsg(err instanceof Error ? err.message : String(err));
      connectionStatusTimeoutRef.current = window.setTimeout(() => {
        setConnectionStatus('idle');
        setConnectionErrorMsg('');
        connectionStatusTimeoutRef.current = null;
      }, 4000);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleDesktopWebAuth = async () => {
    if (!startDesktopWebAuth) return;
    setDesktopWebAuthBusy(true);
    setConnectionStatus('idle');
    setConnectionErrorMsg('');
    try {
      const token = await startDesktopWebAuth();
      handleApiTokenWebChange(token);
      setConnectionStatus('success');
      setConnectionHealthOverride('healthy');
      setCredentialsDetailsOpen(false);
    } catch (error) {
      setConnectionStatus('error');
      setConnectionHealthOverride('error');
      setCredentialsDetailsOpen(true);
      setConnectionErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setDesktopWebAuthBusy(false);
    }
  };

  const handleDesktopWebLogout = async () => {
    handleApiTokenWebChange('');
    setConnectionStatus('idle');
    setConnectionErrorMsg('');
    if (!clearDesktopWebAuth) return;
    setDesktopWebAuthBusy(true);
    try {
      await clearDesktopWebAuth();
    } catch (error) {
      setConnectionStatus('error');
      setConnectionErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setDesktopWebAuthBusy(false);
    }
  };

  useEffect(() => () => {
    if (intervalWarningTimeoutRef.current !== null) {
      window.clearTimeout(intervalWarningTimeoutRef.current);
      intervalWarningTimeoutRef.current = null;
    }
    if (connectionStatusTimeoutRef.current !== null) {
      window.clearTimeout(connectionStatusTimeoutRef.current);
      connectionStatusTimeoutRef.current = null;
    }
  }, []);

  const currentApiToken = authMode === 'web' ? apiTokenWeb : apiTokenOpenapi;
  const currentClientId = clientIdOpenapi;

  const hasCredentials = authMode === 'web'
    ? Boolean(apiTokenWeb.trim())
    : Boolean(apiTokenOpenapi.trim() && clientIdOpenapi.trim());

  const { scheduledSync } = settings;
  const credentialDetailsId = 'getnote-credential-details';
  const scheduledDetailsId = 'getnote-scheduled-details';
  const syncDetailsId = 'getnote-sync-settings';
  const advancedDetailsId = 'getnote-advanced-settings';

  const noteTypesSummary = !scheduledNoteTypes || scheduledNoteTypes.length === 0
    ? t('noteTypes.all')
    : t('noteTypes.selected', { count: scheduledNoteTypes.length });
  const scheduledSummary = scheduledEnabled
    ? t('settings.scheduled.summary', {
      minutes: scheduledSync.intervalMinutes,
      startup: scheduledSync.syncOnStart ? t('settings.summary.onStart') : t('settings.summary.noOnStart'),
      mode: bidirectional ? t('settings.scheduled.downloadAndUpload') : t('settings.downloadOnly'),
      noteTypes: noteTypesSummary,
    })
    : t('settings.summary.disabled');
  const enabledAttachmentKinds = attachmentKinds.filter(kind => attachmentImport[kind] !== false);
  const attachmentSummary = enabledAttachmentKinds.length === attachmentKinds.length
    ? t('settings.attachment.summary.all')
    : enabledAttachmentKinds.length === 0
      ? t('settings.attachment.summary.none')
      : enabledAttachmentKinds.map(kind => t(`settings.attachment.${kind}`)).join(t('settings.summary.separator'));

  // Format last sync time
  const formatLastSync = (timestamp?: number): string => {
    if (!timestamp) return t('settings.lastSync.never');
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  };

  // Format an ISO datetime to a local-time string that includes a timezone
  // marker. The API returns UTC values (e.g. "...Z") and the previous
  // implementation silently dropped the offset, so a user in UTC+8 saw the
  // checkpoint displayed 8 hours ahead of its true local meaning. Parsing
  // via `new Date()` and rendering with `toLocaleString()` (with
  // timeZoneName='short') converts the timestamp to the viewer's local time
  // and embeds the timezone (e.g. "6/12/2026, 11:30:00 PM GMT+8").
  const formatCheckpoint = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, { timeZoneName: 'short' });
  };

  const progressPhase = syncProgress?.phase ?? 'active';
  const progressIsDeterminate = typeof syncProgress?.percent === 'number';
  const showSyncProgress = isSyncing || progressPhase !== 'active';

  return (
    <div className="getnote-settings-react">
      <div className="getnote-settings-header">
        <h2>{t('settings.title')} <span className="getnote-settings-author">by 关山的月儿</span></h2>
        <p className="getnote-settings-desc">
          {t('settings.desc')} <ExternalLink href={t('settings.communityUrl')}>{t('settings.community')}</ExternalLink>
        </p>
      </div>

      <div className={`getnote-settings-status-bar${credentialsDetailsOpen ? ' is-credentials-open' : ''}`} data-settings-status>
        <div className="getnote-settings-status-copy">
          <strong>{t(`settings.authMode.${authMode}`)}</strong>
          {hasCredentials ? (
            <span
              className={`getnote-connection-health getnote-connection-health--${connectionHealth}`}
              data-connection-health={connectionHealth}
              role="status"
            >
              <span className="getnote-connection-health-dot" aria-hidden="true" />
              {t(`settings.connectionHealth.${connectionHealth}`)}
            </span>
          ) : (
            <span>{t('settings.credentials.notConfigured')}</span>
          )}
          <span>{t('settings.syncStatus')}: {syncStatusLabel}</span>
          <span>{t('settings.lastSync')}: {formatLastSync(lastSyncTime)}</span>
        </div>
        <div className="getnote-settings-status-actions">
          <button
            type="button"
            className="mod-secondary"
            disabled={testingConnection || !hasCredentials}
            onClick={() => void handleTestConnection()}
          >
            {testingConnection ? t('settings.testingConnection') : t('settings.testConnection')}
          </button>
          <button
            type="button"
            className="mod-secondary"
            data-change-credentials
            aria-expanded={credentialsDetailsOpen}
            aria-controls={credentialDetailsId}
            onClick={() => setCredentialsDetailsOpen(prev => !prev)}
          >
            {credentialsDetailsOpen ? t('settings.credentials.collapse') : t('settings.credentials.change')}
          </button>
        </div>
        {connectionStatus === 'success' && (
          <span className="getnote-connection-success" role="status">
            {connectionExpiryMin !== null
              ? t('settings.connectionSuccessWithExpiry', { minutes: connectionExpiryMin })
              : t('settings.connectionSuccess')}
          </span>
        )}
        {connectionStatus === 'error' && (
          <span className="getnote-connection-error" role="alert">
            {t('settings.connectionError')}{connectionErrorMsg ? `: ${connectionErrorMsg}` : ''}
          </span>
        )}
      </div>

      {/* 同步进度紧跟状态，避免进行中的任务藏在页面底部。 */}
      {showSyncProgress && (
        <div
          className={`getnote-settings-sync-status getnote-settings-sync-status-${progressPhase}`}
          data-sync-progress
          data-sync-progress-phase={progressPhase}
          role="status"
          aria-live="polite"
        >
          <div className="getnote-settings-sync-status-header">
            <span className="getnote-mono-text">{syncProgress?.message || t('sync.syncing')}</span>
            {isSyncing && (
              <button className="mod-warning getnote-settings-cancel-button" onClick={cancelSync}>
                {t('modal.cancel')}
              </button>
            )}
          </div>
          <div className="getnote-settings-progress-line">
            <div
              className={`getnote-settings-progress-track${progressIsDeterminate ? '' : ' is-indeterminate'}`}
              data-sync-progress-track
              aria-label={progressIsDeterminate ? `${syncProgress?.percent}%` : syncProgress?.message || t('sync.syncing')}
            >
              <div
                className="getnote-settings-progress-fill"
                style={progressIsDeterminate ? { width: `${syncProgress?.percent}%` } : undefined}
              />
            </div>
            {progressIsDeterminate && (
              <span className="getnote-settings-progress-percent">{syncProgress?.percent}%</span>
            )}
          </div>
          {syncProgress?.count && (
            <div className="getnote-settings-progress-count">{syncProgress.count}</div>
          )}
        </div>
      )}

      {onboardingState !== 'configured' && (
        <div
          className={`getnote-onboarding getnote-onboarding--${onboardingState}`}
          data-credential-guidance
        >
          {t(onboardingMessageKey, { minutes: settings.scheduledSync.intervalMinutes })}
        </div>
      )}

      <div
        id={credentialDetailsId}
        data-credential-details
        className={`getnote-credential-panel${credentialsDetailsOpen ? '' : ' getnote-hidden'}`}
      >
      {/* 凭证设置 */}
      <SettingItem
        name={t('settings.credentials.label')}
        description={
          authMode === 'web'
            ? <span>{t('settings.credentials.webTip')} <ExternalLink href={t('settings.webTipHelpUrl')}>{t('settings.webTipHelp')}</ExternalLink></span>
            : t('settings.credentials.tip')
        }
      >
        <div className="getnote-credentials-control">
          <div className="getnote-primary-input-stack">
            <div className="getnote-authmode-toggle">
              <label className={`getnote-authmode-btn${authMode === 'openapi' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="authMode"
                  value="openapi"
                  checked={authMode === 'openapi'}
                  onChange={() => handleAuthModeChange('openapi')}
                />
                {t('settings.authMode.openapi')}
              </label>
              <label className={`getnote-authmode-btn${authMode === 'web' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="authMode"
                  value="web"
                  checked={authMode === 'web'}
                  onChange={() => handleAuthModeChange('web')}
                />
                {t('settings.authMode.web')}
              </label>
            </div>
            {authMode === 'openapi' && (
              <>
                <input
                  type="text"
                  className="getnote-input"
                  placeholder={t('settings.clientId.placeholder')}
                  value={currentClientId}
                  onInput={(e) => handleClientIdOpenapiChange((e.target as HTMLInputElement).value)}
                />
                <div className="getnote-input-row">
                  <input
                    type={showApiToken ? 'text' : 'password'}
                    className="getnote-input"
                    placeholder={t('settings.apiToken.placeholder')}
                    value={currentApiToken}
                    onInput={(e) => handleApiTokenOpenapiChange((e.target as HTMLInputElement).value)}
                  />
                  <button
                    type="button"
                    className="getnote-input-toggle"
                    onClick={() => setShowApiToken(!showApiToken)}
                    title={showApiToken ? t('settings.hideToken') : t('settings.showToken')}
                    aria-label={showApiToken ? t('settings.hideToken') : t('settings.showToken')}
                  >
                    {showApiToken ? '🔒' : '👁'}
                  </button>
                </div>
              </>
            )}
            {authMode === 'web' && (
              <>
                <div className="getnote-input-row">
                  <input
                    type={showApiToken ? 'text' : 'password'}
                    className="getnote-input"
                    placeholder={t('settings.webToken.placeholder')}
                    value={currentApiToken}
                    onInput={(e) => handleApiTokenWebChange((e.target as HTMLInputElement).value)}
                  />
                  <button
                    type="button"
                    className="getnote-input-toggle"
                    onClick={() => setShowApiToken(!showApiToken)}
                    title={showApiToken ? t('settings.hideToken') : t('settings.showToken')}
                    aria-label={showApiToken ? t('settings.hideToken') : t('settings.showToken')}
                  >
                    {showApiToken ? '🔒' : '👁'}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="getnote-credentials-actions">
            {authMode !== 'web' && (
              <OAuthButton
                onAuthorize={(token, cid) => {
                  resetConnectionVerification();
                  setApiTokenOpenapi(token);
                  setClientIdOpenapi(cid);
                  apiTokenOpenapiRef.current = token;
                  updateSetting('openApiToken', token);
                  updateSetting('openApiClientId', cid);
                  updateSetting('apiToken', token);
                  updateSetting('clientId', cid);
                }}
                onTestConnection={async (token, cid) => {
                  try {
                    await fetchNotes({ token, clientId: cid, authMode: 'openapi', sinceId: '0', limit: 1 });
                    setConnectionHealthOverride('healthy');
                    setCredentialsDetailsOpen(false);
                    return { isMemberError: false, message: '' };
                  } catch (err) {
                    setConnectionHealthOverride('error');
                    setCredentialsDetailsOpen(true);
                    const msg = err instanceof Error ? err.message : String(err);
                    const isMemberError = msg.includes('10201') || msg.includes('仅对会员开放') || msg.includes('not_member');
                    return { isMemberError, message: isMemberError ? t('settings.connectionErrorMemberHint') : msg };
                  }
                }}
              />
            )}
            {authMode === 'web' && desktopWebAuthAvailable && (
              <>
                <button
                  type="button"
                  className="mod-cta getnote-credential-action-button"
                  disabled={desktopWebAuthBusy}
                  onClick={() => { void handleDesktopWebAuth(); }}
                >
                  {desktopWebAuthBusy ? t('settings.webAuth.waiting') : t('settings.webAuth.login')}
                </button>
                <button
                  type="button"
                  className="mod-secondary getnote-credential-action-button"
                  disabled={desktopWebAuthBusy}
                  onClick={() => { void handleDesktopWebLogout(); }}
                >
                  {t('settings.webAuth.logout')}
                </button>
              </>
            )}
          </div>
        </div>
      </SettingItem>
      </div>

      {/* 文件名前缀 */}
      {(() => {
        const advancedSettings = (
      <section className="getnote-settings-section getnote-settings-advanced" data-settings-section="advanced">
        <button
          type="button"
          className="getnote-section-disclosure"
          data-advanced-disclosure
          aria-expanded={advancedDetailsOpen}
          aria-controls={advancedDetailsId}
          onClick={() => setAdvancedDetailsOpen(prev => !prev)}
        >
          <span className="getnote-section-disclosure-copy">
            <strong>{t('settings.advanced.section')}</strong>
            <small>{t('settings.advanced.summary')}</small>
          </span>
          <span
            className={`getnote-disclosure-caret${advancedDetailsOpen ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        </button>
        <div
          id={advancedDetailsId}
          data-advanced-settings
          className={advancedDetailsOpen ? '' : 'getnote-hidden'}
        >
      <SettingItem
        name={t('settings.prefix.label')}
        description={(
          <>
            <div>{t('settings.prefix.desc')}</div>
            <div className="getnote-input-hint">{t('settings.prefix.hint')}</div>
          </>
        )}
      >
        <input
          type="text"
          className="getnote-input"
          placeholder={t('settings.prefix.placeholder')}
          value={filenamePrefix}
          onInput={(e) => handleFilenamePrefixChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <SettingItem
        name={t('settings.datePath.label')}
        description={t('settings.datePath.desc')}
      >
        <div className="getnote-date-path-settings">
          <div className="getnote-date-path-toggle-row">
            <Toggle
              ariaLabel={t('settings.datePath.label')}
              value={datePathEnabled}
              onChange={setDatePathEnabled}
              disabled={isSyncing || datePathMigrationBusy}
            />
          </div>
          {datePathEnabled && (
            <input
              type="text"
              className="getnote-input"
              aria-label={t('settings.datePath.format')}
              value={datePathFormat}
              disabled={isSyncing || datePathMigrationBusy}
              onInput={(event) => setDatePathFormat((event.target as HTMLInputElement).value)}
            />
          )}
          <div className="getnote-input-hint">{t('settings.datePath.hint')}</div>
          {!datePathFormatValid && (
            <div className="getnote-date-path-error" role="alert">
              {t('settings.datePath.invalidFormat')}
            </div>
          )}
          <div className="getnote-date-path-actions">
            <button
              type="button"
              className="mod-cta"
              disabled={!datePathDirty || !datePathFormatValid || isSyncing || datePathMigrationBusy}
              onClick={() => void runDatePathMigration('apply')}
            >
              {t('settings.datePath.apply')}
            </button>
            <button
              type="button"
              className="mod-secondary"
              disabled={datePathDirty || !datePathFormatValid || isSyncing || datePathMigrationBusy}
              onClick={() => void runDatePathMigration('reconcile')}
            >
              {t('settings.datePath.reconcile')}
            </button>
          </div>
          {datePathMigrationResult && (
            <div className="getnote-date-path-result" data-date-path-result>
              <div>
                {t('settings.datePath.result', {
                  scanned: datePathMigrationResult.scanned,
                  moved: datePathMigrationResult.moved,
                  unchanged: datePathMigrationResult.unchanged,
                  skipped: datePathMigrationResult.skipped,
                  failed: datePathMigrationResult.failed,
                })}
              </div>
              {datePathMigrationResult.issues.length > 0 && (
                <div className="getnote-date-path-issue-summary">
                  {datePathIssueSummary(datePathMigrationResult.issues)}
                </div>
              )}
              {datePathMigrationResult.issues.length > 0 && (
                <button
                  type="button"
                  className="mod-secondary getnote-view-history-btn"
                  onClick={() => openSyncHistoryModal(app, currentSyncHistory)}
                >
                  {t('syncHistory.view')}
                </button>
              )}
            </div>
          )}
          {datePathMigrationFailed && (
            <div className="getnote-date-path-error" role="alert">
              {t('settings.datePath.error.generic')}
            </div>
          )}
        </div>
      </SettingItem>

      <SettingItem
        name={t('settings.templateFile.label')}
        description={t('settings.templateFile.desc')}
      >
        <input
          ref={templateFileInputRef}
          type="text"
          className="getnote-input"
          placeholder={t('settings.templateFile.placeholder')}
          value={templateFilePath}
          onInput={(e) => handleTemplateFilePathChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <SettingItem
        name={t('settings.ribbon.section')}
        description={t('settings.ribbon.desc')}
      >
        <div className="getnote-scheduled-options">
          <div className="getnote-scheduled-row">
            <span className="getnote-scheduled-row-label">{t('settings.ribbon.sync')}</span>
            <span className="getnote-scheduled-row-control">
              <Toggle
                ariaLabel={t('settings.ribbon.sync')}
                value={settings.ribbonActions.sync}
                onChange={(value) => handleRibbonActionChange('sync', value)}
              />
            </span>
          </div>
          <div className="getnote-scheduled-row">
            <span className="getnote-scheduled-row-label">{t('settings.ribbon.search')}</span>
            <span className="getnote-scheduled-row-control">
              <Toggle
                ariaLabel={t('settings.ribbon.search')}
                value={settings.ribbonActions.search}
                onChange={(value) => handleRibbonActionChange('search', value)}
              />
            </span>
          </div>
        </div>
      </SettingItem>
        <div data-attachment-settings>
        <SettingItem name={t('settings.attachment.section')}>
          <div className="getnote-scheduled-options">
            <div className="getnote-scheduled-row getnote-attachment-master-row">
              <span className="getnote-scheduled-row-label">
                <span>{t('settings.attachment.master')}</span>
                <small className="getnote-setting-summary">{attachmentSummary}</small>
              </span>
              <span className="getnote-scheduled-row-control">
                <Toggle ariaLabel={t('settings.attachment.master')} value={allAttachmentsOn} onChange={handleMasterAttachmentChange} />
              </span>
            </div>
            <div className="getnote-attachment-options">
              {attachmentKinds.map(kind => (
                <div className="getnote-scheduled-row getnote-attachment-option" key={kind}>
                  <span className="getnote-scheduled-row-label">{t(`settings.attachment.${kind}`)}</span>
                  <span className="getnote-scheduled-row-control">
                    <Toggle
                      ariaLabel={t(`settings.attachment.${kind}`)}
                      value={anyAttachmentsOn ? attachmentImport[kind] !== false : false}
                      disabled={!anyAttachmentsOn}
                      onChange={(value) => handleChildAttachmentChange(kind, value)}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SettingItem>
        </div>
        </div>
      </section>

        );
        const syncSettings = (
      <section className="getnote-settings-section getnote-settings-sync" data-settings-section="sync">
      <button
        type="button"
        className="getnote-section-disclosure"
        data-sync-disclosure
        aria-expanded={syncDetailsOpen}
        aria-controls={syncDetailsId}
        onClick={() => setSyncDetailsOpen(prev => !prev)}
      >
        <span className="getnote-section-disclosure-copy">
          <strong>{t('settings.sync.section')}</strong>
          <small>{t('settings.sync.summary')}</small>
        </span>
        <span
          className={`getnote-disclosure-caret${syncDetailsOpen ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div id={syncDetailsId} data-sync-settings className={syncDetailsOpen ? '' : 'getnote-hidden'}>

      {/* 目标文件夹是同步的基础配置，放在首项以便首次设置。 */}
      <SettingItem
        name={t('settings.folder.label')}
        description={t('settings.folder.desc')}
      >
        <input
          ref={folderInputRef}
          type="text"
          className="getnote-input"
          placeholder={t('settings.folder.placeholder')}
          value={folderName}
          onInput={(e) => handleFolderChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <div data-scheduled-settings>
      <SettingItem name={t('settings.scheduled.label')} description={t('settings.scheduled.desc')}>
        <div className="getnote-scheduled-control">
          <div className="getnote-scheduled-row getnote-scheduled-master-row">
            <span className="getnote-scheduled-row-label">{t('settings.scheduled.enabled')}</span>
            <span className="getnote-scheduled-row-control">
              <Toggle
                ariaLabel={t('settings.scheduled.enabled')}
                value={scheduledEnabled}
                onChange={handleScheduledEnabled}
              />
              <button
                type="button"
                className="getnote-inline-disclosure"
                aria-expanded={scheduledDetailsOpen}
                aria-controls={scheduledDetailsId}
                onClick={() => setScheduledDetailsOpen(prev => !prev)}
              >
                {scheduledDetailsOpen ? t('settings.collapse') : t('settings.expand')}
              </button>
            </span>
          </div>
          <small className="getnote-setting-summary">{scheduledSummary}</small>
          <div
            id={scheduledDetailsId}
            className={`getnote-scheduled-rows${scheduledDetailsOpen ? '' : ' getnote-hidden'}`}
          >
            <div className="getnote-scheduled-row">
              <span className="getnote-scheduled-row-label">{t('settings.scheduled.interval')}</span>
              <span className="getnote-scheduled-row-control">
                <input
                  type="number"
                  min="5"
                  value={scheduledSync.intervalMinutes}
                  onInput={(e) => handleScheduledInterval((e.target as HTMLInputElement).value)}
                />
              </span>
            </div>
            {intervalWarning && (
              <div className="getnote-input-hint getnote-input-hint-error">
                {t('settings.interval.minWarning')}
              </div>
            )}
            <div className="getnote-scheduled-row">
              <span className="getnote-scheduled-row-label">{t('settings.scheduled.onStart')}</span>
              <span className="getnote-scheduled-row-control">
                <Toggle
                  ariaLabel={t('settings.scheduled.onStart')}
                  value={scheduledSync.syncOnStart}
                  onChange={handleScheduledOnStart}
                />
              </span>
            </div>
            <div className="getnote-scheduled-row">
              <span className="getnote-scheduled-row-label">{t('settings.scheduled.autoUploadLocalChanges')}</span>
              <span className="getnote-scheduled-row-control">
                <Toggle
                  ariaLabel={t('settings.scheduled.autoUploadLocalChanges')}
                  value={bidirectional}
                  disabled={isSyncing || authMode !== 'openapi'}
                  onChange={enabled => {
                    setBidirectional(enabled);
                    updateSetting('reverseSync', { ...settings.reverseSync, enabled, autoUpload: undefined });
                  }}
                />
              </span>
            </div>
            {bidirectional && (
              <div className="getnote-input-hint getnote-bidirectional-hint">
                {t('settings.scheduled.autoUploadLocalChanges.hint')}
              </div>
            )}
            <div className="getnote-scheduled-row">
              <span className="getnote-scheduled-row-label">{t('settings.noteTypes.label')}</span>
              <span className="getnote-scheduled-row-control">
                <NoteTypeSelect value={scheduledNoteTypes} onChange={handleScheduledNoteTypes} />
              </span>
            </div>
            <div className="getnote-scheduled-row">
              <span className="getnote-scheduled-row-label">{t('settings.syncTags.label')}</span>
              <span className="getnote-scheduled-row-control">
                <TagSelect
                  value={syncTags}
                  options={settings.tagCache?.tags ?? []}
                  onChange={(value) => {
                    setSyncTags(value);
                    updateSetting('syncTags', value);
                  }}
                  onCreateTag={(tag) => {
                    const existing = settings.tagCache?.tags ?? [];
                    if (existing.some(t => t.toLowerCase() === tag.toLowerCase())) return;
                    const merged = Array.from(new Set([...existing, tag])).sort((a, b) => a.localeCompare(b));
                    updateSetting('tagCache', { tags: merged, lastUpdated: Date.now() });
                  }}
                  placeholder={t('settings.syncTags.placeholder')}
                />
              </span>
            </div>
            <div className="getnote-input-hint">{t('settings.syncTags.desc')}</div>
            <div className="getnote-scheduled-row">
              <span className="getnote-scheduled-row-label">{t('settings.scheduled.syncKnowledgeBases')}</span>
              <span className="getnote-scheduled-row-control">
                <KnowledgeBaseSelect
                  value={scheduledKnowledgeBases}
                  onChange={handleScheduledKnowledgeBases}
                  hasCredentials={hasCredentials}
                  token={credentials.token}
                  clientId={credentials.clientId}
                  authMode={credentials.authMode}
                  initialCache={initialKnowledgeBaseCache ?? settings.knowledgeBaseCache}
                  onCacheUpdate={(snapshot) => updateSetting('knowledgeBaseCache', snapshot)}
                />
              </span>
            </div>
            <div className="getnote-input-hint">{t('settings.scheduled.syncKnowledgeBases.hint')}</div>
          <div className="getnote-scheduled-checkpoint" data-scheduled-checkpoint>
            <div className="getnote-scheduled-row getnote-scheduled-date-row">
              <span className="getnote-scheduled-row-label">
                {resetDialogOpen
                  ? t('settings.scheduled.resetStartDate')
                  : lastSyncedTo
                    ? t('settings.syncStartDate.lastSyncedTo')
                    : t('settings.syncStartDate.label')}
              </span>
              <span className="getnote-scheduled-row-control getnote-checkpoint-control">
                {resetDialogOpen ? (
                  <>
                    <input
                      type="date"
                      className="getnote-input getnote-date-input"
                      value={pendingStartDate}
                      onChange={(e) => setPendingStartDate((e.target as HTMLInputElement).value)}
                    />
                    <button type="button" className="getnote-button getnote-button-secondary" onClick={handleResetCancel}>
                      {t('settings.scheduled.resetCancel')}
                    </button>
                    <button type="button" className="getnote-button getnote-button-primary" onClick={handleResetSave} disabled={isSyncing}>
                      {t('settings.scheduled.resetSave')}
                    </button>
                  </>
                ) : lastSyncedTo ? (
                  <>
                    <span className="getnote-muted-text">{formatCheckpoint(lastSyncedTo)}</span>
                    <button type="button" className="getnote-button getnote-button-secondary" onClick={handleResetCheckpointClick} disabled={isSyncing}>
                      {t('settings.scheduled.resetButton')}
                    </button>
                  </>
                ) : (
                  <input
                    type="date"
                    className="getnote-input getnote-date-input"
                    value={settings.syncStartDate}
                    onChange={(e) => handleSyncStartDateChange((e.target as HTMLInputElement).value)}
                  />
                )}
              </span>
            </div>
            <div className="getnote-input-hint">
              {resetDialogOpen
                ? t('settings.scheduled.resetStartDateDesc')
                : lastSyncedTo
                  ? t('settings.syncStartDate.lastSyncedToDesc')
                  : t('settings.syncStartDate.desc')}
            </div>
          </div>
          </div>
          {settings.lastQuotaState?.exhausted && (
            <div className="getnote-quota-banner">
              <div className="getnote-quota-banner-title">
                {t(settings.lastQuotaState.reason === 'quota_month' ? 'settings.quotaMonthExhausted' : 'settings.quotaExhausted')}
              </div>
              <div className="getnote-quota-banner-detail">
                {t(settings.lastQuotaState.reason === 'quota_month' ? 'settings.quotaMonthRetry' : 'settings.quotaRetry')}
              </div>
            </div>
          )}
        </div>
      </SettingItem>
      </div>

      <SettingItem name={t('settings.manualSync')}>
        <div className="getnote-manual-actions">
          <div className="getnote-manual-action-group">
            <div className="getnote-manual-action-title">{t('settings.manualSync.download')}</div>
            <div className="getnote-actions-row">
              <SyncButton
                hasCredentials={hasCredentials}
                isSyncing={isSyncing}
                onClick={startSync}
              />
              <button
                className="mod-secondary getnote-sync-action-button"
                disabled={!hasCredentials || isSyncing}
                onClick={openNotePicker}
              >
                {t('settings.syncPicker.button')}
              </button>
              <button
                className="mod-secondary getnote-sync-action-button"
                disabled={authMode !== 'openapi' || !hasCredentials || isSyncing}
                title={authMode === 'openapi' ? undefined : t('settings.subscribedKnowledge.openApiRequired')}
                onClick={startSubscribedKnowledgeSync}
              >
                {t('settings.subscribedKnowledge.button')}
              </button>
              {authMode !== 'openapi' && (
                <span className="getnote-action-requirement">{t('settings.subscribedKnowledge.openApiRequired')}</span>
              )}
            </div>
          </div>
          <div className="getnote-manual-action-group">
            <div className="getnote-manual-action-title">{t('settings.manualSync.upload')}</div>
            <div className="getnote-actions-row">
              <button
                className="mod-secondary getnote-sync-action-button"
                disabled={!hasCredentials || isSyncing}
                onClick={openLocalUpload}
              >
                {t('settings.reverseSync.uploadButton')}
              </button>
            </div>
          </div>
        </div>
      </SettingItem>

      {/* 顶部状态条已展示本次状态和上次同步，这里只保留历史入口。 */}
      <SettingItem name={t('syncHistory.title')} description={t('syncHistory.desc')}>
        <div className="getnote-sync-log-section">
          <button
            className="mod-secondary getnote-view-history-btn"
            onClick={() => openSyncHistoryModal(app, currentSyncHistory)}
          >
            {t('syncHistory.view')}
          </button>
        </div>
      </SettingItem>
      </div>
      </section>

        );
        return (
          <>
            {syncSettings}
            {advancedSettings}
          </>
        );
      })()}

    </div>
  );
}
