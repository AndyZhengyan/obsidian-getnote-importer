import { isArchivedSyncNote } from './sync-note-state';
import type { App, CachedMetadata, TFile } from 'obsidian';
import { buildCanonicalCategoryDir, formatCreatedDatePath } from './date-paths';
import { getCategoryDir } from './types';

export interface DatePathMigrationTarget {
  enabled: boolean;
  format: string;
}

export interface DatePathMigrationOptions {
  rebuildCategories?: boolean;
}

export interface DatePathCategoryOrigin {
  path: string;
  category: string;
}

export interface DatePathAssetMoveEvidence {
  uid: string;
  sourcePath: string;
  targetPath: string;
}

export interface DatePathMigrationContext {
  source: DatePathMigrationTarget;
  categoryOrigins: Record<string, DatePathCategoryOrigin>;
  assetMoveEvidence: Record<string, DatePathAssetMoveEvidence>;
  /** Ignore historical folders and derive the canonical category from note_type. */
  rebuildCategories?: boolean;
  /** Build the complete migration plan without persisting settings or renaming files. */
  dryRun?: boolean;
  beforeExecute: (
    categoryOrigins: Record<string, DatePathCategoryOrigin>,
    assetMoveEvidence: Record<string, DatePathAssetMoveEvidence>,
  ) => Promise<void>;
}

export type DatePathMigrationIssueCode =
  | 'invalid-metadata'
  | 'unsafe-path'
  | 'missing-generated-asset'
  | 'shared-asset'
  | 'duplicate-uid'
  | 'target-conflict'
  | 'inbound-link'
  | 'rename-failed'
  | 'rollback-failed';

export interface DatePathMigrationIssue {
  code: DatePathMigrationIssueCode;
  path: string;
  uid?: string;
  message: string;
}

export interface DatePathMigrationResult {
  scanned: number;
  planned?: number;
  moved: number;
  unchanged: number;
  skipped: number;
  failed: number;
  issues: DatePathMigrationIssue[];
}

type MigrationApp = Pick<App, 'vault' | 'metadataCache' | 'fileManager'>;

interface PlannedMove {
  file: TFile;
  sourcePath: string;
  targetPath: string;
}

interface NoteCandidate {
  file: TFile;
  links: LinkResolution[];
  pluginOwned: boolean;
  uid?: string;
  category?: string;
  modified?: string;
  targetPath?: string;
  assets: PlannedMove[];
  assetClaims: Set<string>;
  blocked: boolean;
  skipped: boolean;
}

const RESERVED_SEGMENT_PATTERN = /[\\:*?"<>|\0]/;
const PLUGIN_SOURCES = new Set(['得到大脑', 'Get笔记']);
const GENERATED_ASSET_PATTERN =
  /(?:^|\/)asset\/|_(?:image(?:_\d+)?|audio|transcript|original|file_\d+)(?:\.|$)/i;

function dirname(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function basename(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? path : path.slice(separator + 1);
}

function isSafeSegment(segment: string): boolean {
  return Boolean(segment)
    && segment !== '.'
    && segment !== '..'
    && !RESERVED_SEGMENT_PATTERN.test(segment);
}

function isInsideRoot(path: string, rootFolder: string): boolean {
  return path.startsWith(`${rootFolder}/`)
    && !path.includes('/asset/')
    && !path.startsWith(`${rootFolder}/重复冲突/`);
}

function readRequiredString(
  frontmatter: Record<string, unknown> | undefined,
  key: 'uid' | 'created' | 'note_type' | 'source',
): string | null {
  const value = frontmatter?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function readLegacyNumericUid(app: MigrationApp, file: TFile): Promise<string | null> {
  const content = await app.vault.read(file);
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return null;
  const uid = frontmatter[1].match(/^\s*uid\s*:\s*([0-9]+)\s*$/m)?.[1];
  return uid || null;
}

function existingCategoryDir(
  filePath: string,
  rootFolder: string,
  created: string,
  uid: string,
  context: DatePathMigrationContext,
): string | null {
  const relativeDir = dirname(filePath).slice(rootFolder.length + 1);
  if (!relativeDir) return null;

  const origin = context.categoryOrigins[uid];
  if (origin?.path === filePath) return origin.category;

  if (context.source.enabled) {
    const sourceDatePath = formatCreatedDatePath(created, context.source.format);
    if (relativeDir.startsWith(`${sourceDatePath}/`)) {
      return relativeDir.slice(sourceDatePath.length + 1);
    }
  }

  return relativeDir;
}

function desiredNotePath(
  file: TFile,
  rootFolder: string,
  created: string,
  categoryDir: string,
  target: DatePathMigrationTarget,
): string {
  if (!categoryDir.split('/').every(isSafeSegment)) {
    throw new Error('Unsafe category path');
  }
  const desiredDir = target.enabled
    ? buildCanonicalCategoryDir(rootFolder, categoryDir, created, target.format)
    : `${rootFolder}/${categoryDir}`;
  return `${desiredDir}/${basename(file.path)}`;
}

function desiredConflictPath(file: TFile, rootFolder: string, uid: string): string {
  const relativeDir = dirname(file.path).slice(rootFolder.length + 1);
  if (!uid || !isSafeSegment(uid) || !relativeDir.split('/').every(isSafeSegment)) {
    throw new Error('Unsafe duplicate conflict path');
  }
  return `${rootFolder}/重复冲突/${uid}/${relativeDir}/${basename(file.path)}`;
}

function referencedLinks(cache: CachedMetadata): string[] {
  return [...(cache.embeds ?? []), ...(cache.links ?? [])]
    .map(link => link.link.trim())
    .filter(Boolean);
}

function isAdjacentAsset(assetPath: string, notePath: string): boolean {
  return assetPath.startsWith(`${dirname(notePath)}/asset/`);
}

function issue(
  result: DatePathMigrationResult,
  code: DatePathMigrationIssueCode,
  path: string,
  message: string,
  uid?: string,
): void {
  result.issues.push({
    code,
    path,
    ...(uid ? { uid } : {}),
    message,
  });
}

function block(
  candidate: NoteCandidate,
  result: DatePathMigrationResult,
  code: DatePathMigrationIssueCode,
  path: string,
  message: string,
): void {
  if (!candidate.skipped) {
    candidate.skipped = true;
    result.skipped++;
  }
  candidate.blocked = true;
  issue(result, code, path, message, candidate.uid);
}

function skipCandidate(
  candidate: NoteCandidate,
  result: DatePathMigrationResult,
  code: DatePathMigrationIssueCode,
  path: string,
  message: string,
): void {
  if (!candidate.skipped) {
    candidate.skipped = true;
    result.skipped++;
  }
  issue(result, code, path, message, candidate.uid);
}

interface LinkResolution {
  link: string;
  resolved: TFile | null;
}

function fileAtPath(app: MigrationApp, path: string): TFile | null {
  const candidate = app.vault.getAbstractFileByPath(path);
  return candidate
    && typeof candidate === 'object'
    && 'path' in candidate
    && 'extension' in candidate
    ? candidate as TFile
    : null;
}

function sourceAssetForLink(app: MigrationApp, file: TFile, link: string): TFile | null {
  if (!GENERATED_ASSET_PATTERN.test(link)) return null;
  const linkPath = link.split('#', 1)[0].replace(/^\.\//, '');
  if (!linkPath || !linkPath.split('/').every(isSafeSegment)) return null;
  for (const candidatePath of [
    `${dirname(file.path)}/${linkPath}`,
    `${dirname(file.path)}/${linkPath}.md`,
  ]) {
    const candidate = fileAtPath(app, candidatePath);
    if (candidate) return candidate;
  }
  return null;
}

function resolveLinks(
  app: MigrationApp,
  file: TFile,
  cache: CachedMetadata,
): LinkResolution[] {
  return referencedLinks(cache).map(link => ({
    link,
    resolved: app.metadataCache.getFirstLinkpathDest(link, file.path)
      ?? sourceAssetForLink(app, file, link),
  }));
}

function targetAssetForLink(
  app: MigrationApp,
  targetPath: string,
  link: string,
): TFile | null {
  const linkPath = link.split('#', 1)[0].replace(/^\.\//, '');
  const name = basename(linkPath);
  if (!name || !isSafeSegment(name)) return null;
  const targetAssetDir = `${dirname(targetPath)}/asset`;
  for (const candidatePath of [`${targetAssetDir}/${name}`, `${targetAssetDir}/${name}.md`]) {
    const candidate = fileAtPath(app, candidatePath);
    if (candidate) return candidate;
  }
  return null;
}

function uidSuffixedAssetForLink(
  app: MigrationApp,
  rootFolder: string,
  uid: string,
  link: string,
): TFile | null {
  const linkPath = link.split('#', 1)[0].replace(/^\.\//, '');
  const name = basename(linkPath);
  const suffixStart = name.lastIndexOf('_');
  if (!name || suffixStart < 1 || !isSafeSegment(uid)) return null;
  const suffix = name.slice(suffixStart);
  const suffixMatch = suffix.match(/^_(audio|transcript)(?:\.([^.]+))?$/i);
  if (!suffixMatch) return null;
  const suffixes = suffixMatch[2]
    ? [suffix]
    : suffixMatch[1].toLowerCase() === 'audio'
      ? [suffix, `${suffix}.mp3`]
      : [suffix, `${suffix}.md`];

  const matches = app.vault.getFiles().filter(file => (
    file.path.startsWith(`${rootFolder}/`)
    && file.path.includes('/asset/')
    && suffixes.some(candidateSuffix => file.name.endsWith(`_${uid}${candidateSuffix}`))
  ));
  return matches.length === 1 ? matches[0] : null;
}

function uniquelyNamedAssetForLink(
  app: MigrationApp,
  rootFolder: string,
  targetPath: string,
  link: string,
): TFile | null {
  if (!GENERATED_ASSET_PATTERN.test(link)) return null;
  const linkPath = link.split('#', 1)[0].replace(/^\.\//, '');
  const name = basename(linkPath);
  if (!name || !isSafeSegment(name)) return null;
  const matches = app.vault.getFiles().filter(file => (
    file.path.startsWith(`${rootFolder}/`)
    && file.path.includes('/asset/')
    && !file.path.startsWith(`${rootFolder}/重复冲突/`)
    && file.path !== `${dirname(targetPath)}/asset/${name}`
    && file.name === name
  ));
  return matches.length === 1 ? matches[0] : null;
}

function planCandidateAssets(
  app: MigrationApp,
  rootFolder: string,
  candidate: NoteCandidate,
  links: LinkResolution[],
  result: DatePathMigrationResult,
  evidence: Record<string, DatePathAssetMoveEvidence>,
): void {
  const targetPath = candidate.targetPath;
  if (!targetPath) return;

  const assets = new Map<string, PlannedMove>();
  for (const { link, resolved } of links) {
    if (resolved && isAdjacentAsset(resolved.path, candidate.file.path)) {
      const targetAssetPath = `${dirname(targetPath)}/asset/${basename(resolved.path)}`;
      candidate.assetClaims.add(resolved.path);
      assets.set(targetAssetPath, {
        file: resolved,
        sourcePath: resolved.path,
        targetPath: targetAssetPath,
      });
      continue;
    }

    const nameRecovered = uniquelyNamedAssetForLink(app, rootFolder, targetPath, link);
    if (nameRecovered) {
      const targetAssetPath = `${dirname(targetPath)}/asset/${basename(nameRecovered.path)}`;
      candidate.assetClaims.add(nameRecovered.path);
      assets.set(targetAssetPath, {
        file: nameRecovered,
        sourcePath: nameRecovered.path,
        targetPath: targetAssetPath,
      });
      continue;
    }

    const uidRecovered = candidate.uid
      ? uidSuffixedAssetForLink(app, rootFolder, candidate.uid, link)
      : null;
    if (uidRecovered) {
      const targetAssetPath = `${dirname(targetPath)}/asset/${basename(uidRecovered.path)}`;
      candidate.assetClaims.add(uidRecovered.path);
      assets.set(targetAssetPath, {
        file: uidRecovered,
        sourcePath: uidRecovered.path,
        targetPath: targetAssetPath,
      });
      continue;
    }

    const recovered = (
      resolved && isAdjacentAsset(resolved.path, targetPath)
        ? resolved
        : GENERATED_ASSET_PATTERN.test(link)
          ? targetAssetForLink(app, targetPath, link)
          : null
    );
    if (recovered) {
      const logicalSource = `${dirname(candidate.file.path)}/asset/${basename(recovered.path)}`;
      const recorded = evidence[recovered.path];
      if (
        !candidate.uid
        || recorded?.uid !== candidate.uid
        || recorded.sourcePath !== logicalSource
        || recorded.targetPath !== recovered.path
      ) {
        skipCandidate(
          candidate,
          result,
          'target-conflict',
          recovered.path,
          `Target asset has no matching migration evidence: ${recovered.path}`,
        );
        continue;
      }
      candidate.assetClaims.add(logicalSource);
      assets.set(recovered.path, {
        file: recovered,
        sourcePath: recovered.path,
        targetPath: recovered.path,
      });
      continue;
    }

    if (GENERATED_ASSET_PATTERN.test(link)) {
      skipCandidate(
        candidate,
        result,
        'missing-generated-asset',
        candidate.file.path,
        `Generated asset cannot be resolved: ${link}`,
      );
    }
  }
  candidate.assets = [...assets.values()]
    .sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}

async function ensureFolder(app: MigrationApp, folderPath: string): Promise<void> {
  if (!app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }
}

async function removeEmptySubfolders(app: MigrationApp, rootFolder: string): Promise<void> {
  const folders = app.vault.getAllFolders()
    .filter(folder => folder.path.startsWith(`${rootFolder}/`))
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
  for (const folder of folders) {
    const hasFiles = app.vault.getFiles().some(file => file.path.startsWith(`${folder.path}/`));
    const hasFolders = app.vault.getAllFolders().some(other => (
      other.path !== folder.path && other.path.startsWith(`${folder.path}/`)
    ));
    if (!hasFiles && !hasFolders) await app.vault.delete(folder, true);
  }
}

function unclaimedAssetPlans(
  app: MigrationApp,
  rootFolder: string,
  candidates: NoteCandidate[],
  result: DatePathMigrationResult,
): PlannedMove[] {
  const claimedPaths = new Set<string>();
  for (const candidate of candidates) {
    for (const path of candidate.assetClaims) claimedPaths.add(path);
    for (const asset of candidate.assets) {
      claimedPaths.add(asset.sourcePath);
      claimedPaths.add(asset.targetPath);
    }
  }

  const archiveRoot = `${rootFolder}/未归属附件/`;
  const plans: PlannedMove[] = [];
  for (const file of app.vault.getFiles()) {
    if (
      !file.path.startsWith(`${rootFolder}/`)
      || !file.path.includes('/asset/')
      || file.path.startsWith(`${rootFolder}/重复冲突/`)
      || file.path.startsWith(archiveRoot)
      || claimedPaths.has(file.path)
    ) continue;

    const relativeDir = dirname(file.path).slice(rootFolder.length + 1);
    if (!relativeDir || !relativeDir.split('/').every(isSafeSegment)) continue;
    const targetPath = `${archiveRoot}${relativeDir}/${basename(file.path)}`;
    if (app.vault.getAbstractFileByPath(targetPath)) {
      issue(result, 'target-conflict', targetPath, `Unclaimed asset archive target already exists: ${targetPath}`);
      continue;
    }
    plans.push({ file, sourcePath: file.path, targetPath });
  }
  return plans.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

async function executeUnclaimedAssetPlan(
  app: MigrationApp,
  plan: PlannedMove,
  result: DatePathMigrationResult,
): Promise<void> {
  try {
    await ensureFolder(app, dirname(plan.targetPath));
    await app.fileManager.renameFile(plan.file, plan.targetPath);
  } catch (error) {
    result.failed++;
    issue(
      result,
      'rename-failed',
      plan.sourcePath,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function preflightPlans(
  app: MigrationApp,
  candidates: NoteCandidate[],
  result: DatePathMigrationResult,
  context: DatePathMigrationContext,
): void {
  const uidOwners = new Map<string, Set<NoteCandidate>>();
  const assetOwners = new Map<string, Set<NoteCandidate>>();
  const targetOwners = new Map<string, Set<NoteCandidate>>();

  for (const candidate of candidates) {
    if (candidate.uid) {
      const uidCandidates = uidOwners.get(candidate.uid) ?? new Set();
      uidCandidates.add(candidate);
      uidOwners.set(candidate.uid, uidCandidates);
    }

    for (const assetPath of candidate.assetClaims) {
      const owners = assetOwners.get(assetPath) ?? new Set();
      owners.add(candidate);
      assetOwners.set(assetPath, owners);
    }

    if (!candidate.targetPath) continue;
    const moves = [
      ...candidate.assets,
      { file: candidate.file, sourcePath: candidate.file.path, targetPath: candidate.targetPath },
    ];
    for (const move of moves) {
      const owners = targetOwners.get(move.targetPath) ?? new Set();
      owners.add(candidate);
      targetOwners.set(move.targetPath, owners);

      if (move.sourcePath !== move.targetPath && app.vault.getAbstractFileByPath(move.targetPath)) {
        block(
          candidate,
          result,
          'target-conflict',
          move.targetPath,
          `Target already exists: ${move.targetPath}`,
        );
      }
    }
  }

  for (const [uid, owners] of uidOwners) {
    if (owners.size < 2) continue;
    if (context.rebuildCategories) continue;
    for (const owner of owners) {
      block(owner, result, 'duplicate-uid', owner.file.path, `UID appears in multiple notes: ${uid}`);
    }
  }

  for (const [assetPath, owners] of assetOwners) {
    if (owners.size < 2) continue;
    for (const owner of owners) {
      if (owner.pluginOwned) {
        block(owner, result, 'shared-asset', assetPath, `Asset is referenced by multiple notes: ${assetPath}`);
      }
    }
  }

  for (const [targetPath, owners] of targetOwners) {
    if (owners.size < 2) continue;
    for (const owner of owners) {
      block(owner, result, 'target-conflict', targetPath, `Multiple notes target the same path: ${targetPath}`);
    }
  }
}

function modifiedTimestamp(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function resolveDuplicateUids(
  app: MigrationApp,
  rootFolder: string,
  candidates: NoteCandidate[],
  result: DatePathMigrationResult,
  context: DatePathMigrationContext,
): Promise<void> {
  if (!context.rebuildCategories) return;
  const byUid = new Map<string, NoteCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.pluginOwned || candidate.skipped || !candidate.uid) continue;
    const group = byUid.get(candidate.uid) ?? [];
    group.push(candidate);
    byUid.set(candidate.uid, group);
  }

  for (const [uid, group] of byUid) {
    if (group.length < 2) continue;
    const contentLengths = new Map<NoteCandidate, number>();
    await Promise.all(group.map(async candidate => {
      contentLengths.set(candidate, (await app.vault.read(candidate.file)).length);
    }));
    group.sort((left, right) => (
      modifiedTimestamp(right.modified) - modifiedTimestamp(left.modified)
      || (contentLengths.get(right) ?? 0) - (contentLengths.get(left) ?? 0)
      || left.file.path.localeCompare(right.file.path)
    ));
    const keeperAssetPaths = new Set(group[0].assets.map(asset => asset.sourcePath));
    for (const candidate of group.slice(1)) {
      try {
        candidate.targetPath = desiredConflictPath(candidate.file, rootFolder, uid);
        candidate.assets = [];
        candidate.assetClaims.clear();
        planCandidateAssets(app, rootFolder, candidate, candidate.links, result, context.assetMoveEvidence);
        candidate.assets = candidate.assets.filter(asset => !keeperAssetPaths.has(asset.sourcePath));
        for (const assetPath of keeperAssetPaths) candidate.assetClaims.delete(assetPath);
      } catch (error) {
        skipCandidate(
          candidate,
          result,
          'unsafe-path',
          candidate.file.path,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

async function executePlan(
  app: MigrationApp,
  plan: NoteCandidate & { uid: string; targetPath: string },
  result: DatePathMigrationResult,
): Promise<void> {
  const moves = [
    ...plan.assets.filter(asset => asset.sourcePath !== asset.targetPath),
    ...(plan.file.path === plan.targetPath
      ? []
      : [{ file: plan.file, sourcePath: plan.file.path, targetPath: plan.targetPath }]),
  ];
  if (moves.length === 0) {
    result.unchanged++;
    return;
  }

  const completed: PlannedMove[] = [];
  try {
    await ensureFolder(app, dirname(plan.targetPath));
    if (plan.assets.some(asset => asset.sourcePath !== asset.targetPath)) {
      await ensureFolder(app, `${dirname(plan.targetPath)}/asset`);
    }
    for (const move of moves) {
      await app.fileManager.renameFile(move.file, move.targetPath);
      completed.push(move);
    }
    result.moved++;
  } catch (error) {
    result.failed++;
    issue(
      result,
      'rename-failed',
      plan.file.path,
      error instanceof Error ? error.message : String(error),
      plan.uid,
    );
    for (const move of completed.reverse()) {
      try {
        await app.fileManager.renameFile(move.file, move.sourcePath);
      } catch (rollbackError) {
        issue(
          result,
          'rollback-failed',
          move.targetPath,
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          plan.uid,
        );
      }
    }
  }
}

/**
 * Reorganize plugin-owned local notes without reading remote data or mutating
 * note contents. All planning and conflict checks finish before any rename.
 */
export async function migrateDatePaths(
  app: MigrationApp,
  rootFolder: string,
  target: DatePathMigrationTarget,
  context: DatePathMigrationContext,
): Promise<DatePathMigrationResult> {
  const result: DatePathMigrationResult = {
    scanned: 0,
    planned: 0,
    moved: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    issues: [],
  };
  const root = rootFolder.trim();
  if (root !== rootFolder || !root.split('/').every(isSafeSegment)) {
    throw new Error(`Unsafe root folder: ${rootFolder}`);
  }

  const allMarkdownFiles = app.vault.getMarkdownFiles();
  const files = allMarkdownFiles
    .filter(file => isInsideRoot(file.path, root))
    .sort((left, right) => left.path.localeCompare(right.path));
  const candidates: NoteCandidate[] = [];
  const nextCategoryOrigins = { ...context.categoryOrigins };
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const links = resolveLinks(app, file, cache ?? {});
    const candidate: NoteCandidate = {
      file,
      links,
      pluginOwned: false,
      assets: [],
      assetClaims: new Set(
        links
          .map(link => link.resolved)
          .filter((asset): asset is TFile => Boolean(asset && isAdjacentAsset(asset.path, file.path)))
          .map(asset => asset.path),
      ),
      blocked: false,
      skipped: false,
    };
    candidates.push(candidate);
    if (isArchivedSyncNote(await app.vault.read(file))) continue;

    const source = readRequiredString(cache?.frontmatter, 'source');
    if (!source || !PLUGIN_SOURCES.has(source)) {
      continue;
    }
    candidate.pluginOwned = true;
    result.scanned++;

    let uid = readRequiredString(cache?.frontmatter, 'uid');
    if (!uid && typeof cache?.frontmatter?.uid === 'number') {
      uid = await readLegacyNumericUid(app, file);
    }
    const created = readRequiredString(cache?.frontmatter, 'created');
    const noteType = readRequiredString(cache?.frontmatter, 'note_type');
    const modified = typeof cache?.frontmatter?.modified === 'string'
      ? cache.frontmatter.modified.trim()
      : undefined;
    if (uid) candidate.uid = uid;
    candidate.modified = modified;

    if (!uid || !created || !noteType) {
      skipCandidate(
        candidate,
        result,
        'invalid-metadata',
        file.path,
        'Required string metadata is missing',
      );
      continue;
    }

    try {
      const category = context.rebuildCategories
        ? getCategoryDir(noteType)
        : existingCategoryDir(file.path, root, created, uid, context)
          ?? getCategoryDir(noteType);
      candidate.category = category;
      candidate.targetPath = desiredNotePath(file, root, created, category, target);
    } catch (error) {
      skipCandidate(
        candidate,
        result,
        'unsafe-path',
        file.path,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    planCandidateAssets(app, root, candidate, links, result, context.assetMoveEvidence);
  }

  await resolveDuplicateUids(app, root, candidates, result, context);
  for (const candidate of candidates) {
    if (candidate.pluginOwned && !candidate.skipped && candidate.uid && candidate.category) {
      nextCategoryOrigins[candidate.uid] = { path: candidate.file.path, category: candidate.category };
    }
  }
  preflightPlans(app, candidates, result, context);
  const unclaimedAssets = context.rebuildCategories
    ? unclaimedAssetPlans(app, root, candidates, result)
    : [];
  result.planned = candidates.filter(candidate => (
    candidate.pluginOwned
    && !candidate.skipped
    && !candidate.blocked
    && Boolean(candidate.uid)
    && Boolean(candidate.targetPath)
    && (candidate.file.path !== candidate.targetPath
      || candidate.assets.some(asset => asset.sourcePath !== asset.targetPath))
  )).length;

  if (context.dryRun) return result;

  const nextAssetMoveEvidence = { ...context.assetMoveEvidence };
  for (const candidate of candidates) {
    if (!candidate.pluginOwned || candidate.skipped || candidate.blocked || !candidate.uid) continue;
    for (const asset of candidate.assets) {
      if (asset.sourcePath === asset.targetPath) continue;
      nextAssetMoveEvidence[asset.targetPath] = {
        uid: candidate.uid,
        sourcePath: asset.sourcePath,
        targetPath: asset.targetPath,
      };
    }
  }
  await context.beforeExecute(nextCategoryOrigins, nextAssetMoveEvidence);
  for (const candidate of candidates) {
    if (
      !candidate.skipped
      && candidate.pluginOwned
      && candidate.uid
      && candidate.targetPath
    ) {
      await executePlan(
        app,
        candidate as NoteCandidate & { uid: string; targetPath: string },
        result,
      );
    }
  }
  for (const asset of unclaimedAssets) {
    await executeUnclaimedAssetPlan(app, asset, result);
  }
  if (context.rebuildCategories && result.failed === 0) {
    await removeEmptySubfolders(app, root);
  }
  return result;
}
