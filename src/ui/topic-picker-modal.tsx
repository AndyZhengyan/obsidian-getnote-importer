import { useState, useEffect, useCallback } from 'preact/hooks';
import type { AuthMode, SubscribedTopic } from '../types';
import { fetchSubscribedTopics } from '../api';
import { t } from '../i18n';

interface TopicPickerModalProps {
  onConfirm: (selectedTopicIds: string[]) => void;
  onCancel: () => void;
  token: string;
  clientId: string;
  authMode?: AuthMode;
  abortSignal?: AbortSignal;
}

export function TopicPickerModal({ token, clientId, authMode, onConfirm, onCancel, abortSignal }: TopicPickerModalProps) {
  const [topics, setTopics] = useState<SubscribedTopic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTopics = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await fetchSubscribedTopics({ token, clientId, authMode, signal: abortSignal });
        setTopics(result);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('topicPicker.error'));
      } finally {
        setLoading(false);
      }
    })();
  }, [token, clientId, authMode, abortSignal]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  const handleCheck = (topicId: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  };

  const handleSelectAll = () => setSelected(new Set(topics.map(t => t.topic_id)));
  const handleSelectNone = () => setSelected(new Set());

  return (
    <div className="getnote-picker">
      <div className="getnote-picker-header">
        <span className="getnote-picker-header-title">{t('topicPicker.title')}</span>
        <div className="getnote-picker-actions">
          <button onClick={handleSelectAll}>{t('picker.selectAll')}</button>
          <button onClick={handleSelectNone}>{t('picker.selectNone')}</button>
        </div>
      </div>
      <div className="getnote-picker-body">
        {loading && (
          <div className="getnote-picker-skeleton">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="getnote-skeleton-row">
                <div className="getnote-skeleton-checkbox" />
                <div className="getnote-skeleton-lines">
                  <div className="getnote-skeleton-line getnote-skeleton-line-primary" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && !loading && (
          <div className="getnote-picker-error">
            {error} <button onClick={loadTopics}>{t('topicPicker.retry')}</button>
          </div>
        )}
        {!loading && !error && topics.map(topic => (
          <div key={topic.topic_id} className="getnote-picker-row">
            <input
              type="checkbox"
              checked={selected.has(topic.topic_id)}
              onChange={(e) => handleCheck(topic.topic_id, (e.target as HTMLInputElement).checked)}
            />
            <div className="getnote-picker-row-info">
              <div className="getnote-picker-title">{topic.name || topic.topic_id}</div>
            </div>
          </div>
        ))}
        {!loading && !error && topics.length === 0 && (
          <div className="getnote-picker-empty">{t('topicPicker.empty')}</div>
        )}
      </div>
      <div className="getnote-picker-footer">
        <span className="getnote-picker-count">
          {t('topicPicker.selected', { count: selected.size })}
        </span>
        <div className="getnote-picker-btns">
          <button className="mod-cancel" onClick={onCancel}>{t('topicPicker.cancel')}</button>
          <button className="mod-cta" disabled={selected.size === 0} onClick={() => onConfirm(Array.from(selected))}>
            {t('topicPicker.confirm', { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
