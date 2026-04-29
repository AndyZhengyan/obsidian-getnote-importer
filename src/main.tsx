import { App, Modal, Plugin } from 'obsidian';
// @ts-expect-error - ReactDOM available via Preact compat layer
import ReactDOM from 'react-dom';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { GetNoteSettingsTab } from './settings-tab';
import { SyncEngine } from './sync';
import { LoadingModal } from './ui/loading-modal';
import { SyncModal } from './ui/sync-modal';
import { showError, showSuccess, showNotice } from './ui/notice';
import { NotePickerModal } from './ui/note-picker-modal';

export default class GetNoteSyncPlugin extends Plugin {
  settings!: Settings;
  isSyncing = false;
  private autoSyncIntervalId: number | undefined;
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

    if (this.settings.scheduledSync.enabled) {
      if (this.settings.scheduledSync.syncOnStart) {
        this.startSync();
      }
      this.startAutoSync();
    }

    console.log('[Get笔记 Importer] 插件已加载');
  }

  onunload(): void {
    this.stopAutoSync();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
  }

  stopAutoSync(): void {
    if (this.autoSyncIntervalId !== undefined) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = undefined;
    }
  }

  private async doAutoSync(): Promise<void> {
    try {
      const engine = new SyncEngine(this.app, this.settings);
      const result = await engine.sync(new SyncModal(this.app));
      if (result.created > 0 || result.updated > 0) {
        showNotice(`[Get笔记] 自动同步：新增 ${result.created}，更新 ${result.updated}`);
      }
    } catch {
      showNotice('[Get笔记] 自动同步失败', 10000);
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

  openNotePicker(): void {
    if (this.isSyncing) return;
    const wrapper = new NotePickerModalWrapper(this.app, this);
    wrapper.open();
  }

  async syncSelectedNotes(noteIds: string[]): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.refreshSettingsTab();

    const loading = new LoadingModal(this.app);
    loading.open();

    try {
      const engine = new SyncEngine(this.app, this.settings);
      const syncModal = new SyncModal(this.app);
      syncModal.open();
      loading.close();

      const result = await engine.syncNoteIds(noteIds, syncModal);
      syncModal.showResult(result);

      showSuccess(
        `同步完成：新增 ${result.created} · 更新 ${result.updated} · 跳过 ${result.skipped}`
      );
    } catch (err) {
      loading.close();
      showError(`同步失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isSyncing = false;
      this.refreshSettingsTab();
    }
  }
}

class NotePickerModalWrapper extends Modal {
  constructor(app: App, private plugin: GetNoteSyncPlugin) {
    super(app);
    this.titleEl.setText('选择要同步的笔记');
  }

  onOpen() {
    ReactDOM.render(
      <NotePickerModal
        token={this.plugin.settings.apiToken}
        clientId={this.plugin.settings.clientId}
        onConfirm={async (noteIds) => {
          this.close();
          await this.plugin.syncSelectedNotes(noteIds);
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
