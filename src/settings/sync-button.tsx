import { h } from 'preact';
import { useState } from 'preact/hooks';

interface SyncButtonProps {
  hasCredentials: boolean;
  isSyncing: boolean;
  onClick: () => void;
}

export function SyncButton({ hasCredentials, isSyncing, onClick }: SyncButtonProps) {
  const [hovered, setHovered] = useState(false);

  if (isSyncing) {
    return (
      <button className="mod-cta" disabled>
        🔄 同步中...
      </button>
    );
  }

  if (!hasCredentials) {
    return (
      <button className="mod-warning" disabled>
        请先填写 API Token 和 Client ID
      </button>
    );
  }

  return (
    <button
      className={`mod-cta${hovered ? ' is-hovered' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      ▶ 立即同步
    </button>
  );
}
