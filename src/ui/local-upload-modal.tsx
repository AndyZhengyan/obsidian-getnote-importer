import { insideSyncFolder } from '../bidirectional-sync';
import type { TFile } from 'obsidian';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from '../i18n';
import type { UploadDestination } from '../reverse-sync';
import type { SubscribedTopic } from '../types';

interface LocalUploadModalProps {
  files: TFile[];
  initialFolder: string;
  syncFolder?: string;
  loadTopics: (signal: AbortSignal) => Promise<SubscribedTopic[]>;
  onConfirm: (files: TFile[], destination?: UploadDestination) => void;
  onCancel: () => void;
}

function cleanFolder(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function parentFolder(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
}

function isInsideFolder(file: TFile, folder: string): boolean {
  const clean = cleanFolder(folder);
  if (!clean) return true;
  return file.path.startsWith(`${clean}/`);
}

function relativePath(file: TFile, folder: string): string {
  const clean = cleanFolder(folder);
  return clean && file.path.startsWith(`${clean}/`) ? file.path.slice(clean.length + 1) : file.path;
}

function folderOptions(files: TFile[], initialFolder: string): string[] {
  const options = new Set<string>();
  const initial = cleanFolder(initialFolder);
  options.add(initial);
  for (const file of files) {
    const parent = parentFolder(file.path);
    if (parent) {
      const parts = parent.split('/');
      for (let i = 1; i <= parts.length; i++) {
        options.add(parts.slice(0, i).join('/'));
      }
    }
  }
  return Array.from(options).sort((a, b) => {
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
}

export function LocalUploadModal({ files, initialFolder, syncFolder = initialFolder, loadTopics, onConfirm, onCancel }: LocalUploadModalProps) {
  const folders = useMemo(() => folderOptions(files, initialFolder), [files, initialFolder]);
  const [folder, setFolder] = useState(cleanFolder(initialFolder) || folders[0] || '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [topicId, setTopicId] = useState('');
  const [topics, setTopics] = useState<SubscribedTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setTopicsLoading(true);
    setTopicsError('');
    void loadTopics(controller.signal).then(result => {
      if (!controller.signal.aborted) setTopics(result.filter(topic => topic.source === 'created'));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setTopicsError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setTopicsLoading(false);
    });
    return () => controller.abort();
  }, [loadTopics, loadAttempt]);

  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files
      .filter(file => isInsideFolder(file, folder))
      .filter(file => !normalizedQuery || relativePath(file, folder).toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [files, folder, query]);

  const selectedFiles = files.filter(file => selected.has(file.path));
  const selectedTopic = topics.find(topic => topic.topic_id === topicId);
  const handleCheck = (path: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  };

  const selectVisible = () => setSelected(prev => {
    const next = new Set(prev);
    for (const file of visibleFiles) next.add(file.path);
    return next;
  });
  const selectNone = () => setSelected(new Set());

  return (
    <div className="getnote-local-upload">
      <div className="getnote-picker-header">
        <label className="getnote-local-upload-folder">
          <span>{t('upload.folder')}</span>
          <select
            value={folder}
            onChange={(e) => {
              setFolder((e.target as HTMLSelectElement).value);
              setSelected(new Set());
            }}
          >
            {folders.map(item => <option key={item || '__root__'} value={item}>{item || '/'}</option>)}
          </select>
        </label>
        <div className="getnote-picker-actions">
          <button onClick={selectVisible}>{t('picker.selectAll')}</button>
          <button onClick={selectNone}>{t('picker.selectNone')}</button>
        </div>
      </div>
      <div className="getnote-local-upload-destination">
        <label className="getnote-local-upload-folder">
          <span>{t('upload.destination')}</span>
          <select
            value={topicId}
            disabled={topicsLoading || topics.length === 0}
            onChange={event => setTopicId((event.target as HTMLSelectElement).value)}
          >
            <option value="">{t('upload.destinationDefault')}</option>
            {topics.map(topic => <option key={topic.topic_id} value={topic.topic_id}>{topic.name || topic.topic_id}</option>)}
          </select>
        </label>
        {topicsLoading && <div role="status">{t('knowledgeBases.loading')}</div>}
        {topicsError && (
          <div role="status">
            {topicsError} <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>{t('topicPicker.retry')}</button>
          </div>
        )}
        {!topicsLoading && !topicsError && topics.length === 0 && <div role="status">{t('upload.destinationEmpty')}</div>}
      </div>
      {!insideSyncFolder(`${cleanFolder(folder)}/note.md`, syncFolder) && (
        <p role="note">{t('bidirectional.uploadWarning', { folder: syncFolder })}</p>
      )}
      <div className="getnote-picker-body">
        <div className="getnote-picker-search">
          <input
            type="text"
            className="getnote-input"
            placeholder={t('upload.search')}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
        {visibleFiles.map(file => (
          <label key={file.path} className="getnote-picker-row">
            <input
              type="checkbox"
              checked={selected.has(file.path)}
              onChange={(e) => handleCheck(file.path, (e.target as HTMLInputElement).checked)}
            />
            <div className="getnote-picker-row-info">
              <div className="getnote-picker-title">{relativePath(file, folder)}</div>
              <div className="getnote-picker-meta">{file.path}</div>
            </div>
          </label>
        ))}
        {visibleFiles.length === 0 && <div className="getnote-picker-empty">{t('upload.empty')}</div>}
      </div>
      <div className="getnote-picker-footer">
        <span className="getnote-picker-count">{t('upload.selected', { count: selectedFiles.length })}</span>
        <div className="getnote-picker-btns">
          <button className="mod-cancel" onClick={onCancel}>{t('picker.cancel')}</button>
          <button
            className="mod-cta"
            disabled={selectedFiles.length === 0}
            onClick={() => onConfirm(selectedFiles, selectedTopic ? {
              topicId: selectedTopic.topic_id,
              topicName: selectedTopic.name || selectedTopic.topic_id,
            } : undefined)}
          >{t('upload.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
