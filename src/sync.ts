import { App, TFile } from 'obsidian';
import { fetchAllNotes } from './api';
import { renderNote } from './note-parser';
import { getCategoryDir } from './types';
import type { GetNoteNote, Settings, SyncResult } from './types';
import type { SyncModal } from './ui/sync-modal';

export class SyncEngine {
  private app: App;
  private settings: Settings;

  constructor(app: App, settings: Settings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * 确保分类目录存在，返回目录路径
   */
  private async ensureCategoryDir(categoryDir: string): Promise<string> {
    const basePath = this.settings.folderName;
    const fullPath = `${basePath}/${categoryDir}`;
    const targetDir = this.app.vault.getAbstractFileByPath(fullPath);

    if (!targetDir) {
      await this.app.vault.createFolder(fullPath);
    }
    return fullPath;
  }

  /**
   * 获取文件路径（note_id 命名）
   */
  private getFilePath(categoryDir: string, note: GetNoteNote): string {
    return `${categoryDir}/${note.note_id}.md`;
  }

  /**
   * 判断文件内容是否变化（比较 updated_at）
   */
  private async isContentChanged(file: TFile, note: GetNoteNote): Promise<boolean> {
    try {
      const cached = this.app.metadataCache.getFileCache(file);
      if (!cached?.frontmatter) return true;
      const modified = cached.frontmatter['modified'] as string | undefined;
      if (!modified) return true;
      const noteModified = this.formatObsidianDate(note.updated_at);
      return modified !== noteModified;
    } catch {
      return true;
    }
  }

  private formatObsidianDate(iso: string): string {
    const match = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
    if (match) return `${match[1]} ${match[2]}`;
    return iso;
  }

  /**
   * 写入或更新单条笔记
   */
  private async writeNote(note: GetNoteNote): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
    try {
      const categoryDir = await this.ensureCategoryDir(getCategoryDir(note.note_type));
      const filePath = this.getFilePath(categoryDir, note);
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);

      if (existingFile && existingFile instanceof TFile) {
        const changed = await this.isContentChanged(existingFile, note);
        if (!changed) return 'skipped';
        const content = renderNote(note);
        await this.app.vault.modify(existingFile, content);
        return 'updated';
      } else {
        const content = renderNote(note);
        await this.app.vault.create(filePath, content);
        return 'created';
      }
    } catch (err) {
      console.error(`[Get笔记] 写入失败 [${note.note_id}]:`, err);
      return 'failed';
    }
  }

  /**
   * 过滤超期笔记（按 maxDays）
   */
  private filterRecentNotes(notes: GetNoteNote[]): GetNoteNote[] {
    if (this.settings.maxDays <= 0) return notes;

    const cutoff = Date.now() - this.settings.maxDays * 24 * 60 * 60 * 1000;
    return notes.filter(note => {
      const updated = new Date(note.updated_at).getTime();
      return updated >= cutoff;
    });
  }

  /**
   * 执行同步
   */
  async sync(modal: SyncModal): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0 };

    let pageCount = 0;

    for await (const notes of fetchAllNotes(this.settings.apiToken, this.settings.clientId)) {
      pageCount++;
      modal.setProgress(`正在获取笔记... 第 ${pageCount} 页`);
      modal.setCount(`已获取 ${result.total} 条笔记`);

      const filtered = this.filterRecentNotes(notes);

      for (const note of filtered) {
        result.total++;
        const status = await this.writeNote(note);

        switch (status) {
          case 'created': result.created++; break;
          case 'updated': result.updated++; break;
          case 'skipped': result.skipped++; break;
          case 'failed': result.failed++; break;
        }

        if (result.total % 10 === 0) {
          modal.setCount(
            `处理中：新增 ${result.created} · 更新 ${result.updated} · 跳过 ${result.skipped} · 失败 ${result.failed}`
          );
        }
      }
    }

    return result;
  }
}
