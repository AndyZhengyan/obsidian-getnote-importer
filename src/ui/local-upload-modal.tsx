import type { TFile } from 'obsidian';
import { useMemo, useState } from 'preact/hooks';
import { t } from '../i18n';

interface LocalUploadModalProps {
  files: TFile[];
  initialFolder: string;
  onConfirm: (files: TFile[]) => void;
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

export function LocalUploadModal({ files, initialFolder, onConfirm, onCancel }: LocalUploadModalProps) {
  const folders = useMemo(() => folderOptions(files, initialFolder), [files, initialFolder]);
  const [folder, setFolder] = useState(cleanFolder(initialFolder) || folders[0] || '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const visibleFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return files
      .filter(file => isInsideFolder(file, folder))
      .filter(file => !normalizedQuery || relativePath(file, folder).toLowerCase().includes(normalizedQuery))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [files, folder, query]);

  const selectedFiles = files.filter(file => selected.has(file.path));
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
        <div className="getnote-local-upload-folder">
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
        </div>
        <div className="getnote-picker-actions">
          <button onClick={selectVisible}>{t('picker.selectAll')}</button>
          <button onClick={selectNone}>{t('picker.selectNone')}</button>
        </div>
      </div>
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
          <button className="mod-cta" disabled={selectedFiles.length === 0} onClick={() => onConfirm(selectedFiles)}>{t('upload.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
