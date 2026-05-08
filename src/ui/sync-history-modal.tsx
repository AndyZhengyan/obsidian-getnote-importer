import { App, Modal } from 'obsidian';
import type { SyncHistoryEntry, SyncResultItem } from '../types';
import { t } from '../i18n';

export function openSyncHistoryModal(app: App, history: SyncHistoryEntry[]) {
  const modal = new SyncHistoryModal(app, history);
  modal.open();
}

class SyncHistoryModal extends Modal {
  private history: SyncHistoryEntry[];
  private currentPage = 1;
  private readonly pageSize = 5;

  constructor(app: App, history: SyncHistoryEntry[]) {
    super(app);
    this.history = history;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: t('syncHistory.title') });

    const listEl = contentEl.createDiv('getnote-history-list');

    if (this.history.length === 0) {
      listEl.createSpan({ text: t('syncHistory.empty'), cls: 'getnote-history-empty' });
    } else {
      const formatDuration = (durationMs: number): string => {
        if (durationMs < 1000) return '<1s';
        const seconds = Math.round(durationMs / 1000);
        if (seconds < 60) return `${seconds}s`;
        return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      };

      const formatTime = (timestamp: number): string => {
        if (Number.isNaN(timestamp)) return '-';
        return new Date(timestamp).toLocaleString(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      };

      const formatStatus = (status: SyncHistoryEntry['status']): string => {
        if (status === 'failed') return t('syncHistory.status.failed');
        if (status === 'cancelled') return t('syncHistory.status.cancelled');
        return t('syncHistory.status.success');
      };

      const formatMode = (entry: SyncHistoryEntry): string => {
        if (entry.mode === 'auto' || entry.type === 'auto') return t('syncHistory.mode.auto');
        if (entry.mode === 'selected' || entry.type === 'selective') return t('syncHistory.mode.selected');
        return t('syncHistory.mode.time');
      };

      const formatScope = (entry: SyncHistoryEntry): string => {
        if (entry.scope?.selectedCount !== undefined) {
          return t('syncHistory.params.selected', { count: entry.scope.selectedCount });
        }

        const parts: string[] = [];
        if (entry.scope?.syncStartDate) {
          parts.push(t('syncHistory.params.startDate', { date: entry.scope.syncStartDate }));
        }
        if (entry.scope?.maxDays && entry.scope.maxDays > 0) {
          parts.push(t('syncHistory.params.maxDays', { days: entry.scope.maxDays }));
        }
        return parts.length > 0 ? parts.join(' · ') : t('syncHistory.params.noLimit');
      };

      const renderMeta = (parent: HTMLElement, label: string, value: string): void => {
        const item = parent.createDiv('getnote-history-meta-item');
        item.createSpan({ cls: 'getnote-history-meta-label', text: label });
        item.createSpan({ cls: 'getnote-history-meta-value', text: value });
      };

      const renderSummary = (parent: HTMLElement, entry: SyncHistoryEntry): void => {
        const summary = parent.createDiv('getnote-history-summary-grid');
        summary.createDiv('getnote-history-summary-card').setText(t('syncHistory.items.created', { count: entry.result.created }));
        summary.createDiv('getnote-history-summary-card').setText(t('syncHistory.items.updated', { count: entry.result.updated }));
        summary.createDiv('getnote-history-summary-card').setText(t('syncHistory.items.skipped', { count: entry.result.skipped }));
        summary
          .createDiv(`getnote-history-summary-card${entry.result.failed > 0 ? ' getnote-history-summary-failed' : ''}`)
          .setText(t('syncHistory.items.failed', { count: entry.result.failed }));
      };

      const renderSyncedDetails = (parent: HTMLElement, items: SyncResultItem[]): void => {
        if (items.length === 0) return;

        const group = parent.createDiv('getnote-history-synced-details');
        group
          .createDiv('getnote-history-item-summary synced')
          .setText(t('syncHistory.items.synced', { count: items.length }));

        const list = group.createDiv('getnote-history-write-list');
        items.forEach((item) => {
          const row = list.createDiv('getnote-history-write-row');
          row.createSpan({
            cls: `getnote-history-status-pill ${item.status}`,
            text: item.status === 'created'
              ? t('syncHistory.items.createdLabel')
              : t('syncHistory.items.updatedLabel'),
          });
          const body = row.createDiv('getnote-history-write-body');
          body.createDiv('getnote-history-note-title').setText(item.title);
          body.createDiv('getnote-history-note-meta').setText(`${item.noteType} · ${formatTime(new Date(item.updatedAt).getTime())}`);
        });
      };

      const renderItemGroup = (
        parent: HTMLElement,
        label: string,
        items: SyncResultItem[],
        statusClass: string
      ): void => {
        if (items.length === 0) {
          return;
        }

        const group = parent.createDiv('getnote-history-item-group');
        group
          .createDiv(`getnote-history-item-summary ${statusClass}`)
          .setText(label);

        const list = group.createEl('ul', { cls: 'getnote-history-item-list' });
        items.forEach((item) => {
          const row = list.createEl('li', { cls: 'getnote-history-note-row' });
          row.createSpan({ cls: 'getnote-history-note-title', text: item.title });
          row.createSpan({ cls: 'getnote-history-note-meta', text: `${item.noteType} · ${formatTime(new Date(item.updatedAt).getTime())}` });
          if (item.error) {
            row.createDiv('getnote-history-error').setText(item.error);
          }
        });
      };

      const sortedHistory = this.history.slice().reverse();
      const totalPages = Math.max(1, Math.ceil(sortedHistory.length / this.pageSize));
      const paginationEl = contentEl.createDiv('getnote-history-pagination');

      const renderEntry = (entry: SyncHistoryEntry, index: number): void => {
        const entryEl = listEl.createEl('details', { cls: 'getnote-history-entry' });
        entryEl.open = index === 0;
        entryEl
          .createEl('summary', { cls: 'getnote-history-header' })
          .setText(`${formatTime(entry.finishedAt)} · ${formatMode(entry)} · ${formatStatus(entry.status)}`);

        const detailEl = entryEl.createDiv('getnote-history-entry-body');
        const metaEl = detailEl.createDiv('getnote-history-meta-grid');
        renderMeta(metaEl, t('syncHistory.meta.method'), formatMode(entry));
        renderMeta(metaEl, t('syncHistory.meta.params'), formatScope(entry));
        renderMeta(metaEl, t('syncHistory.meta.filter'), t('syncHistory.filter.default'));
        renderMeta(metaEl, t('syncHistory.meta.result'), `${formatStatus(entry.status)} · ${formatDuration(entry.durationMs)}`);

        renderSummary(detailEl, entry);

        const items = entry.result.items ?? [];
        if (items.length === 0) {
          detailEl.createDiv('getnote-history-empty').setText(t('syncHistory.items.empty'));
        } else {
          detailEl.createEl('h3', { text: t('syncHistory.items.title') });
          const syncedItems = items.filter((item) => item.status === 'created' || item.status === 'updated');
          renderSyncedDetails(detailEl, syncedItems);
          renderItemGroup(
            detailEl,
            t('syncHistory.items.failed', { count: entry.result.failed }),
            items.filter((item) => item.status === 'failed'),
            'failed'
          );
          renderItemGroup(
            detailEl,
            t('syncHistory.items.skipped', { count: entry.result.skipped }),
            items.filter((item) => item.status === 'skipped'),
            'skipped'
          );
        }

        if (entry.error) {
          detailEl.createDiv('getnote-history-error').setText(entry.error);
        }
      };

      const renderPagination = (): void => {
        paginationEl.empty();
        if (totalPages <= 1) return;

        const prevButton = paginationEl.createEl('button', {
          cls: 'mod-secondary getnote-history-page-button',
          text: t('syncHistory.pagination.prev'),
        });
        prevButton.disabled = this.currentPage === 1;
        prevButton.onclick = () => {
          this.currentPage = Math.max(1, this.currentPage - 1);
          renderPage();
        };

        paginationEl.createSpan({
          cls: 'getnote-history-page-label',
          text: t('syncHistory.pagination.page', { page: this.currentPage, total: totalPages }),
        });

        const nextButton = paginationEl.createEl('button', {
          cls: 'mod-secondary getnote-history-page-button',
          text: t('syncHistory.pagination.next'),
        });
        nextButton.disabled = this.currentPage === totalPages;
        nextButton.onclick = () => {
          this.currentPage = Math.min(totalPages, this.currentPage + 1);
          renderPage();
        };
      };

      const renderPage = (): void => {
        listEl.empty();
        const start = (this.currentPage - 1) * this.pageSize;
        sortedHistory
          .slice(start, start + this.pageSize)
          .forEach((entry, index) => renderEntry(entry, index));
        renderPagination();
      };

      renderPage();
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
