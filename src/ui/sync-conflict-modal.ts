import { App, Modal } from 'obsidian';
import type { ConflictChoice, SyncConflict } from '../bidirectional-sync';
import { t } from '../i18n';

export class SyncConflictModal extends Modal {
  private settled = false;
  constructor(app: App, private conflict: SyncConflict, private finish: (choice: ConflictChoice) => void,
    private direction: 'upload' | 'download' | 'both' = 'both') { super(app); }
  onOpen(): void {
    this.contentEl.replaceChildren();
    const title = document.createElement('h2'); title.textContent = t('bidirectional.conflictTitle');
    const path = document.createElement('p'); path.textContent = this.conflict.path;
    this.contentEl.append(title, path);
    for (const side of ['local', 'remote'] as const) {
      const details = document.createElement('details'); details.open = true;
      const summary = document.createElement('summary'); summary.textContent = t(`bidirectional.${side}`);
      const content = document.createElement('pre'); content.className = 'getnote-sync-conflict-preview';
      const note = this.conflict[side]; content.textContent = `${note.title}\n${note.tags.join(', ')}\n\n${note.body}`;
      details.append(summary, content); this.contentEl.appendChild(details);
    }
    for (const choice of ['skip', 'upload', 'download'] as const) {
      if (choice !== 'skip' && this.direction !== 'both' && choice !== this.direction) continue;
      const button = document.createElement('button'); button.textContent = t(`bidirectional.choose.${choice}`);
      button.addEventListener('click', () => { this.settled = true; this.finish(choice); this.close(); });
      this.contentEl.appendChild(button);
    }
  }
  onClose(): void { if (!this.settled) this.finish('skip'); this.contentEl.replaceChildren(); }
}

export function resolveSyncConflict(app: App, conflict: SyncConflict, direction: 'upload' | 'download' | 'both' = 'both'): Promise<ConflictChoice> {
  return new Promise(resolve => new SyncConflictModal(app, conflict, resolve, direction).open());
}
