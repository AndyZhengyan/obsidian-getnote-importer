import { App, Modal } from 'obsidian';
import type { SyncResult } from '../types';
import { t } from '../i18n';

export class SyncModal extends Modal {
  private statusEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private countEl!: HTMLElement;
  private cancelBtn!: HTMLButtonElement;
  private progressFill!: HTMLElement;
  private cancelled = false;
  private onCancelCb?: () => void;

  constructor(app: App) {
    super(app);
    this.modalEl.addClass('getnote-sync-modal');
  }

  onOpen() {
    const content = this.contentEl;

    content.createDiv({
      text: t('modal.title'),
      cls: 'getnote-sync-title',
    });
    content.createDiv({ cls: 'getnote-sync-spacer' });

    this.progressEl = content.createDiv({ text: t('modal.connecting') });
    this.countEl = content.createDiv({ text: '', cls: 'getnote-sync-count' });

    const bar = content.createDiv({ cls: 'getnote-progress-bar' });
    this.progressFill = bar.createDiv({ cls: 'getnote-progress-fill' });
    this.progressFill.setCssProps({ '--getnote-progress-width': '0%' });

    this.statusEl = content.createDiv({ text: '', cls: 'getnote-sync-modal-status' });

    const btnWrapper = content.createDiv({ cls: 'getnote-sync-modal-footer' });
    this.cancelBtn = btnWrapper.createEl('button', {
      text: t('modal.cancel'),
      cls: 'mod-warning',
    });
    this.cancelBtn.onclick = () => {
      this.cancelled = true;
      this.cancelBtn.disabled = true;
      this.cancelBtn.textContent = t('modal.cancelled');
      this.progressEl.setText(t('modal.cancelled'));
      this.onCancelCb?.();
    };
  }

  setProgress(message: string) {
    if (this.progressEl) this.progressEl.setText(message);
  }

  setCount(message: string) {
    if (this.countEl) this.countEl.setText(message);
  }

  setProgressPercent(percent: number) {
    if (this.progressFill) {
      this.progressFill.setCssProps({ '--getnote-progress-width': `${Math.min(percent, 100)}%` });
    }
  }

  setOnCancel(cb: () => void) {
    this.onCancelCb = cb;
  }

  showResult(result: SyncResult) {
    this.progressFill.setCssProps({ '--getnote-progress-width': '100%' });
    this.progressEl.setText(t('modal.done'));
    this.statusEl.setText(
      `${t('modal.created', { created: result.created })} · ${t('modal.updated', { updated: result.updated })} · ${t('modal.skipped', { skipped: result.skipped })} · ${t('modal.failed', { failed: result.failed })}`
    );
    this.countEl.setText(t('modal.total', { total: result.total }));
    this.cancelBtn.addClass('getnote-hidden');
    window.setTimeout(() => this.close(), 3000);
  }

  showCancelled() {
    this.progressEl.setText(t('modal.cancelled'));
    this.statusEl.setText('');
    this.cancelBtn.addClass('getnote-hidden');
    window.setTimeout(() => this.close(), 1500);
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  cancel(): void {
    if (!this.cancelled) {
      this.cancelled = true;
      if (this.cancelBtn) {
        this.cancelBtn.disabled = true;
        this.cancelBtn.textContent = t('modal.cancelled');
      }
      if (this.progressEl) this.progressEl.setText(t('modal.cancelled'));
      this.onCancelCb?.();
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
