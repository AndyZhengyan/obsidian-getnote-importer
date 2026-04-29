import { useState, useCallback } from 'preact/hooks';
import { SettingItem } from './setting-item';
import { SyncButton } from './sync-button';
import type { Settings } from '../types';

interface SettingsComponentProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  startSync: () => void;
  isSyncing: boolean;
  openNotePicker: () => void;
  startAutoSync: () => void;
  stopAutoSync: () => void;
  vaultFolders: string[];
}

export function SettingsComponent({
  settings,
  updateSetting,
  startSync,
  isSyncing,
  openNotePicker,
  startAutoSync,
  stopAutoSync,
  vaultFolders,
}: SettingsComponentProps) {
  const [apiToken, setApiToken] = useState(settings.apiToken);
  const [clientId, setClientId] = useState(settings.clientId);
  const [folderName, setFolderName] = useState(settings.folderName);
  const [maxDays, setMaxDays] = useState(String(settings.maxDays));
  const [filenamePrefix, setFilenamePrefix] = useState(settings.filenamePrefix);

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
      const clean = value.replace(/[\\/:*?"<>|]/g, '').trim() || 'Get笔记';
      setFolderName(clean);
      updateSetting('folderName', clean);
    },
    [updateSetting]
  );

  const handleMaxDaysChange = useCallback(
    (value: string) => {
      setMaxDays(value);
      const n = parseInt(value, 10);
      updateSetting('maxDays', isNaN(n) || n < 0 ? 0 : n);
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

  const handleScheduledEnabled = (checked: boolean) => {
    updateSetting('scheduledSync', { ...settings.scheduledSync, enabled: checked });
    if (checked) {
      startAutoSync();
    } else {
      stopAutoSync();
    }
  };

  const handleScheduledInterval = (value: string) => {
    const n = parseInt(value, 10);
    updateSetting('scheduledSync', {
      ...settings.scheduledSync,
      intervalMinutes: isNaN(n) || n < 5 ? 5 : n,
    });
  };

  const handleScheduledOnStart = (checked: boolean) => {
    updateSetting('scheduledSync', { ...settings.scheduledSync, syncOnStart: checked });
  };

  const hasCredentials = Boolean(apiToken.trim() && clientId.trim());
  const { scheduledSync } = settings;

  return (
    <div className="getnote-settings-react">
      <div className="getnote-settings-header">
        <h2>Get笔记 Importer</h2>
        <p className="getnote-settings-desc">
          将 Get笔记 App 的笔记同步到 Obsidian vault
        </p>
      </div>

      <SettingItem
        name="API Token"
        description="Get笔记开放平台的 Authorization Token（gk_live_xxx）"
      >
        <input
          type="password"
          className="getnote-input"
          placeholder="gk_live_xxx"
          value={apiToken}
          onInput={(e) => handleApiTokenChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <SettingItem
        name="Client ID"
        description="Get笔记开放平台的 Client ID（cli_xxx）"
      >
        <input
          type="text"
          className="getnote-input"
          placeholder="cli_xxx"
          value={clientId}
          onInput={(e) => handleClientIdChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <SettingItem
        name="目标文件夹"
        description="笔记同步到 vault 内的子目录名（默认：Get笔记）"
      >
        <div className="getnote-folder-input-wrapper">
          <input
            type="text"
            className="getnote-input"
            placeholder="Get笔记"
            value={folderName}
            list="getnote-folder-list"
            onInput={(e) => handleFolderChange((e.target as HTMLInputElement).value)}
          />
          <datalist id="getnote-folder-list">
            {vaultFolders.map(name => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      </SettingItem>

      <SettingItem
        name="最大同步天数"
        description="只同步最近 N 天内更新的笔记（0 = 不限制）"
      >
        <input
          type="number"
          className="getnote-input"
          placeholder="30"
          value={maxDays}
          min="0"
          onInput={(e) => handleMaxDaysChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      <SettingItem
        name="文件名前缀（时间戳）"
        description="格式如 YYYY-MM-DD 或 YYYYMMDD_HHmm，留空则不加前缀"
      >
        <input
          type="text"
          className="getnote-input"
          placeholder="如 YYYY-MM-DD 或 YYYYMMDD_HHmm，留空不加前缀"
          value={filenamePrefix}
          onInput={(e) => handleFilenamePrefixChange((e.target as HTMLInputElement).value)}
        />
      </SettingItem>

      {/* 定时同步设置 */}
      <SettingItem name="定时同步" description="开启后自动定时同步笔记">
        <div className="getnote-scheduled-row">
          <span>启用定时同步</span>
          <input
            type="checkbox"
            checked={scheduledSync.enabled}
            onChange={(e) => handleScheduledEnabled((e.target as HTMLInputElement).checked)}
          />
        </div>
        {scheduledSync.enabled && (
          <>
            <div className="getnote-scheduled-row">
              <span>同步间隔（分钟）</span>
              <input
                type="number"
                min="5"
                value={scheduledSync.intervalMinutes}
                onInput={(e) => handleScheduledInterval((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="getnote-scheduled-row">
              <span>启动时同步</span>
              <input
                type="checkbox"
                checked={scheduledSync.syncOnStart}
                onChange={(e) => handleScheduledOnStart((e.target as HTMLInputElement).checked)}
              />
            </div>
          </>
        )}
      </SettingItem>

      <div className="getnote-settings-divider" />

      <SettingItem name="同步" description="点击后将 Get笔记笔记同步到 vault">
        <SyncButton
          hasCredentials={hasCredentials}
          isSyncing={isSyncing}
          onClick={startSync}
        />
      </SettingItem>

      <SettingItem name="选择性同步" description="先选择笔记，再同步">
        <button className="mod-secondary" onClick={openNotePicker}>
          📋 选择性同步
        </button>
      </SettingItem>
    </div>
  );
}
