const STYLE_ID = 'gobia-branding';

/**
 * Only same origin paths made of URL safe characters are ever placed in a style rule. Every segment must start with a
 * letter, digit, underscore or hyphen, so `//host/x` (protocol relative), `.` and `..` segments never match.
 */
const SAFE_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** The rule that puts the logo before the panel name in the navigation bar, or an empty string for an unsafe value. */
export function logoRule(url: string): string {
    if (url.length > 200 || !SAFE_PATH.test(url)) return '';
    return [
        '#logo > a { display: flex; align-items: center; gap: 0.625rem; }',
        `#logo > a::before { content: ''; flex: none; width: 1.75rem; height: 1.75rem; background: url("${url}") center / contain no-repeat; }`,
    ].join('\n');
}

export function applyLogo(url: string): void {
    const rule = logoRule(url);
    let style = document.getElementById(STYLE_ID);
    if (!rule) {
        style?.remove();
        return;
    }
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
    }
    style.textContent = rule;
}
