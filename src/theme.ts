// The look the game is drawn in: Street (graffiti on a night wall) or Notebook (white
// washi-paper cubes sketched in blue ballpoint on a notebook page). Chosen on the home
// screen; the 3D scene reads it when it is built, so a switch reloads the app.

export type ThemeId = 'street' | 'notebook';

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'street', name: 'Street' },
  { id: 'notebook', name: 'Notebook' },
];

let current: ThemeId = 'street';

export const theme = (): ThemeId => current;

/** Player colours as CSS strings for the current theme. */
export const playerCss = (): [string, string] => (current === 'notebook' ? ['#2350d8', '#d63b33'] : ['#ff7a1a', '#1aa3ff']);

export function setTheme(t: ThemeId): void {
  current = t;
  try {
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'notebook' ? '#f4f1e8' : '#0B0B12');
  } catch {
    /* no DOM (tests) */
  }
}
