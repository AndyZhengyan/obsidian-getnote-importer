import { useState, useEffect, useCallback } from 'preact/hooks';
import type { GetNoteNote } from '../types';
import { fetchNotes, GETNOTE_LIST_LIMIT } from '../api';
import { generateDisplayTitle } from '../note-parser';
import { t } from '../i18n';

interface NotePickerModalProps {
  onConfirm: (selectedNoteIds: string[]) => void;
  onCancel: () => void;
  token: string;
  clientId: string;
  abortSignal?: AbortSignal;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return t('picker.yesterday');
  } else {
    return `${diffDays}${t('picker.daysAgo')}`;
  }
}

function getTypeLabel(noteType: string): string {
  const key = `picker.type.${noteType}` as const;
  return t(key);
}

function NoteRow({ note, checked, onChange }: { note: GetNoteNote; checked: boolean; onChange: (id: string, v: boolean) => void }) {
  const title = generateDisplayTitle(note);
  const displayTitle = title || t('picker.noTitle');
  return (
    <div className="getnote-picker-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(note.note_id, (e.target as HTMLInputElement).checked)}
      />
      <div className="getnote-picker-row-info">
        <div className="getnote-picker-title">{displayTitle}</div>
        <div className="getnote-picker-meta">
          <span className="getnote-picker-type">{getTypeLabel(note.note_type)}</span>
          <span className="getnote-picker-time">{formatRelativeTime(note.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function NotePickerModal({ token, clientId, onConfirm, onCancel, abortSignal }: NotePickerModalProps) {
  const [notes, setNotes] = useState<GetNoteNote[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState('0');
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const loadFirstPage = useCallback(() => {
    setLoading(true);
    setError(null);
    setCursor('0');
    setHasMore(true);
    setNotes([]);
    (async () => {
      try {
        const result = await fetchNotes({ token, clientId, sinceId: '0', limit: GETNOTE_LIST_LIMIT, signal: abortSignal });
        setNotes(result.notes);
        setHasMore(result.hasMore);
        if (result.nextCursor) setCursor(result.nextCursor);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('picker.error'));
      } finally {
        setLoading(false);
      }
    })();
  }, [token, clientId, abortSignal]);

  useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

  const loadNextPage = async () => {
    setLoadingMore(true);
    try {
      const result = await fetchNotes({ token, clientId, sinceId: cursor, limit: GETNOTE_LIST_LIMIT, signal: abortSignal });
      setNotes(prev => [...prev, ...result.notes]);
      setHasMore(result.hasMore);
      if (result.nextCursor) setCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('picker.error'));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCheck = (noteId: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(noteId);
      } else {
        next.delete(noteId);
      }
      return next;
    });
  };

  const handleSelectAll = () => setSelected(new Set(filteredNotes.map(n => n.note_id)));
  const handleSelectNone = () => setSelected(new Set());
  const handleConfirm = () => onConfirm(Array.from(selected));

  const filteredNotes = searchQuery
    ? notes.filter(n => generateDisplayTitle(n).toLowerCase().includes(searchQuery.toLowerCase()))
    : notes;

  return (
    <div className="getnote-picker">
      <div className="getnote-picker-header">
        <div className="getnote-picker-actions">
          <button onClick={handleSelectAll}>{t('picker.selectAll')}</button>
          <button onClick={handleSelectNone}>{t('picker.selectNone')}</button>
        </div>
      </div>
      <div className="getnote-picker-body">
        {!loading && notes.length > 0 && (
          <div className="getnote-picker-search">
            <input
              type="text"
              className="getnote-input"
              placeholder={t('picker.search')}
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            />
          </div>
        )}
        {loading && (
          <div className="getnote-picker-skeleton">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="getnote-skeleton-row">
                <div className="getnote-skeleton-checkbox" />
                <div className="getnote-skeleton-lines">
                  <div className="getnote-skeleton-line" style="width:60%" />
                  <div className="getnote-skeleton-line" style="width:40%" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && !loading && <div className="getnote-picker-error">{error} <button onClick={loadFirstPage}>{t('picker.retry')}</button></div>}
        {!loading && !error && filteredNotes.map(note => (
          <NoteRow key={note.note_id} note={note} checked={selected.has(note.note_id)} onChange={handleCheck} />
        ))}
        {!loading && !error && !loadingMore && hasMore && notes.length > 0 && (
          <div className="getnote-picker-loadmore">
            <button className="mod-secondary" onClick={loadNextPage}>{t('picker.loadMore', { count: notes.length })}</button>
          </div>
        )}
        {!loading && loadingMore && <div className="getnote-picker-loading">{t('picker.loadingMore')}</div>}
        {!loading && !error && filteredNotes.length === 0 && notes.length > 0 && (
          <div className="getnote-picker-empty">{t('picker.noMatch')}</div>
        )}
        {!loading && !error && notes.length === 0 && <div className="getnote-picker-empty">{t('picker.empty')}</div>}
      </div>
      <div className="getnote-picker-footer">
        <span className="getnote-picker-count">{t('picker.selected', { count: selected.size })}</span>
        <div className="getnote-picker-btns">
          <button className="mod-cancel" onClick={onCancel}>{t('picker.cancel')}</button>
          <button className="mod-cta" disabled={selected.size === 0} onClick={handleConfirm}>{t('picker.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
