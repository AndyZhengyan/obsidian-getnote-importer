import { App, Modal } from 'obsidian';
import { fetchOpenApiQuota } from '../api';
import { t } from '../i18n';

export class QuotaModal extends Modal {
  private readonly request = new AbortController();

  constructor(app: App, private readonly token: string, private readonly clientId: string) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.textContent = t('settings.viewQuota');
    this.modalEl.classList.add('getnote-quota-modal');
    const feedback = this.contentEl.ownerDocument.createElement('div');
    feedback.textContent = t('settings.loadingQuota');
    feedback.setAttribute('role', 'status');
    this.contentEl.append(feedback);
    void this.loadQuota(feedback);
  }

  onClose(): void {
    this.request.abort();
    this.contentEl.replaceChildren();
  }

  private async loadQuota(feedback: HTMLElement): Promise<void> {
    const { signal } = this.request;
    try {
      const entries = await fetchOpenApiQuota(this.token, this.clientId, signal);
      if (signal.aborted) return;
      if (!entries.length) {
        feedback.textContent = t('settings.quotaUnavailable');
        return;
      }

      const doc = feedback.ownerDocument;
      const list = doc.createElement('ul');
      for (const entry of entries) {
        const row = doc.createElement('li');
        row.textContent = t('settings.quotaEntry', {
          period: t(entry.period === 'daily' ? 'settings.quotaDaily' : 'settings.quotaMonthly'),
          bucket: t('settings.quotaBucket.' + entry.bucket),
          remaining: entry.remaining,
          limit: entry.limit,
        });
        if (entry.resetAt) {
          const reset = doc.createElement('div');
          reset.className = 'getnote-quota-reset';
          reset.textContent = t('settings.quotaResetAt', {
            time: new Date(entry.resetAt * 1000).toLocaleString(),
          });
          row.append(reset);
        }
        list.append(row);
      }
      feedback.replaceChildren(list);
    } catch (error) {
      if (signal.aborted) return;
      feedback.setAttribute('role', 'alert');
      feedback.textContent = error instanceof Error ? error.message : String(error);
    }
  }
}
