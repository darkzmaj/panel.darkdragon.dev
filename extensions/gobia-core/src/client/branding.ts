/**
 * The core shell reads the admin uploaded logo and the user's avatar from data attributes on <html> and re-renders on
 * the `gobia:branding` event (see resources/scripts/gobia/branding.ts). Only same origin paths made of URL safe
 * characters are ever published: every segment must start with a letter, digit, underscore or hyphen, so `//host/x`
 * (protocol relative), `.` and `..` segments never match.
 */
const SAFE_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** The setting's default value; it means "no custom logo", so the shell keeps showing the Gobia wordmark. */
export const DEFAULT_LOGO = '/assets/theme/img/icon-256.png';

const BRANDING_EVENT = 'gobia:branding';

/** The url when it is a safe same origin path, otherwise an empty string. */
export function safeUrl(url: string | null | undefined): string {
    return url && url.length <= 200 && SAFE_PATH.test(url) ? url : '';
}

function publish(attribute: string, url: string | null | undefined): void {
    const value = safeUrl(url);
    const root = document.documentElement;
    if (value) root.setAttribute(attribute, value);
    else root.removeAttribute(attribute);
    window.dispatchEvent(new Event(BRANDING_EVENT));
}

/** Shows the user's uploaded avatar in the top bar, or restores the generated one for an empty value. */
export function applyAvatar(url: string | null): void {
    publish('data-gobia-avatar', url);
}

/** Shows the uploaded logo in the top bar; an empty or unsafe value restores the Gobia default. */
export function applyLogo(url: string): void {
    publish('data-gobia-logo', url === DEFAULT_LOGO ? '' : url);
}
