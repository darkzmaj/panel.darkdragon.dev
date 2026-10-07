import { beforeEach, describe, expect, it } from 'vitest';
import { applyAvatar, applyLogo, DEFAULT_LOGO, safeUrl } from './branding';

describe('branding', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-gobia-logo');
        document.documentElement.removeAttribute('data-gobia-avatar');
    });

    it('accepts a same origin path', () => {
        expect(safeUrl('/extension-files/gobia-core/abc.png')).toBe('/extension-files/gobia-core/abc.png');
    });

    it.each([
        '',
        'https://evil.example/x.png',
        '//evil.example/x.png',
        '/a/../b.png',
        '/a//b.png',
        '/./a.png',
        '/a") ; } body { display:none',
        "/a'b",
        'javascript:alert(1)',
    ])('refuses %j', (value) => expect(safeUrl(value)).toBe(''));

    it('publishes, updates and clears the logo attribute and notifies the shell', () => {
        let events = 0;
        window.addEventListener('gobia:branding', () => events++);
        applyLogo('/extension-files/gobia-core/logo.png');
        expect(document.documentElement.getAttribute('data-gobia-logo')).toBe('/extension-files/gobia-core/logo.png');
        applyLogo('nope');
        expect(document.documentElement.hasAttribute('data-gobia-logo')).toBe(false);
        expect(events).toBe(2);
    });

    it('treats the default logo setting as no custom logo', () => {
        applyLogo(DEFAULT_LOGO);
        expect(document.documentElement.hasAttribute('data-gobia-logo')).toBe(false);
    });

    it('publishes and clears the avatar attribute', () => {
        applyAvatar('/extension-files/gobia-core/me.png');
        expect(document.documentElement.getAttribute('data-gobia-avatar')).toBe('/extension-files/gobia-core/me.png');
        applyAvatar(null);
        expect(document.documentElement.hasAttribute('data-gobia-avatar')).toBe(false);
    });
});
