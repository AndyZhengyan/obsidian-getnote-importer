import { Modal } from 'obsidian';

export class LoadingModal extends Modal {
  private messageEl: HTMLElement;

  constructor(app: App) {
    super(app);
    this.modalEl.style.textAlign = 'center';
    this.modalEl.style.padding = '24px';
  }

  onOpen() {
    const content = this.contentEl;

    content.createDiv({
      text: '⏳',
      cls: 'getnote-loading-spinner',
    }).style.fontSize = '32px';

    this.messageEl = content.createDiv({
      text: '正在获取笔记列表...',
      cls: 'getnote-loading-message',
    });
    this.messageEl.style.marginTop = '12px';
    this.messageEl.style.color = 'var(--text-muted)';
  }

  setMessage(message: string) {
    if (this.messageEl) {
      this.messageEl.setText(message);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
