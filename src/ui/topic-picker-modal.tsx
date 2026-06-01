import { useState, useEffect, useCallback } from 'preact/hooks';
import type { AuthMode, SubscribedTopic } from '../types';
import type { ContentPreview, TopicContentPreviewCursor } from '../api';
import { fetchSubscribedTopics, fetchTopicContentPreviewPage } from '../api';
import { t } from '../i18n';

interface TopicData {
  topic: SubscribedTopic;
  contents: ContentPreview[];
  loading: boolean;
  loadingMore: boolean;
  nextCursor?: TopicContentPreviewCursor;
  error?: string;
}

interface TopicPickerModalProps {
  onConfirm: (selectedNoteIds: string[]) => void;
  onCancel: () => void;
  token: string;
  clientId: string;
  authMode?: AuthMode;
  abortSignal?: AbortSignal;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
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

function ContentRow({ item, checked, onChange }: { item: ContentPreview; checked: boolean; onChange: (noteId: string, v: boolean) => void }) {
  return (
    <div className="getnote-picker-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(item.note_id, (e.target as HTMLInputElement).checked)}
      />
      <div className="getnote-picker-row-info">
        <div className="getnote-picker-title">{item.title || t('picker.noTitle')}</div>
        <div className="getnote-picker-meta">
          {item.blogger_name && <span className="getnote-picker-type">{item.blogger_name}</span>}
          <span className="getnote-picker-time">{formatRelativeTime(item.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function TopicPickerModal({ token, clientId, authMode, onConfirm, onCancel, abortSignal }: TopicPickerModalProps) {
  const [topics, setTopics] = useState<SubscribedTopic[]>([]);
  const [topicData, setTopicData] = useState<Record<string, TopicData>>({});
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  const loadTopics = useCallback(() => {
    setTopicsLoading(true);
    setTopicsError(null);
    void (async () => {
      try {
        const result = await fetchSubscribedTopics({ token, clientId, authMode, signal: abortSignal });
        setTopics(result);
        const init: Record<string, TopicData> = {};
        for (const topic of result) {
          init[topic.topic_id] = { topic, contents: [], loading: false, loadingMore: false };
        }
        setTopicData(init);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTopicsError(err instanceof Error ? err.message : t('topicPicker.error'));
      } finally {
        setTopicsLoading(false);
      }
    })();
  }, [token, clientId, authMode, abortSignal]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  const loadTopicPage = async (topic: SubscribedTopic, cursor?: TopicContentPreviewCursor) => {
    const data = topicData[topic.topic_id];
    if (!data) return;
    const isLoadMore = Boolean(cursor);
    setTopicData(prev => ({
      ...prev,
      [topic.topic_id]: {
        ...prev[topic.topic_id],
        loading: !isLoadMore,
        loadingMore: isLoadMore,
        error: undefined,
      },
    }));
    try {
      const page = await fetchTopicContentPreviewPage(
        topic.topic_id,
        topic.name,
        token,
        clientId,
        authMode,
        abortSignal,
        cursor
      );
      setTopicData(prev => ({
        ...prev,
        [topic.topic_id]: {
          ...prev[topic.topic_id],
          contents: isLoadMore
            ? [...prev[topic.topic_id].contents, ...page.items]
            : page.items,
          loading: false,
          loadingMore: false,
          nextCursor: page.nextCursor,
        },
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setTopicData(prev => ({
        ...prev,
        [topic.topic_id]: {
          ...prev[topic.topic_id],
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const openTopic = async (topic: SubscribedTopic) => {
    setActiveTopicId(topic.topic_id);
    const data = topicData[topic.topic_id];
    if (!data || data.contents.length > 0) return;
    await loadTopicPage(topic);
  };

  const handleCheck = (noteId: string, checked: boolean) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(noteId);
      else next.delete(noteId);
      return next;
    });
  };

  const handleConfirm = () => onConfirm(Array.from(selectedNoteIds));

  const totalItems = Object.values(topicData).reduce((sum, d) => sum + d.contents.length, 0);
  const activeTopic = activeTopicId ? topicData[activeTopicId] : null;

  return (
    <div className="getnote-picker">
      <div className="getnote-picker-header">
        {activeTopic ? (
          <button className="getnote-topic-back" data-topic-back onClick={() => setActiveTopicId(null)}>
            <span aria-hidden="true">←</span>
            <span>{t('topicPicker.back')}</span>
          </button>
        ) : (
          <span className="getnote-picker-header-title">{t('topicPicker.title')}</span>
        )}
        {activeTopic && (
          <span className="getnote-picker-header-title">{activeTopic.topic.name || activeTopic.topic.topic_id}</span>
        )}
      </div>
      <div className="getnote-picker-body">
        {!activeTopic && topicsLoading && (
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
        {!activeTopic && topicsError && !topicsLoading && (
          <div className="getnote-picker-error">
            {topicsError} <button onClick={loadTopics}>{t('topicPicker.retry')}</button>
          </div>
        )}
        {!activeTopic && !topicsLoading && !topicsError && topics.map(topic => {
          const data = topicData[topic.topic_id];
          return (
            <button
              key={topic.topic_id}
              className="getnote-topic-row"
              data-topic-id={topic.topic_id}
              onClick={() => openTopic(topic)}
            >
              <span className="getnote-topic-name">{topic.name || topic.topic_id}</span>
              <span className="getnote-topic-row-meta">
                {data && data.contents.length > 0
                  ? t('topicPicker.loaded', { count: data.contents.length })
                  : t('topicPicker.chooseTopic')}
              </span>
              <span className="getnote-topic-arrow" aria-hidden="true">›</span>
            </button>
          );
        })}
        {!activeTopic && !topicsLoading && !topicsError && topics.length === 0 && (
          <div className="getnote-picker-empty">{t('topicPicker.empty')}</div>
        )}
        {activeTopic && activeTopic.loading && (
          <div className="getnote-picker-skeleton">
            {[1, 2, 3].map(i => (
              <div key={i} className="getnote-skeleton-row">
                <div className="getnote-skeleton-checkbox" />
                <div className="getnote-skeleton-lines">
                  <div className="getnote-skeleton-line getnote-skeleton-line-primary" />
                  <div className="getnote-skeleton-line getnote-skeleton-line-secondary" />
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTopic?.error && !activeTopic.loading && (
          <div className="getnote-picker-error">
            {activeTopic.error}{' '}
            <button onClick={() => openTopic(activeTopic.topic)}>{t('topicPicker.retry')}</button>
          </div>
        )}
        {activeTopic && !activeTopic.loading && !activeTopic.error && activeTopic.contents.length === 0 && (
          <div className="getnote-picker-empty">{t('topicPicker.emptyContent')}</div>
        )}
        {activeTopic && !activeTopic.loading && !activeTopic.error && activeTopic.contents.map(item => (
          <ContentRow key={item.note_id} item={item} checked={selectedNoteIds.has(item.note_id)} onChange={handleCheck} />
        ))}
        {activeTopic && !activeTopic.loading && !activeTopic.error && activeTopic.nextCursor && (
          <div className="getnote-picker-loadmore">
            <button
              data-topic-load-more
              disabled={activeTopic.loadingMore}
              onClick={() => loadTopicPage(activeTopic.topic, activeTopic.nextCursor)}
            >
              {activeTopic.loadingMore ? t('topicPicker.loadingMore') : t('topicPicker.loadMore')}
            </button>
          </div>
        )}
      </div>
      <div className="getnote-picker-footer">
        <span className="getnote-picker-count">
          {t('topicPicker.selected', { count: selectedNoteIds.size })}
          {totalItems > 0 && <span style="margin-left: 12px;">{t('topicPicker.loaded', { count: totalItems })}</span>}
        </span>
        <div className="getnote-picker-btns">
          <button className="mod-cancel" onClick={onCancel}>{t('topicPicker.cancel')}</button>
          <button className="mod-cta" disabled={selectedNoteIds.size === 0} onClick={handleConfirm}>
            {t('topicPicker.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
