import { useSyncExternalStore } from 'react';
import { Sun, Snowflake, Moon } from './icons';
import './theme.css';
import './interface-refinement.css';
import './mobile-refinement.css';
import './device-layout.css';
import './surface-rhythm.css';
import './alignment.css';

const key = 'elsewhere-appearance';
const themes = [
  { id: 'warm', label: '暖色', icon: Sun },
  { id: 'cool', label: '冷色', icon: Snowflake },
  { id: 'night', label: '夜间', icon: Moon },
] as const;
type Theme = (typeof themes)[number]['id'];
const valid = (value: string | null | undefined): value is Theme =>
  themes.some((theme) => theme.id === value);
function readTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return valid(value) ? value : 'warm';
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event('elsewhere-appearance-change'));
}
function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null)
      applyTheme(valid(event.newValue) ? event.newValue : 'warm');
  };
  window.addEventListener('elsewhere-appearance-change', notify);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener('elsewhere-appearance-change', notify);
    window.removeEventListener('storage', storage);
  };
}
export function ThemeSwitcher({ floating = false }: { floating?: boolean }) {
  const theme = useSyncExternalStore(subscribe, readTheme);
  return (
    <fieldset
      className={'ew-theme-switch' + (floating ? ' ew-theme-floating' : '')}
      aria-label="界面配色"
    >
      {themes.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={theme === id}
          data-icon-palette={id}
          onClick={() => {
            applyTheme(id);
            try {
              localStorage.setItem(key, id);
            } catch {
              /* Appearance still works when storage is unavailable. */
            }
          }}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </fieldset>
  );
}
