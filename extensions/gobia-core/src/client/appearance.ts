export type Scheme = 'system' | 'light' | 'dark';

export const SCHEMES: readonly Scheme[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'gobia:scheme';

/** Narrows a stored string to a scheme, falling back to `system` for anything unrecognised. */
export function parseScheme(value: string | null | undefined): Scheme {
    return SCHEMES.find((scheme) => scheme === value) ?? 'system';
}

/** The scheme this browser last used; lets the page paint in the right mode before the profile request returns. */
export function readStoredScheme(): Scheme {
    try {
        return parseScheme(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return 'system';
    }
}

export function storeScheme(scheme: Scheme): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, scheme);
    } catch {
        // Private mode or blocked storage: the server copy still applies on the next load.
    }
}

export function prefersDark(): boolean {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function isDark(scheme: Scheme, systemPrefersDark: boolean): boolean {
    return scheme === 'system' ? systemPrefersDark : scheme === 'dark';
}

/** Sets or clears the `dark` class the panel tokens key off. */
export function applyScheme(scheme: Scheme): void {
    document.documentElement.classList.toggle('dark', isDark(scheme, prefersDark()));
}

/** Applies the stored scheme now and keeps following the operating system while the scheme is `system`. */
export function initAppearance(): () => void {
    let current = readStoredScheme();
    applyScheme(current);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => {
        if (current === 'system') applyScheme('system');
    };
    media?.addEventListener('change', onChange);
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
            current = readStoredScheme();
            applyScheme(current);
        }
    };
    window.addEventListener('storage', onStorage);

    return () => {
        media?.removeEventListener('change', onChange);
        window.removeEventListener('storage', onStorage);
    };
}
