import type { App, TFile } from 'obsidian';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { RecallSearchResult } from '../types';
import { t } from '../i18n';
import { formatNoteTypeLabel } from '../utils/note-type';
import { compactCardPreviewText } from './card-preview';

export interface SearchPanelProps {
  initialQuery?: string;
  autoSearchKey?: number;
  onSearch: (query: string, signal: AbortSignal) => Promise<RecallSearchResult[]>;
  resolveLocalFile: (noteId: string) => TFile | null;
  onOpenLocal: (file: TFile) => void | Promise<void>;
  onSyncNote: (noteId: string) => void | Promise<void>;
}

type SyncState = 'idle' | 'syncing' | 'done' | 'failed';

function formatSearchTime(result: RecallSearchResult): string {
  return result.updated_at || result.created_at || '';
}

export function findSyncedNoteFile(app: Pick<App, 'vault' | 'metadataCache'>, folderName: string, noteId: string): TFile | null {
  const prefix = `${folderName}/`;
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(prefix)) continue;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter?.['dedao_sync_archived'] === true) continue;
    const uid: unknown = frontmatter?.['uid'];
    if (String(uid ?? '') === noteId) return file;
  }
  return null;
}

export function SearchPanel({
  initialQuery = '',
  autoSearchKey,
  onSearch,
  resolveLocalFile,
  onOpenLocal,
  onSyncNote,
}: SearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<RecallSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<Record<string, SyncState>>({});
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (rawQuery: string) => {
    const nextQuery = rawQuery.trim();
    if (!nextQuery) {
      abortRef.current?.abort();
      setSearched(false);
      setResults([]);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setSearched(true);
    setError(null);
    setSyncState({});
    try {
      const nextResults = await onSearch(nextQuery, controller.signal);
      if (!controller.signal.aborted) {
        setResults(nextResults);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [onSearch]);

  useEffect(() => {
    setQuery(initialQuery);
    if (initialQuery.trim()) {
      void runSearch(initialQuery);
    }
    return () => abortRef.current?.abort();
  }, [autoSearchKey, initialQuery, runSearch]);

  const handleSync = async (noteId: string) => {
    setSyncState(prev => ({ ...prev, [noteId]: 'syncing' }));
    try {
      await onSyncNote(noteId);
      setSyncState(prev => ({ ...prev, [noteId]: 'done' }));
    } catch {
      setSyncState(prev => ({ ...prev, [noteId]: 'failed' }));
    }
  };

  return (
    <div className="getnote-search-view">
      <form
        className="getnote-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(query);
        }}
      >
        <input
          className="getnote-search-input"
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          className="mod-cta getnote-search-submit"
          disabled={loading}
          onClick={() => void runSearch(query)}
        >
          {loading ? t('search.searching') : t('search.submit')}
        </button>
      </form>

      {!searched && !loading && !error && (
        <div className="getnote-search-empty">{t('search.emptyHint')}</div>
      )}

      {error && (
        <div className="getnote-search-error">{error}</div>
      )}

      {searched && !loading && !error && results.length === 0 && (
        <div className="getnote-search-empty">{t('search.noResults')}</div>
      )}

      {results.length > 0 && (
        <div className="getnote-search-results">
          {results.map(result => {
            const localFile = resolveLocalFile(result.note_id);
            const state = syncState[result.note_id] ?? 'idle';
            const preview = compactCardPreviewText(result.content);
            return (
              <div className="getnote-note-card getnote-search-note-card" key={result.note_id}>
                <div className="getnote-note-card-body">
                  <div className="getnote-note-card-header">
                    <div className="getnote-note-card-title">{result.title || t('picker.noTitle')}</div>
                    <span className="getnote-note-card-type">{formatNoteTypeLabel(result.note_type)}</span>
                  </div>
                  {preview && <div className="getnote-note-card-preview">{preview}</div>}
                  <div className="getnote-note-card-footer">
                    <span className="getnote-note-card-time">{formatSearchTime(result)}</span>
                    {typeof result.score === 'number' && <span className="getnote-search-score">{Math.round(result.score * 100)}%</span>}
                  </div>
                  <div className="getnote-search-result-actions">
                    {localFile ? (
                      <button type="button" onClick={() => void onOpenLocal(localFile)}>
                        {t('search.openLocal')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={state === 'syncing'}
                        onClick={() => void handleSync(result.note_id)}
                      >
                        {state === 'syncing' ? t('search.syncing') : t('search.syncLocal')}
                      </button>
                    )}
                    {state === 'done' && <span className="getnote-search-result-status">{t('search.synced')}</span>}
                    {state === 'failed' && <span className="getnote-search-result-status getnote-search-result-status-error">{t('search.syncFailed')}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
