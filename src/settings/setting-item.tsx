import { h } from 'preact';
import type { ComponentChildren } from 'preact';

interface SettingItemProps {
  name: string;
  description?: string;
  heading?: boolean;
  children: ComponentChildren;
}

export function SettingItem({ name, description, heading, children }: SettingItemProps) {
  return (
    <div className={`setting-item${heading ? ' setting-item-heading' : ''}`}>
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        {description && <div className="setting-item-description">{description}</div>}
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}
