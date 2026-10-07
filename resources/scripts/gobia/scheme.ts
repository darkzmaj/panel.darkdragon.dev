/** The colour scheme choice made from the shell's profile menu. gobia-core listens, saves it to the profile and applies it. */
export const SCHEME_REQUEST_EVENT = 'gobia:scheme-request';

export type SchemeChoice = 'system' | 'light' | 'dark';

export const requestScheme = (scheme: SchemeChoice) =>
    window.dispatchEvent(new CustomEvent(SCHEME_REQUEST_EVENT, { detail: scheme }));

export const currentScheme = (): SchemeChoice => {
    try {
        const stored = window.localStorage.getItem('gobia:scheme');

        return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
        return 'system';
    }
};
