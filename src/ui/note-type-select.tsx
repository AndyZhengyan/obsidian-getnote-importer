import { useState } from 'preact/hooks';
import { NOTE_CATEGORIES } from '../types';
import { t } from '../i18n';

const NOTE_TYPE_OPTIONS = NOTE_CATEGORIES.filter((category, index, categories) =>
  categories.findIndex(item => item.noteType === category.noteType) === index
);

function getTypeLabel(noteType: string): string {
  return t(`picker.type.${noteType}`);
}

function summarizeTypes(value: string[]): string {
  if (value.length === 0) return t('noteTypes.all');
  if (value.length === 1) return getTypeLabel(value[0]);
  return t('noteTypes.selected', { count: value.length });
}

interface NoteTypeSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
}

export function NoteTypeSelect({ value, onChange }: NoteTypeSelectProps) {
  const [open, setOpen] = useState(false);
  const allNoteTypes = NOTE_TYPE_OPTIONS.map(option => option.noteType);

  const handleTypeToggle = (noteType: string, checked: boolean) => {
    const current = value.length > 0 ? value : allNoteTypes;
    const next = checked
      ? Array.from(new Set([...current, noteType]))
      : current.filter(type => type !== noteType);

    if (next.length === 0) {
      onChange([noteType]);
      return;
    }
    onChange(next.length === allNoteTypes.length ? [] : next);
  };

  return (
    <div className="getnote-note-type-select">
      <button
        type="button"
        className="getnote-note-type-select-trigger"
        onClick={() => setOpen(value => !value)}
      >
        <span>{summarizeTypes(value)}</span>
        <span
          aria-hidden="true"
          className={`getnote-note-type-select-caret${open ? ' is-open' : ''}`}
        />
      </button>
      {open && (
        <div className="getnote-note-type-select-menu">
          <label className="getnote-note-type-select-option">
            <input
              type="checkbox"
              checked={value.length === 0}
              onChange={() => onChange([])}
            />
            <span>{t('noteTypes.all')}</span>
          </label>
          {NOTE_TYPE_OPTIONS.map(option => (
            <label className="getnote-note-type-select-option" key={option.noteType}>
              <input
                type="checkbox"
                checked={value.length === 0 || value.includes(option.noteType)}
                onChange={(event) => handleTypeToggle(option.noteType, (event.target as HTMLInputElement).checked)}
              />
              <span>{getTypeLabel(option.noteType)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
