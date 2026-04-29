import { Modal } from 'obsidian';
import type { SyncResult } from '../types';

export class SyncModal extends Modal {
  private statusEl: HTMLElement;
  private progressEl: HTMLElement;
  private countEl: HTMLElement;

  constructor(app: App) {
    super(app);
    this.modalEl.style.padding = '24px';
  }

  onOpen() {
    const content = this.contentEl;

    content.createDiv({
      text: 'Get笔记 同步中',
      cls: 'getnote-sync-title',
    }).style.fontSize = '16px';
    content.createDiv('').style.marginBottom = '12px';

    this.progressEl = content.createDiv({ text: '正在连接 API...' });
    this.statusEl = content.createDiv({ text: '' });
    this.statusEl.style.color = 'var(--text-muted)';
    this.statusEl.style.marginTop = '8px';
    this.countEl = content.createDiv({ text: '' });
    this.countEl.style.marginTop = '4px';
  }

  setProgress(message: string) {
    if (this.progressEl) this.progressEl.setText(message);
  }

  setStatus(message: string) {
    if (this.statusEl) this.statusEl.setText(message);
  }

  setCount(message: string) {
    if (this.countEl) this.countEl.setText(message);
  }

  showResult(result: SyncResult) {
    this.progressEl.setText('同步完成');
    this.statusEl.setText(
      `新增 ${result.created} · 更新 ${result.updated} · 跳过 ${result.skipped} · 失败 ${result.failed}`
    );
    this.countEl.setText(`共处理 ${result.total} 条笔记`);
    setTimeout(() => this.close(), 3000);
  }

  onClose() {
    this.contentEl.empty();
  }
}
