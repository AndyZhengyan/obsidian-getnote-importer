import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { SettingItem } from './setting-item';
import { SyncButton } from './sync-button';
import { OAuthButton } from './oauth-button';
import { openSyncHistoryModal } from '../ui/sync-history-modal';
import type { Settings, SyncHistoryEntry, SyncProgressDetail } from '../types';
import { App, AbstractInputSuggest } from 'obsidian';
import { fetchNotes } from '../api';
import { t } from '../i18n';

const GITHUB_URL = 'https://github.com/AndyZhengyan/obsidian-getnote-importer#about-the-author';

class FolderSuggest extends AbstractInputSuggest<string> {
  private el: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement, onSelect: (value: string) => void) {
    super(app, inputEl);
    this.el = inputEl;
    this.onSelect((value) => onSelect(value));
  }

  getSuggestions(query: string): string[] {
    return this.app.vault
      .getAllFolders()
      .map(f => f.path)
      .filter(path => !query || path.toLowerCase().includes(query.toLowerCase()));
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

interface SettingsComponentProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  startSync: () => void;
  isSyncing: boolean;
  openNotePicker: () => void;
  startAutoSync: () => void;
  stopAutoSync: () => void;
  cancelSync: () => void;
  app: App;
  syncProgress?: SyncProgressDetail;
  lastSyncTime?: number;
  syncHistory?: SyncHistoryEntry[];
}

export function SettingsComponent({
  settings,
  updateSetting,
  startSync,
  isSyncing,
  openNotePicker,
  startAutoSync,
  stopAutoSync,
  cancelSync,
  app,
  syncProgress,
  lastSyncTime,
  syncHistory = [],
}: SettingsComponentProps) {
  const [apiToken, setApiToken] = useState(settings.apiToken);
  const [clientId, setClientId] = useState(settings.clientId);
  const [showApiToken, setShowApiToken] = useState(false);
  const [folderName, setFolderName] = useState(settings.folderName);
  const [filenamePrefix, setFilenamePrefix] = useState(settings.filenamePrefix);
  // Only show actual lastSyncEndTimestamp — do NOT fallback to syncStartDate
  const lastSyncedTo = settings.lastSyncEndTimestamp || '';
  const [scheduledEnabled, setScheduledEnabled] = useState(settings.scheduledSync.enabled);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionErrorMsg, setConnectionErrorMsg] = useState('');
  const [intervalWarning, setIntervalWarning] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settings.syncStartDate && !settings.lastSyncEndTimestamp) {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      updateSetting('syncStartDate', `${y}-${m}-${day}`);
    }
  }, []);

  useEffect(() => {
    const inputEl = folderInputRef.current;
    if (!inputEl) return;

    const suggest = new FolderSuggest(app, inputEl, (value) => {
      setFolderName(value);
      updateSetting('folderName', value);
    });

    return () => suggest.close();
  }, [app]);

  const handleApiTokenChange = useCallback(
    (value: string) => {
      setApiToken(value);
      updateSetting('apiToken', value.trim());
    },
    [updateSetting]
  );

  const handleClientIdChange = useCallback(
    (value: string) => {
      setClientId(value);
      updateSetting('clientId', value.trim());
    },
    [updateSetting]
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

  const handleSyncStartDateChange = (value: string) => {
    updateSetting('syncStartDate', value);
  };

  const handleScheduledEnabled = (checked: boolean) => {
    setScheduledEnabled(checked);
    updateSetting('scheduledSync', { ...settings.scheduledSync, enabled: checked });
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
      updateSetting('scheduledSync', {
        ...settings.scheduledSync,
        intervalMinutes: 5,
      });
      window.setTimeout(() => setIntervalWarning(false), 3000);
    } else {
      updateSetting('scheduledSync', {
        ...settings.scheduledSync,
        intervalMinutes: n,
      });
    }
  };

  const handleScheduledOnStart = (checked: boolean) => {
    updateSetting('scheduledSync', { ...settings.scheduledSync, syncOnStart: checked });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionErrorMsg('');
    try {
      await fetchNotes({ token: apiToken.trim(), clientId: clientId.trim(), sinceId: '0', limit: 1 });
      setConnectionStatus('success');
      window.setTimeout(() => setConnectionStatus('idle'), 3000);
    } catch (err) {
      setConnectionStatus('error');
      setConnectionErrorMsg(err instanceof Error ? err.message : String(err));
      window.setTimeout(() => {
        setConnectionStatus('idle');
        setConnectionErrorMsg('');
      }, 3000);
    } finally {
      setTestingConnection(false);
    }
  };

  const hasCredentials = Boolean(apiToken.trim() && clientId.trim());
  const { scheduledSync } = settings;
  const currentSyncHistory = syncHistory.length > 0 ? syncHistory : settings.syncHistory;

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

  // Progress bar with # characters
  const renderProgressBar = (percent: number): string => {
    const total = 16;
    const filled = Math.round((percent / 100) * total);
    return '[' + '#'.repeat(filled) + '░'.repeat(total - filled) + ']';
  };

  return (
    <div className="getnote-settings-react">
      <div className="getnote-settings-header">
        <h2>{t('settings.title')} <span className="getnote-settings-author">by 关山的月儿</span></h2>
        <p className="getnote-settings-desc">
          {t('settings.desc')} <a href={GITHUB_URL} target="_blank" rel="noopener">{t('settings.community')}</a>
        </p>
      </div>

      {!hasCredentials && (
        <div className="getnote-onboarding">{t('settings.onboarding')}</div>
      )}

      {/* 凭证设置 */}
      <SettingItem
        name={t('settings.credentials.label')}
        description={t('settings.credentials.tip')}
      >
        <div className="getnote-credentials-control">
          <div className="getnote-primary-input-stack">
            <input
              type="text"
              className="getnote-input"
              placeholder={t('settings.clientId.placeholder')}
              value={clientId}
              onInput={(e) => handleClientIdChange((e.target as HTMLInputElement).value)}
            />
            <div className="getnote-input-row">
              <input
                type={showApiToken ? 'text' : 'password'}
                className="getnote-input"
                placeholder={t('settings.apiToken.placeholder')}
                value={apiToken}
                onInput={(e) => handleApiTokenChange((e.target as HTMLInputElement).value)}
              />
              <button
                type="button"
                className="getnote-input-toggle"
                onClick={() => setShowApiToken(!showApiToken)}
                title={showApiToken ? t('settings.hideToken') : t('settings.showToken')}
              >
                {showApiToken ? '🔒' : '👁'}
              </button>
            </div>
          </div>
          <div className="getnote-credentials-actions">
            <OAuthButton
              onAuthorize={(token, cid) => {
                setApiToken(token);
                setClientId(cid);
                updateSetting('apiToken', token);
                updateSetting('clientId', cid);
              }}
            />
            <button
              className="mod-secondary getnote-credential-action-button"
              disabled={testingConnection}
              onClick={() => {
                void handleTestConnection();
              }}
            >
              {testingConnection ? t('settings.testingConnection') : t('settings.testConnection')}
            </button>
          </div>
          {connectionStatus === 'success' && (
            <span className="getnote-connection-success">{t('settings.connectionSuccess')}</span>
          )}
          {connectionStatus === 'error' && (
            <span className="getnote-connection-error">
              {t('settings.connectionError')}{connectionErrorMsg ? `: ${connectionErrorMsg}` : ''}
            </span>
          )}
        </div>
      </SettingItem>

      {/* 目标文件夹 */}
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

      {/* 文件名前缀 */}
      <SettingItem
        name={t('settings.prefix.label')}
        description={t('settings.prefix.desc')}
      >
        <input
          type="text"
          className="getnote-input"
          placeholder={t('settings.prefix.placeholder')}
          value={filenamePrefix}
          onInput={(e) => handleFilenamePrefixChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <div className="getnote-settings-divider" />

      <SettingItem
        name={t('settings.scheduled.label')}
        description={t('settings.scheduled.desc')}
      >
        <div className="getnote-scheduled-control">
          <div className="getnote-scheduled-row">
            <span>{t('settings.scheduled.enabled')}</span>
            <input
              type="checkbox"
              checked={scheduledEnabled}
              onChange={(e) => handleScheduledEnabled((e.target as HTMLInputElement).checked)}
            />
          </div>
          <div
            className={`getnote-scheduled-rows${scheduledEnabled ? '' : ' getnote-hidden'}`}
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
                <input
                  type="checkbox"
                  checked={scheduledSync.syncOnStart}
                  onChange={(e) => handleScheduledOnStart((e.target as HTMLInputElement).checked)}
                />
              </span>
            </div>
                        <div className="getnote-scheduled-row getnote-scheduled-date-row">
              <span className="getnote-scheduled-row-label">
                {lastSyncedTo ? t('settings.syncStartDate.lastSyncedTo') : t('settings.syncStartDate.label')}
              </span>
              <span className="getnote-scheduled-row-control">
                {lastSyncedTo ? (
                  <span className="getnote-muted-text">{lastSyncedTo}</span>
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
            {lastSyncedTo ? (
              <div className="getnote-input-hint">{t('settings.syncStartDate.lastSyncedToDesc')}</div>
            ) : (
              <div className="getnote-input-hint">{t('settings.syncStartDate.desc')}</div>
            )}
          </div>
        </div>
      </SettingItem>

      <SettingItem name={t('settings.manualSync')}>
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
        </div>
      </SettingItem>

      {/* 同步日志 */}
      <SettingItem name={t('syncHistory.title')}>
        <div className="getnote-sync-log-section">
          <div className="getnote-scheduled-row">
            <span className="getnote-scheduled-row-label">{t('settings.lastSync')}</span>
            <span className="getnote-scheduled-row-control getnote-muted-text">
              {formatLastSync(lastSyncTime)}
            </span>
          </div>
          <div className="getnote-scheduled-row">
            <span className="getnote-scheduled-row-label">{t('settings.syncStatus')}</span>
            <span className={`getnote-scheduled-row-control${isSyncing ? ' getnote-accent-text' : ' getnote-muted-text'}`}>
              {isSyncing ? t('syncHistory.status.syncing') : t('syncHistory.status.idle')}
            </span>
          </div>
          <button
            className="mod-secondary"
            onClick={() => openSyncHistoryModal(app, currentSyncHistory)}
          >
            {t('syncHistory.view')}
          </button>
        </div>
      </SettingItem>

      {/* 同步进度条 */}
      {isSyncing && (
        <div className="getnote-settings-sync-status">
          <div className="getnote-settings-sync-status-header">
            <span className="getnote-mono-text">{syncProgress?.message || t('sync.syncing')}</span>
            <button className="mod-warning getnote-settings-cancel-button" onClick={cancelSync}>
              {t('modal.cancel')}
            </button>
          </div>
          <div className="getnote-settings-progress-line">
            <span className="getnote-accent-text">{renderProgressBar(syncProgress?.percent ?? 0)}</span>
            <span className="getnote-settings-progress-percent">{syncProgress?.percent ?? 0}%</span>
          </div>
          {syncProgress?.count && (
            <div className="getnote-settings-progress-count">{syncProgress.count}</div>
          )}
        </div>
      )}

    </div>
  );
}
