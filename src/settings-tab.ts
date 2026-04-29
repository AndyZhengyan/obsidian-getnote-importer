// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { App, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';

export class GetNoteSettingsTab extends PluginSettingTab {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createDiv('getnote-settings-header', el => {
      el.createEl('h2', { text: 'Get笔记 Importer' });
      el.createEl('p', {
        text: '将 Get笔记 App 的笔记同步到 Obsidian vault',
        cls: 'getnote-settings-desc',
      });
    });

    // API Token
    new Setting(containerEl)
      .setName('API Token')
      .setDesc('Get笔记开放平台的 Authorization Token（gk_live_xxx）')
      .addText(text => text
        .setPlaceholder('gk_live_xxx')
        .setValue(this.plugin.settings.apiToken)
        .onChange(async value => {
          this.plugin.settings.apiToken = value.trim();
          await this.plugin.saveSettings();
        })
      );

    // Client ID
    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Get笔记开放平台的 Client ID（cli_xxx）')
      .addText(text => text
        .setPlaceholder('cli_xxx')
        .setValue(this.plugin.settings.clientId)
        .onChange(async value => {
          this.plugin.settings.clientId = value.trim();
          await this.plugin.saveSettings();
        })
      );

    // 目标文件夹
    new Setting(containerEl)
      .setName('目标文件夹')
      .setDesc('笔记同步到 vault 内的子目录名（默认：Get笔记）')
      .addText(text => text
        .setPlaceholder('Get笔记')
        .setValue(this.plugin.settings.folderName)
        .onChange(async value => {
          const clean = value.replace(/[\\/:*?"<>|]/g, '').trim() || 'Get笔记';
          this.plugin.settings.folderName = clean;
          await this.plugin.saveSettings();
        })
      );

    // 同步模式
    new Setting(containerEl)
      .setName('同步模式')
      .setDesc('增量同步只拉取新增/改动，全量同步从第一页开始')
      .addDropdown(dropdown => dropdown
        .addOption('incremental', '增量同步（推荐）')
        .addOption('full', '全量同步')
        .setValue(this.plugin.settings.syncMode)
        .onChange(async value => {
          this.plugin.settings.syncMode = value as 'incremental' | 'full';
          await this.plugin.saveSettings();
        })
      );

    // 最大同步天数
    new Setting(containerEl)
      .setName('最大同步天数')
      .setDesc('只同步最近 N 天内更新的笔记（0 = 不限制）')
      .addText(text => text
        .setPlaceholder('30')
        .setValue(String(this.plugin.settings.maxDays))
        .onChange(async value => {
          const n = parseInt(value, 10);
          this.plugin.settings.maxDays = isNaN(n) || n < 0 ? 0 : n;
          await this.plugin.saveSettings();
        })
      );

    // 分割线
    containerEl.createDiv('getnote-settings-divider');

    // 同步按钮
    const btnSetting = new Setting(containerEl);
    btnSetting.setName('同步');
    const syncBtn = new ButtonComponent(btnSetting.controlEl);
    syncBtn.setButtonText('立即同步');
    syncBtn.setCta();
    syncBtn.onClick(() => this.plugin.startSync());
    btnSetting.descEl.createSpan('', el => {
      el.textContent = '点击后将 Get笔记笔记同步到 vault';
    });

    // 验证提示
    if (!this.plugin.settings.apiToken || !this.plugin.settings.clientId) {
      syncBtn.setDisabled(true);
      syncBtn.setButtonText('请先填写 API Token 和 Client ID');
    }
  }
}
