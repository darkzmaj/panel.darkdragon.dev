import { beforeEach, describe, expect, it } from 'vitest';
import { applyLogo, logoRule } from './branding';

describe('branding', () => {
    beforeEach(() => document.getElementById('gobia-branding')?.remove());

    it('builds a rule for a same origin path', () => {
        expect(logoRule('/extension-files/gobia-core/abc.png')).toContain('url("/extension-files/gobia-core/abc.png")');
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
    ])('refuses %j', (value) => expect(logoRule(value)).toBe(''));

    it('adds, updates and removes a single style element', () => {
        applyLogo('/assets/theme/img/icon-256.png');
        applyLogo('/assets/theme/img/icon-64.png');
        expect(document.querySelectorAll('#gobia-branding')).toHaveLength(1);
        expect(document.getElementById('gobia-branding')?.textContent).toContain('icon-64.png');
        applyLogo('nope');
        expect(document.getElementById('gobia-branding')).toBeNull();
    });
});
