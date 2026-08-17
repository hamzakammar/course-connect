import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'cc-theme';

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return 'system';
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

/**
 * Theme preference hook. Persists a light/dark/system choice to localStorage
 * and reflects it on <html data-theme>. "system" defers to the OS via the
 * prefers-color-scheme fallback baked into the token layer.
 */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      /* ignore */
    }
    applyChoice(next);
  }, []);

  // Keep the DOM in sync (e.g. across tabs / initial mount).
  useEffect(() => {
    applyChoice(choice);
  }, [choice]);

  return { choice, setChoice } as const;
}
