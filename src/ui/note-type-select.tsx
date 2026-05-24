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
  if (value.length === 0) return t('noteTypes.none');
  if (value.length === 1) return getTypeLabel(value[0]);
  return t('noteTypes.selected', { count: value.length });
}

interface NoteTypeSelectProps {
  value?: string[];
  onChange: (value: string[] | undefined) => void;
}

export function NoteTypeSelect({ value, onChange }: NoteTypeSelectProps) {
  const [open, setOpen] = useState(false);
  const allNoteTypes = NOTE_TYPE_OPTIONS.map(option => option.noteType);
  const selectedTypes = value ?? allNoteTypes;
  const allSelected = value === undefined || selectedTypes.length === allNoteTypes.length;

  const handleTypeToggle = (noteType: string, checked: boolean) => {
    const current = value ?? allNoteTypes;
    const next = checked
      ? Array.from(new Set([...current, noteType]))
      : current.filter(type => type !== noteType);

    onChange(next.length === allNoteTypes.length ? undefined : next);
  };

  return (
    <div className="getnote-note-type-select">
      <button
        type="button"
        className="getnote-note-type-select-trigger"
        onClick={() => setOpen(value => !value)}
      >
        <span>{value === undefined ? t('noteTypes.all') : summarizeTypes(value)}</span>
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
              checked={allSelected}
              onChange={(event) => onChange((event.target as HTMLInputElement).checked ? undefined : [])}
            />
            <span>{t('noteTypes.all')}</span>
          </label>
          {NOTE_TYPE_OPTIONS.map(option => (
            <label className="getnote-note-type-select-option" key={option.noteType}>
              <input
                type="checkbox"
                checked={selectedTypes.includes(option.noteType)}
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
