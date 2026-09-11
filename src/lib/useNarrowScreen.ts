import { useEffect, useState } from 'react';

/**
 * Whether the window is narrower than a given width.
 *
 * The app stacks two sidebars before the content starts -- the main one at
 * 256px and a module's own at 288px -- which is fine on a desktop and leaves
 * a laptop with too little room for a grid. Screens use this to fold them
 * away when there is no space, and only then.
 *
 * The value changes when the window CROSSES the width, not on every resize
 * event, so an effect watching it fires once per crossing. That matters: a
 * user who opens a sidebar by hand should not have it shut again the moment
 * they nudge the window.
 */
export function useNarrowScreen(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth - 1}px)`;

  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return narrow;
}

/**
 * The widths the app folds at.
 *
 * A module's sidebar is a list of tabs and goes first, because an icon rail
 * still shows where you are. The main sidebar follows only when things are
 * genuinely tight.
 */
export const FOLD_MODULE_SIDEBAR = 1536;
export const FOLD_MAIN_SIDEBAR = 1280;
