import { App, debounce, PluginSettingTab } from 'obsidian';
import ReactDOM from 'react-dom';
import { SettingsComponent } from './settings/index';
import type { Settings } from './types';
import type GetNoteSyncPlugin from './main';

export class GetNoteSettingsTab extends PluginSettingTab {
  private plugin: GetNoteSyncPlugin;

  constructor(app: App, plugin: GetNoteSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.debouncedSave = debounce(
      () => this.plugin.saveSettings(),
      150,
      true
    );
  }

  display(): void {
    ReactDOM.render(
      <SettingsComponent
        settings={this.plugin.settings}
        updateSetting={this.updateSetting}
        startSync={() => this.plugin.openManualSyncModal()}
        startSubscribedKnowledgeSync={() => this.plugin.syncSubscribedKnowledge()}
        isSyncing={this.plugin.isSyncing}
        syncProgress={this.plugin.syncProgress}
        openNotePicker={() => this.plugin.openNotePicker()}
        openLocalUpload={() => this.plugin.openLocalUploadModal()}
        startAutoSync={() => this.plugin.startAutoSync()}
        stopAutoSync={() => this.plugin.stopAutoSync()}
        cancelSync={() => this.plugin.cancelSync()}
        app={this.app}
        lastSyncTime={this.plugin.lastSyncResult?.timestamp}
        syncHistory={this.plugin.syncHistory}
      />,
      this.containerEl
    );
  }

  hide(): void {
    ReactDOM.unmountComponentAtNode(this.containerEl);
  }

  private debouncedSave: () => void;

  updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    this.plugin.settings[key] = value;
    this.debouncedSave();
  };
}
