import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import {
  migrateDatePaths,
  type DatePathCategoryOrigin,
  type DatePathAssetMoveEvidence,
  type DatePathMigrationIssueCode,
  type DatePathMigrationTarget,
} from '../src/date-path-migration';

type Cache = {
  frontmatter?: Record<string, unknown>;
  embeds?: Array<{ link: string }>;
  links?: Array<{ link: string }>;
};

type MigrationApp = Pick<App, 'vault' | 'metadataCache' | 'fileManager'> & {
  vault: App['vault'] & {
    addFile(path: string, content: string, cache?: Cache): TFile;
    content(path: string): string | undefined;
    paths(): string[];
    failRename(from: string, to: string): void;
    clearRenameFailures(): void;
  };
};

function dirname(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function makeApp(): MigrationApp {
  const files = new Map<string, { file: TFile; content: string }>();
  const caches = new Map<string, Cache>();
  const folders = new Set<string>(['得到大脑']);
  const failedRenames = new Set<string>();

  const ensureParentFolders = (path: string) => {
    const parts = dirname(path).split('/').filter(Boolean);
    for (let index = 1; index <= parts.length; index++) {
      folders.add(parts.slice(0, index).join('/'));
    }
  };

  const vault = {
    addFile(path: string, content: string, cache: Cache = {}) {
      ensureParentFolders(path);
      const file = new TFile(path);
      files.set(path, { file, content });
      caches.set(path, cache);
      return file;
    },
    content(path: string) {
      return files.get(path)?.content;
    },
    paths() {
      return [...files.keys()].sort();
    },
    failRename(from: string, to: string) {
      failedRenames.add(`${from}=>${to}`);
    },
    clearRenameFailures() {
      failedRenames.clear();
    },
    getMarkdownFiles: () =>
      [...files.values()]
        .filter(({ file }) => file.extension === 'md')
        .map(({ file }) => file),
    getFiles: () => [...files.values()].map(({ file }) => file),
    getAllFolders: () => [...folders].map(path => ({ path })),
    getAbstractFileByPath: (path: string) =>
      files.get(path)?.file ?? (folders.has(path) ? { path } : null),
    createFolder: vi.fn(async (path: string) => {
      const parts = path.split('/').filter(Boolean);
      for (let index = 1; index <= parts.length; index++) {
        folders.add(parts.slice(0, index).join('/'));
      }
    }),
    read: vi.fn(async (file: TFile) => files.get(file.path)?.content ?? ''),
    rename: vi.fn(async (file: TFile, targetPath: string) => {
      const sourcePath = file.path;
      if (failedRenames.has(`${sourcePath}=>${targetPath}`)) {
        throw new Error(`rename failed: ${sourcePath}`);
      }
      if (files.has(targetPath)) throw new Error(`target exists: ${targetPath}`);
      const entry = files.get(sourcePath);
      if (!entry) throw new Error(`source missing: ${sourcePath}`);
      files.delete(sourcePath);
      files.set(targetPath, entry);
      const cache = caches.get(sourcePath);
      caches.delete(sourcePath);
      if (cache) caches.set(targetPath, cache);
      file.path = targetPath;
      file.name = targetPath.split('/').pop() ?? '';
      file.basename = file.name.replace(/\.[^.]+$/, '');
      file.extension = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
    }),
    delete: vi.fn(async (folder: { path: string }) => {
      folders.delete(folder.path);
    }),
  };

  const fileManager = {
    renameFile: vi.fn(async (file: TFile, targetPath: string) => {
      const sourcePath = file.path;
      await vault.rename(file, targetPath);
      const sourceLink = sourcePath.replace(/\.md$/, '');
      const targetLink = targetPath.replace(/\.md$/, '');
      for (const entry of files.values()) {
        entry.content = entry.content.replaceAll(sourceLink, targetLink);
      }
    }),
  };

  const metadataCache = {
    getFileCache: (file: TFile) => caches.get(file.path) ?? null,
    getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
      const normalized = linkpath.replace(/^\.\//, '');
      const candidates = [
        `${dirname(sourcePath)}/${normalized}`,
        `${dirname(sourcePath)}/asset/${normalized}`,
        normalized,
      ];
      for (const candidate of candidates) {
        const withExtension = files.has(candidate)
          ? candidate
          : files.has(`${candidate}.md`)
            ? `${candidate}.md`
            : candidate;
        const resolved = files.get(withExtension)?.file;
        if (resolved) return resolved;
      }
      return null;
    },
  };

  return { vault, fileManager, metadataCache } as unknown as MigrationApp;
}

function pluginCache(
  overrides: Partial<Record<'uid' | 'created' | 'modified' | 'note_type' | 'source', unknown>> = {},
  links: Cache = {},
): Cache {
  return {
    frontmatter: {
      uid: '1909193892067130512',
      created: '2026-07-03T10:20:30+08:00',
      note_type: 'plain_text',
      source: '得到大脑',
      ...overrides,
    },
    ...links,
  };
}

function issueCodes(result: Awaited<ReturnType<typeof migrateDatePaths>>): DatePathMigrationIssueCode[] {
  return result.issues.map(issue => issue.code);
}

describe('migrateDatePaths', () => {
  let app: MigrationApp;
  let currentLayout: DatePathMigrationTarget;
  let categoryOrigins: Record<string, DatePathCategoryOrigin>;
  let assetMoveEvidence: Record<string, DatePathAssetMoveEvidence>;

  beforeEach(() => {
    app = makeApp();
    currentLayout = { enabled: false, format: 'YYYY/MM' };
    categoryOrigins = {};
    assetMoveEvidence = {};
  });

  const migrate = async (
    target: DatePathMigrationTarget,
    rootFolder = '得到大脑',
  ) => {
    const source = currentLayout;
    return migrateDatePaths(app, rootFolder, target, {
      source,
      categoryOrigins,
      assetMoveEvidence,
      beforeExecute: async (nextOrigins, nextAssetMoveEvidence) => {
        categoryOrigins = nextOrigins;
        assetMoveEvidence = nextAssetMoveEvidence;
        currentLayout = target;
      },
    });
  };

  it('leaves archived note paths and bytes intact even with stale metadata', async () => {
    const source = '得到大脑/纯文本/归档.md';
    const raw = '---\nuid: "1909193892067130512"\ndedao_sync_archived: true\n---\nlocal variant';
    app.vault.addFile(source, raw, pluginCache());
    const result = await migrate({ enabled: true, format: 'YYYY/MM' });
    expect(result.moved).toBe(0);
    expect(app.vault.content(source)).toBe(raw);
  });

  it('enables created-date paths for normal notes without changing markdown bytes', async () => {
    const source = '得到大脑/纯文本/历史.md';
    const original = '---\r\nuid: "1909193892067130512"\r\n---\r\n正文\r\n';
    app.vault.addFile(source, original, pluginCache());

    const result = await migrate({
      enabled: true,
      format: 'YYYY/MM',
    });

    expect(result).toMatchObject({ scanned: 1, moved: 1, unchanged: 0, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual(['得到大脑/2026/07/纯文本/历史.md']);
    expect(app.vault.content('得到大脑/2026/07/纯文本/历史.md')).toBe(original);
  });

  it('moves only notes with current or legacy plugin ownership markers', async () => {
    app.vault.addFile('得到大脑/纯文本/当前.md', 'current', pluginCache({ uid: 'current' }));
    app.vault.addFile('得到大脑/纯文本/旧版.md', 'legacy', pluginCache({
      uid: 'legacy',
      source: 'Get笔记',
    }));
    app.vault.addFile('得到大脑/纯文本/用户.md', 'user', pluginCache({
      uid: 'user',
      source: '手工笔记',
    }));
    app.vault.addFile('得到大脑/纯文本/无来源.md', 'missing', pluginCache({
      uid: 'missing',
      source: undefined,
    }));

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 2, moved: 2, skipped: 0, failed: 0 });
    expect(result.issues).toEqual([]);
    expect(app.vault.paths()).toEqual([
      '得到大脑/2026/07/纯文本/当前.md',
      '得到大脑/2026/07/纯文本/旧版.md',
      '得到大脑/纯文本/无来源.md',
      '得到大脑/纯文本/用户.md',
    ]);
  });

  it('throws for a root folder with surrounding whitespace before scanning the trimmed root', async () => {
    app.vault.addFile('得到大脑/纯文本/不可触碰.md', 'note', pluginCache());
    const scan = vi.spyOn(app.vault, 'getMarkdownFiles');

    await expect(migrate({
      enabled: true,
      format: 'YYYY/MM',
    }, ' 得到大脑 ')).rejects.toThrow('Unsafe root folder');

    expect(scan).not.toHaveBeenCalled();
    expect(app.vault.paths()).toEqual(['得到大脑/纯文本/不可触碰.md']);
  });

  it('enables, changes format, and disables knowledge-base paths using the created date', async () => {
    app.vault.addFile(
      '得到大脑/知识库/写作/历史.md',
      'kb',
      pluginCache({ uid: 'kb-1', note_type: 'img_text' }),
    );

    const enabled = await migrate({ enabled: true, format: 'YYYY/MM' });
    const reformatted = await migrate({ enabled: true, format: 'YYYY-MM-DD' });
    const disabled = await migrate({ enabled: false, format: 'YYYY-MM-DD' });

    expect(enabled.moved).toBe(1);
    expect(reformatted.moved).toBe(1);
    expect(disabled.moved).toBe(1);
    expect(app.vault.paths()).toEqual(['得到大脑/知识库/写作/历史.md']);
  });

  it('preserves a custom category hierarchy through enable, format change, and disable', async () => {
    const originalPath = '得到大脑/项目/客户甲/历史.md';
    app.vault.addFile(originalPath, 'custom', pluginCache({ uid: 'custom-category' }));

    const enabled = await migrate({ enabled: true, format: 'YYYY/MM' });
    expect(enabled.moved).toBe(1);
    expect(app.vault.paths()).toEqual(['得到大脑/2026/07/项目/客户甲/历史.md']);

    const reformatted = await migrate({ enabled: true, format: 'YYYY-MM-DD' });
    expect(reformatted.moved).toBe(1);
    expect(app.vault.paths()).toEqual(['得到大脑/2026-07-03/项目/客户甲/历史.md']);

    const disabled = await migrate({ enabled: false, format: 'YYYY-MM-DD' });
    expect(disabled.moved).toBe(1);
    expect(app.vault.paths()).toEqual([originalPath]);
  });

  it('rebuilds every synced note below the configured root from its note type, ignoring prior paths and origins', async () => {
    const root = 'notes/Get笔记';
    app.vault.addFile(
      `${root}/旧层级/客户甲/文字.md`,
      'plain',
      pluginCache({ uid: 'rebuild-plain', note_type: 'plain_text' }),
    );
    app.vault.addFile(
      `${root}/2025/12/任意目录/录音.md`,
      'audio',
      pluginCache({ uid: 'rebuild-audio', note_type: 'local_audio' }),
    );

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {
        'rebuild-plain': { path: `${root}/旧层级/客户甲/文字.md`, category: '旧层级/客户甲' },
        'rebuild-audio': { path: `${root}/2025/12/任意目录/录音.md`, category: '任意目录' },
      },
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    } as Parameters<typeof migrateDatePaths>[3]);

    expect(result).toMatchObject({ scanned: 2, moved: 2, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/2026/07/录音笔记/录音.md`,
      `${root}/2026/07/纯文本/文字.md`,
    ]);
  });

  it('keeps the newest duplicate UID in the canonical category and moves the other copy to the conflict archive', async () => {
    const root = 'notes/得到大脑';
    const uid = 'duplicate-uid';
    app.vault.addFile(
      `${root}/录音笔记/重复.md`,
      'old body',
      pluginCache({ uid, note_type: 'audio', modified: '2026-06-02 10:00:00' }),
    );
    app.vault.addFile(
      `${root}/其他/重复.md`,
      'new body',
      pluginCache({ uid, note_type: 'audio', modified: '2026-06-03 10:00:00' }),
    );

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 2, moved: 2, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/2026/07/录音笔记/重复.md`,
      `${root}/重复冲突/${uid}/录音笔记/重复.md`,
    ]);
    expect(app.vault.content(`${root}/2026/07/录音笔记/重复.md`)).toBe('new body');
    expect(app.vault.content(`${root}/重复冲突/${uid}/录音笔记/重复.md`)).toBe('old body');
  });

  it('moves an archived duplicate note together with its referenced attachment', async () => {
    const root = 'notes/得到大脑';
    const uid = 'duplicate-with-asset';
    app.vault.addFile(
      `${root}/录音笔记/重复.md`,
      '![[asset/重复_audio.mp3]]',
      pluginCache(
        { uid, note_type: 'audio', modified: '2026-06-02 10:00:00' },
        { embeds: [{ link: 'asset/重复_audio.mp3' }] },
      ),
    );
    app.vault.addFile(`${root}/录音笔记/asset/重复_audio.mp3`, 'audio');
    app.vault.addFile(
      `${root}/其他/重复.md`,
      'new body',
      pluginCache({ uid, note_type: 'audio', modified: '2026-06-03 10:00:00' }),
    );

    await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(app.vault.paths()).toContain(`${root}/重复冲突/${uid}/录音笔记/asset/重复_audio.mp3`);
  });

  it('keeps a shared attachment with the duplicate UID keeper instead of blocking both notes', async () => {
    const root = 'notes/得到大脑';
    const uid = 'duplicate-shared-asset';
    const link = 'asset/共享_audio.mp3';
    app.vault.addFile(
      `${root}/其他/旧副本.md`,
      `![[${link}]]`,
      pluginCache(
        { uid, note_type: 'audio', modified: '2026-06-02 10:00:00' },
        { embeds: [{ link }] },
      ),
    );
    app.vault.addFile(
      `${root}/录音笔记/新副本.md`,
      `![[${link}]]`,
      pluginCache(
        { uid, note_type: 'audio', modified: '2026-06-03 10:00:00' },
        { embeds: [{ link }] },
      ),
    );
    app.vault.addFile(`${root}/录音笔记/asset/共享_audio.mp3`, 'audio');

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 2, moved: 2, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/2026/07/录音笔记/asset/共享_audio.mp3`,
      `${root}/2026/07/录音笔记/新副本.md`,
      `${root}/重复冲突/${uid}/其他/旧副本.md`,
    ]);
  });

  it('removes empty legacy folders below the sync root after a rebuild', async () => {
    const root = 'notes/得到大脑';
    app.vault.addFile(`${root}/旧分类/待整理.md`, 'body', pluginCache({ uid: 'empty-folder-cleanup' }));

    await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(app.vault.delete).toHaveBeenCalledWith(expect.objectContaining({ path: `${root}/旧分类` }), true);
    expect(app.vault.getAllFolders().map(folder => folder.path)).not.toContain(`${root}/旧分类`);
  });

  it('does not rescan notes already archived in the duplicate-conflict folder', async () => {
    const root = 'notes/得到大脑';
    const archived = `${root}/重复冲突/duplicate-uid/旧分类/重复.md`;
    app.vault.addFile(archived, 'duplicate', pluginCache({ uid: 'duplicate-uid' }));

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 0, moved: 0, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([archived]);
  });

  it('archives an unclaimed legacy asset instead of leaving it in an old category', async () => {
    const root = 'notes/得到大脑';
    const source = `${root}/录音长录/asset/历史孤儿_audio.mp3`;
    app.vault.addFile(source, 'audio');

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 0, moved: 0, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/未归属附件/录音长录/asset/历史孤儿_audio.mp3`,
    ]);
  });

  it('replaces the entire prior date layer when changing to a shorter format', async () => {
    app.vault.addFile(
      '得到大脑/项目/历史.md',
      'custom',
      pluginCache({ uid: 'shorter-date-format' }),
    );

    await migrate({ enabled: true, format: 'YYYY/MM/DD' });
    const reformatted = await migrate({ enabled: true, format: 'YYYY' });

    expect(reformatted.moved).toBe(1);
    expect(app.vault.paths()).toEqual(['得到大脑/2026/项目/历史.md']);
  });

  it('preserves a date-like custom category instead of treating it as a generated layer', async () => {
    const originalPath = '得到大脑/2026/项目/日期同名目录.md';
    const uid = 'date-like-custom-category';
    app.vault.addFile(originalPath, 'custom', pluginCache({ uid }));

    const enabled = await migrate({ enabled: true, format: 'YYYY' });

    expect(enabled.moved).toBe(1);
    expect(app.vault.paths()).toEqual(['得到大脑/2026/2026/项目/日期同名目录.md']);

    const disabled = await migrate({ enabled: false, format: 'YYYY' });

    expect(disabled.moved).toBe(1);
    expect(app.vault.paths()).toEqual([originalPath]);
  });

  it('resumes a failed date-like custom-category move from its persisted origin', async () => {
    const source = '得到大脑/2026/项目/待恢复.md';
    const target = '得到大脑/2026/2026/项目/待恢复.md';
    app.vault.addFile(source, 'custom', pluginCache({ uid: 'date-like-resume' }));
    app.vault.failRename(source, target);

    const failed = await migrate({ enabled: true, format: 'YYYY' });
    app.vault.clearRenameFailures();
    const resumed = await migrate({ enabled: true, format: 'YYYY' });

    expect(failed).toMatchObject({ moved: 0, failed: 1 });
    expect(resumed).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([target]);
  });

  it('moves a note and updates an external path-qualified inbound link', async () => {
    const source = '得到大脑/纯文本/被引用.md';
    app.vault.addFile(source, 'synced', pluginCache({ uid: 'inbound-target' }));
    app.vault.addFile(
      '个人笔记/索引.md',
      '[[得到大脑/纯文本/被引用]]',
      { links: [{ link: '得到大脑/纯文本/被引用' }] },
    );

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toContain('得到大脑/2026/07/纯文本/被引用.md');
    expect(app.vault.content('个人笔记/索引.md')).toBe('[[得到大脑/2026/07/纯文本/被引用]]');
    expect(app.fileManager.renameFile).toHaveBeenCalledOnce();
  });

  it('moves a note with a same-directory Markdown link through Obsidian file management', async () => {
    const source = '得到大脑/纯文本/含相对链接.md';
    const stationary = '得到大脑/纯文本/用户笔记.md';
    app.vault.addFile(
      source,
      '[用户笔记](用户笔记.md)',
      pluginCache(
        { uid: 'relative-outbound' },
        { links: [{ link: '用户笔记.md' }] },
      ),
    );
    app.vault.addFile(stationary, 'user-owned');

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toContain('得到大脑/2026/07/纯文本/含相对链接.md');
    expect(app.vault.paths()).toContain(stationary);
    expect(app.fileManager.renameFile).toHaveBeenCalledOnce();
  });

  it('moves a target with a stationary same-directory Markdown link through Obsidian file management', async () => {
    const source = '得到大脑/纯文本/被引用.md';
    const stationary = '得到大脑/纯文本/用户索引.md';
    app.vault.addFile(source, 'synced', pluginCache({ uid: 'same-dir-inbound' }));
    app.vault.addFile(
      stationary,
      '[同步笔记](被引用.md)',
      { links: [{ link: '被引用.md' }] },
    );

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toContain('得到大脑/2026/07/纯文本/被引用.md');
    expect(app.vault.paths()).toContain(stationary);
    expect(app.fileManager.renameFile).toHaveBeenCalledOnce();
  });

  it('moves a note and its asset when an external path-qualified link targets the asset', async () => {
    const notePath = '得到大脑/图片笔记/带外链附件.md';
    const assetPath = '得到大脑/图片笔记/asset/带外链附件_image.png';
    const noteContent = '![[asset/带外链附件_image.png]]';
    const indexContent = '![[得到大脑/图片笔记/asset/带外链附件_image.png]]';
    app.vault.addFile(notePath, noteContent, pluginCache(
      { uid: 'external-asset-link', note_type: 'img_text' },
      { embeds: [{ link: 'asset/带外链附件_image.png' }] },
    ));
    app.vault.addFile(assetPath, 'image');
    app.vault.addFile(
      '个人笔记/附件索引.md',
      indexContent,
      { embeds: [{ link: '得到大脑/图片笔记/asset/带外链附件_image.png' }] },
    );

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toContain('得到大脑/2026/07/图片笔记/带外链附件.md');
    expect(app.vault.paths()).toContain('得到大脑/2026/07/图片笔记/asset/带外链附件_image.png');
    expect(app.vault.content('个人笔记/附件索引.md')).toBe('![[得到大脑/2026/07/图片笔记/asset/带外链附件_image.png]]');
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(2);
  });

  it('moves only exact referenced adjacent assets and leaves unreferenced siblings in place', async () => {
    const notePath = '得到大脑/图片笔记/带图.md';
    app.vault.addFile(notePath, '![[asset/带图_image.png]]', pluginCache({ note_type: 'img_text' }, {
      embeds: [{ link: 'asset/带图_image.png' }],
    }));
    app.vault.addFile('得到大脑/图片笔记/asset/带图_image.png', 'image');
    app.vault.addFile('得到大脑/图片笔记/asset/未引用.png', 'orphan');

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result.moved).toBe(1);
    expect(app.vault.paths()).toEqual([
      '得到大脑/2026/07/图片笔记/asset/带图_image.png',
      '得到大脑/2026/07/图片笔记/带图.md',
      '得到大脑/图片笔记/asset/未引用.png',
    ]);
  });

  it('moves an extensionless adjacent asset when Obsidian metadata cannot resolve its link', async () => {
    const root = 'notes/得到大脑';
    const notePath = `${root}/链接笔记/带网页附件.md`;
    const assetPath = `${root}/链接笔记/asset/带网页附件_0123456789abcdef01234567`;
    app.vault.addFile(notePath, '![[asset/带网页附件_0123456789abcdef01234567]]', pluginCache(
      { uid: 'extensionless-asset', note_type: 'link' },
      { embeds: [{ link: 'asset/带网页附件_0123456789abcdef01234567' }] },
    ));
    app.vault.addFile(assetPath, '<html>saved page</html>');
    vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(null);

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 1, moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/2026/07/链接笔记/asset/带网页附件_0123456789abcdef01234567`,
      `${root}/2026/07/链接笔记/带网页附件.md`,
    ]);
  });

  it('recovers a uniquely named legacy image asset after its note already reached the monthly folder', async () => {
    const root = 'notes/得到大脑';
    const name = '阿里云会议_image.jpeg';
    app.vault.addFile(
      `${root}/2026/08/图片笔记/阿里云会议.md`,
      `![[asset/${name}]]`,
      pluginCache(
        { uid: 'legacy-image', note_type: 'img_text', created: '2026-08-12T19:34:37+08:00' },
        { embeds: [{ link: `asset/${name}` }] },
      ),
    );
    app.vault.addFile(`${root}/图片笔记/asset/${name}`, 'image');

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 1, moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/2026/08/图片笔记/asset/${name}`,
      `${root}/2026/08/图片笔记/阿里云会议.md`,
    ]);
  });

  it('recovers UID-suffixed audio assets from a legacy category when the note links use shorter names', async () => {
    const root = 'notes/得到大脑';
    const uid = '1911665846536430016';
    const title = '当前国内通缩';
    app.vault.addFile(`${root}/其他/${title}.md`, [
      `![[${title}_audio.mp3]]`,
      `![[${title}_transcript]]`,
    ].join('\n'), pluginCache(
      { uid, note_type: 'audio' },
      {
        embeds: [
          { link: `${title}_audio.mp3` },
          { link: `${title}_transcript` },
        ],
      },
    ));
    app.vault.addFile(`${root}/录音笔记/asset/20260602131856_${title}_${uid}_audio.mp3`, 'audio');
    app.vault.addFile(`${root}/录音笔记/asset/20260602131856_${title}_${uid}_transcript.md`, 'transcript');

    const result = await migrateDatePaths(app, root, { enabled: true, format: 'YYYY/MM' }, {
      source: { enabled: true, format: 'YYYY/MM' },
      categoryOrigins: {},
      assetMoveEvidence: {},
      rebuildCategories: true,
      beforeExecute: async () => {},
    });

    expect(result).toMatchObject({ scanned: 1, moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      `${root}/2026/07/录音笔记/asset/20260602131856_${title}_${uid}_audio.mp3`,
      `${root}/2026/07/录音笔记/asset/20260602131856_${title}_${uid}_transcript.md`,
      `${root}/2026/07/录音笔记/${title}.md`,
    ]);
  });

  it('skips malformed metadata and unresolved generated assets but ignores ordinary broken links', async () => {
    app.vault.addFile('得到大脑/纯文本/缺元数据.md', 'bad', pluginCache({ created: 123 }));
    app.vault.addFile('得到大脑/纯文本/缺附件.md', '![[asset/笔记_image.png]]', pluginCache(
      { uid: 'missing-asset' },
      { embeds: [{ link: 'asset/笔记_image.png' }] },
    ));
    app.vault.addFile('得到大脑/纯文本/普通断链.md', '[[不存在的普通笔记]]', pluginCache(
      { uid: 'broken-link' },
      { links: [{ link: '不存在的普通笔记' }] },
    ));

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 3, moved: 1, skipped: 2, failed: 0 });
    expect(issueCodes(result)).toEqual(expect.arrayContaining(['invalid-metadata', 'missing-generated-asset']));
    expect(app.vault.paths()).toContain('得到大脑/2026/07/纯文本/普通断链.md');
    expect(app.vault.paths()).toContain('得到大脑/纯文本/缺元数据.md');
    expect(app.vault.paths()).toContain('得到大脑/纯文本/缺附件.md');
  });

  it('recovers a legacy numeric UID from raw frontmatter without stringifying the lossy cache value', async () => {
    const exactUid = '1909999999999999999';
    const source = '得到大脑/纯文本/旧 UID.md';
    app.vault.addFile(source, [
      '---',
      `uid: ${exactUid}`,
      'created: 2026-07-03T10:20:30+08:00',
      'source: Get笔记',
      'note_type: plain_text',
      '---',
      '正文',
    ].join('\n'), pluginCache({
      uid: Number(exactUid),
      source: 'Get笔记',
    }));

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 1, moved: 1, skipped: 0, failed: 0 });
    expect(categoryOrigins[exactUid]).toEqual({
      path: source,
      category: '纯文本',
    });
    expect(categoryOrigins[String(Number(exactUid))]).toBeUndefined();
  });

  it('globally preflights existing targets and shared assets without moving affected notes', async () => {
    app.vault.addFile('得到大脑/纯文本/冲突.md', 'source', pluginCache({ uid: 'conflict' }));
    app.vault.addFile('得到大脑/2026/07/纯文本/冲突.md', 'occupied');

    for (const [name, uid] of [['一', 'shared-1'], ['二', 'shared-2']] as const) {
      app.vault.addFile(`得到大脑/纯文本/${name}.md`, '[[asset/shared.png]]', pluginCache(
        { uid },
        { embeds: [{ link: 'asset/shared.png' }] },
      ));
    }
    app.vault.addFile('得到大脑/纯文本/asset/shared.png', 'shared');

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 3, moved: 0, skipped: 3, failed: 0 });
    expect(issueCodes(result)).toEqual(expect.arrayContaining(['target-conflict', 'shared-asset']));
  });

  it('lets non-plugin notes claim adjacent assets so plugin plans cannot move user-owned files', async () => {
    app.vault.addFile('得到大脑/图片笔记/插件.md', '[[asset/shared.png]]', pluginCache(
      { uid: 'plugin', note_type: 'img_text' },
      { embeds: [{ link: 'asset/shared.png' }] },
    ));
    app.vault.addFile('得到大脑/图片笔记/用户.md', '[[asset/shared.png]]', pluginCache(
      { uid: 'user', note_type: 'img_text', source: '手工笔记' },
      { embeds: [{ link: 'asset/shared.png' }] },
    ));
    app.vault.addFile('得到大脑/图片笔记/asset/shared.png', 'user-owned');

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 1, moved: 0, skipped: 1, failed: 0 });
    expect(issueCodes(result)).toEqual(['shared-asset']);
    expect(app.vault.paths()).toEqual([
      '得到大脑/图片笔记/asset/shared.png',
      '得到大脑/图片笔记/插件.md',
      '得到大脑/图片笔记/用户.md',
    ]);
  });

  it('keeps UID and asset claims from plugin notes that later fail planning', async () => {
    app.vault.addFile('得到大脑/图片笔记/有效.md', '[[asset/shared.png]]', pluginCache(
      { uid: 'claimed', note_type: 'img_text' },
      { embeds: [{ link: 'asset/shared.png' }] },
    ));
    app.vault.addFile('得到大脑/图片笔记/无效.md', '[[asset/shared.png]]', pluginCache(
      { uid: 'claimed', created: 'not-a-date', note_type: 'img_text' },
      { embeds: [{ link: 'asset/shared.png' }] },
    ));
    app.vault.addFile('得到大脑/图片笔记/asset/shared.png', 'shared');

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 2, moved: 0, skipped: 2, failed: 0 });
    expect(issueCodes(result)).toEqual(expect.arrayContaining([
      'unsafe-path',
      'duplicate-uid',
      'shared-asset',
    ]));
    expect(app.vault.paths()).toContain('得到大脑/图片笔记/有效.md');
    expect(app.vault.paths()).toContain('得到大脑/图片笔记/asset/shared.png');
  });

  it('rolls back moved assets when markdown rename fails and continues with later notes', async () => {
    app.vault.addFile('得到大脑/图片笔记/失败.md', '[[asset/失败_image.png]]', pluginCache(
      { uid: 'failure', note_type: 'img_text' },
      { embeds: [{ link: 'asset/失败_image.png' }] },
    ));
    app.vault.addFile('得到大脑/图片笔记/asset/失败_image.png', 'image');
    app.vault.failRename(
      '得到大脑/图片笔记/失败.md',
      '得到大脑/2026/07/图片笔记/失败.md',
    );
    app.vault.addFile('得到大脑/纯文本/继续.md', 'ok', pluginCache({ uid: 'continue' }));

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ scanned: 2, moved: 1, skipped: 0, failed: 1 });
    expect(issueCodes(result)).toContain('rename-failed');
    expect(app.vault.paths()).toEqual([
      '得到大脑/2026/07/纯文本/继续.md',
      '得到大脑/图片笔记/asset/失败_image.png',
      '得到大脑/图片笔记/失败.md',
    ]);
  });

  it('resumes when an interrupted run already moved the deterministic target asset', async () => {
    app.vault.addFile('得到大脑/图片笔记/崩溃.md', '[[asset/崩溃_image.png]]', pluginCache(
      { uid: 'crash', note_type: 'img_text' },
      { embeds: [{ link: 'asset/崩溃_image.png' }] },
    ));
    app.vault.addFile('得到大脑/2026/07/图片笔记/asset/崩溃_image.png', 'image');
    assetMoveEvidence['得到大脑/2026/07/图片笔记/asset/崩溃_image.png'] = {
      uid: 'crash',
      sourcePath: '得到大脑/图片笔记/asset/崩溃_image.png',
      targetPath: '得到大脑/2026/07/图片笔记/asset/崩溃_image.png',
    };

    const resumed = await migrate({ enabled: true, format: 'YYYY/MM' });
    const repeated = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(resumed).toMatchObject({ scanned: 1, moved: 1, skipped: 0, failed: 0 });
    expect(repeated).toMatchObject({ scanned: 1, moved: 0, unchanged: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([
      '得到大脑/2026/07/图片笔记/asset/崩溃_image.png',
      '得到大脑/2026/07/图片笔记/崩溃.md',
    ]);
  });

  it('rejects an unverified same-name target asset and leaves the whole note untouched', async () => {
    const noteSource = '得到大脑/图片笔记/冲突附件.md';
    const assetTarget = '得到大脑/2026/07/图片笔记/asset/冲突附件_image.png';
    const noteContent = '![[asset/冲突附件_image.png]]';
    app.vault.addFile(noteSource, noteContent, pluginCache(
      { uid: 'unverified-target-asset', note_type: 'img_text' },
      { embeds: [{ link: 'asset/冲突附件_image.png' }] },
    ));
    app.vault.addFile(assetTarget, 'unrelated');

    const result = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(result).toMatchObject({ moved: 0, skipped: 1, failed: 0 });
    expect(issueCodes(result)).toContain('target-conflict');
    expect(app.vault.paths()).toEqual([assetTarget, noteSource]);
    expect(app.vault.content(noteSource)).toBe(noteContent);
    expect(app.vault.content(assetTarget)).toBe('unrelated');
    expect(app.vault.rename).not.toHaveBeenCalled();
    expect(assetMoveEvidence).toEqual({});
  });

  it('retries safely after rollback itself left an asset at the deterministic target', async () => {
    const noteSource = '得到大脑/图片笔记/回滚失败.md';
    const noteTarget = '得到大脑/2026/07/图片笔记/回滚失败.md';
    const assetSource = '得到大脑/图片笔记/asset/回滚失败_image.png';
    const assetTarget = '得到大脑/2026/07/图片笔记/asset/回滚失败_image.png';
    app.vault.addFile(noteSource, '[[asset/回滚失败_image.png]]', pluginCache(
      { uid: 'rollback-crash', note_type: 'img_text' },
      { embeds: [{ link: 'asset/回滚失败_image.png' }] },
    ));
    app.vault.addFile(assetSource, 'image');
    app.vault.failRename(noteSource, noteTarget);
    app.vault.failRename(assetTarget, assetSource);

    const failed = await migrate({ enabled: true, format: 'YYYY/MM' });
    app.vault.clearRenameFailures();
    const retried = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(failed).toMatchObject({ moved: 0, failed: 1 });
    expect(issueCodes(failed)).toEqual(expect.arrayContaining(['rename-failed', 'rollback-failed']));
    expect(retried).toMatchObject({ scanned: 1, moved: 1, skipped: 0, failed: 0 });
    expect(app.vault.paths()).toEqual([assetTarget, noteTarget]);
  });

  it('is idempotent and reconciles misplaced notes even when the target setting is unchanged', async () => {
    app.vault.addFile('得到大脑/纯文本/错位.md', 'note', pluginCache({ uid: 'misplaced' }));

    const first = await migrate({ enabled: true, format: 'YYYY/MM' });
    const second = await migrate({ enabled: true, format: 'YYYY/MM' });

    expect(first.moved).toBe(1);
    expect(second).toMatchObject({ scanned: 1, moved: 0, unchanged: 1, skipped: 0, failed: 0 });
    expect(second.issues).toEqual([]);
  });
});
