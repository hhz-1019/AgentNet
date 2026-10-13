import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Appearance = 'day' | 'night';
const key = 'elsewhere-appearance';
function initial(): Appearance {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved === 'night' ? 'night' : 'day';
  } catch {
    /* The switch also works without browser storage. */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}
export function AppearanceSwitch() {
  const [appearance, setAppearance] = useState(initial);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.style.colorScheme =
      appearance === 'night' ? 'dark' : 'light';
  }, [appearance]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === key) setAppearance(initial());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const next = appearance === 'day' ? 'night' : 'day';
  return (
    <button
      className="appearance-switch"
      type="button"
      aria-label={`切换至${next === 'day' ? '白天' : '夜间'}模式`}
      title={`切换至${next === 'day' ? '白天' : '夜间'}模式`}
      onClick={() => {
        setAppearance(next);
        try {
          localStorage.setItem(key, next);
        } catch {
          /* In-memory choice remains usable. */
        }
      }}
    >
      {appearance === 'day' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
