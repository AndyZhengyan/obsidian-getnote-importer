import { App, debounce, PluginSettingTab } from 'obsidian';
// @ts-expect-error - ReactDOM available via Preact compat layer
import ReactDOM from 'react-dom';
import { SettingsComponent } from './settings/index';
import type { Settings } from './types';
import type GetNoteSyncPlugin from './main';

export class GetNoteSettingsTab extends PluginSettingTab {
  private debounceTimer: number | undefined;
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
        startSync={() => this.plugin.startSync()}
        isSyncing={this.plugin.isSyncing}
        openNotePicker={() => this.plugin.openNotePicker()}
      />,
      this.containerEl
    );
  }

  hide(): void {
    ReactDOM.unmountComponentAtNode(this.containerEl);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private debouncedSave: () => void;

  updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    this.plugin.settings[key] = value;
    this.debouncedSave();
  };
}
