import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
}

/**
 * Renders an Obsidian-style toggle switch.
 *
 * The markup mirrors the DOM produced by Obsidian's native
 * `ToggleComponent` (`<div class="checkbox-container"><input type="checkbox" .../></div>`)
 * which Obsidian's own app.css styles as a switch. Rendering the markup
 * directly in Preact keeps the test environment synchronous and avoids
 * relying on the imperative Obsidian constructor inside a `useEffect`.
 *
 * In the production Obsidian runtime, the same DOM is also produced by
 * `new ToggleComponent(hostEl)`; here we just inline the resulting
 * structure so the visual treatment stays identical.
 */
export function Toggle({ value, onChange, ariaLabel, disabled, title }: ToggleProps) {
  const [currentValue, setCurrentValue] = useState(value);
  const currentValueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useLayoutEffect(() => {
    currentValueRef.current = value;
    setCurrentValue(value);
  }, [value]);

  const applyValue = (next: boolean) => {
    currentValueRef.current = next;
    setCurrentValue(next);
    onChangeRef.current(next);
  };

  const handleChange = (event: Event) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    applyValue((event.target as HTMLInputElement).checked);
  };

  const handleContainerClick = (event: MouseEvent) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    applyValue(!currentValueRef.current);
  };

  return (
    <div
      className={`checkbox-container${currentValue ? ' is-enabled' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={handleContainerClick}
      aria-disabled={disabled}
      title={title}
    >
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={currentValue}
        disabled={disabled}
        onChange={handleChange}
      />
    </div>
  );
}
