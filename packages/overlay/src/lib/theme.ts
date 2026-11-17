import { computed, signal } from '@preact/signals';
import { preference } from './preference.ts';

export type Theme = 'dark' | 'light' | 'system';

const THEMES: Theme[] = ['dark', 'light', 'system'];

/** The Appearance setting. Dark by default. */
export const [theme, setTheme] = preference({
    key: 'theme',
    storageKey: 'tencil:theme',
    fallback: 'dark',
    parse: stored => (THEMES.includes(stored as Theme) ? (stored as Theme) : undefined),
});

const systemQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
const systemDark = signal(systemQuery?.matches ?? true);
systemQuery?.addEventListener('change', event => {
    systemDark.value = event.matches;
});

/** The overlay draws dark: the root gets `.dark`. */
export const dark = computed(() =>
    theme.value === 'system' ? systemDark.value : theme.value === 'dark',
);
