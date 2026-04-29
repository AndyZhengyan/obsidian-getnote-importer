import { useState, useEffect } from 'preact/hooks';
import type { GetNoteNote } from '../types';
import { fetchNotes } from '../api';

interface NotePickerModalProps {
  onConfirm: (selectedNoteIds: string[]) => void;
  onCancel: () => void;
  token: string;
  clientId: string;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return '昨天';
  } else {
    return `${diffDays}天前`;
  }
}

function getTypeLabel(noteType: string): string {
  const map: Record<string, string> = {
    plain_text: '纯文本',
    link: '链接笔记',
    recorder_audio: '录音长录',
    recorder_flash_audio: '录音长录',
    immediate_audio: '即时录音',
    audio_long: '录音长录',
    local_audio: '本地音频',
  };
  return map[noteType] || noteType;
}

function NoteRow({ note, checked, onChange }: { note: GetNoteNote; checked: boolean; onChange: (id: string, v: boolean) => void }) {
  const title = note.title?.trim() ||
    note.content.slice(0, 20).replace(/\n/g, ' ') + (note.content.length > 20 ? '...' : '');
  return (
    <div className="getnote-picker-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(note.note_id, (e.target as HTMLInputElement).checked)}
      />
      <div className="getnote-picker-row-info">
        <div className="getnote-picker-title">{title}</div>
        <div className="getnote-picker-meta">
          <span className="getnote-picker-type">{getTypeLabel(note.note_type)}</span>
          <span className="getnote-picker-time">{formatRelativeTime(note.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function NotePickerModal({ token, clientId, onConfirm, onCancel }: NotePickerModalProps) {
  const [notes, setNotes] = useState<GetNoteNote[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNotes({ token, clientId, sinceId: '0', limit: 50 })
      .then(({ notes }) => { setNotes(notes); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : '加载失败'); setLoading(false); });
  }, []);

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

  const handleSelectAll = () => setSelected(new Set(notes.map(n => n.note_id)));
  const handleSelectNone = () => setSelected(new Set());
  const handleConfirm = () => onConfirm(Array.from(selected));

  return (
    <div className="getnote-picker">
      <div className="getnote-picker-header">
        <span>选择要同步的笔记</span>
        <div className="getnote-picker-actions">
          <button onClick={handleSelectAll}>全选</button>
          <button onClick={handleSelectNone}>全不选</button>
        </div>
      </div>
      <div className="getnote-picker-body">
        {loading && <div className="getnote-picker-loading">正在获取笔记列表...</div>}
        {error && <div className="getnote-picker-error">{error} <button onClick={() => window.location.reload()}>重试</button></div>}
        {!loading && !error && notes.map(note => (
          <NoteRow key={note.note_id} note={note} checked={selected.has(note.note_id)} onChange={handleCheck} />
        ))}
        {!loading && !error && notes.length === 0 && <div className="getnote-picker-empty">暂无笔记</div>}
      </div>
      <div className="getnote-picker-footer">
        <span className="getnote-picker-count">已选 {selected.size} 条</span>
        <div className="getnote-picker-btns">
          <button className="mod-cancel" onClick={onCancel}>取消</button>
          <button className="mod-cta" disabled={selected.size === 0} onClick={handleConfirm}>同步</button>
        </div>
      </div>
    </div>
  );
}