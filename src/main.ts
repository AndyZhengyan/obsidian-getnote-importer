import { App, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { GetNoteSettingsTab } from './settings-tab';
import { SyncEngine } from './sync';
import { LoadingModal } from './ui/loading-modal';
import { SyncModal } from './ui/sync-modal';
import { showError, showSuccess } from './ui/notice';

export default class GetNoteSyncPlugin extends Plugin {
  settings!: Settings;
  isSyncing = false;

  private settingsTab?: GetNoteSettingsTab;

  async onload(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...loaded };

    this.settingsTab = new GetNoteSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.addCommand({
      id: 'sync-notes',
      name: '同步笔记',
      callback: () => this.startSync(),
    });

    this.addRibbonIcon('book-lock', '同步 Get笔记', () => this.startSync());

    console.log('[Get笔记 Importer] 插件已加载');
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private refreshSettingsTab(): void {
    if (this.settingsTab) {
      this.settingsTab.display();
    }
  }

  async startSync(): Promise<void> {
    if (this.isSyncing) return;

    if (!this.settings.apiToken || !this.settings.clientId) {
      showError('请先在设置中填写 API Token 和 Client ID');
      return;
    }

    this.isSyncing = true;
    this.refreshSettingsTab();

    const loading = new LoadingModal(this.app);
    loading.open();

    try {
      const engine = new SyncEngine(this.app, this.settings);

      const syncModal = new SyncModal(this.app);
      syncModal.open();
      loading.close();

      const result = await engine.sync(syncModal);
      syncModal.showResult(result);

      showSuccess(
        `同步完成：新增 ${result.created} · 更新 ${result.updated} · 跳过 ${result.skipped}${result.failed > 0 ? ` · 失败 ${result.failed}` : ''}`
      );
    } catch (err) {
      loading.close();
      const msg = err instanceof Error ? err.message : String(err);
      showError(`同步失败：${msg}`);
      console.error('[Get笔记 Importer] 同步错误:', err);
    } finally {
      this.isSyncing = false;
      this.refreshSettingsTab();
    }
  }
}
