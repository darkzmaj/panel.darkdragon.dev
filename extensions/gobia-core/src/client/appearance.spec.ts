import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyScheme, isDark, parseScheme, readStoredScheme, storeScheme } from './appearance';

describe('appearance', () => {
    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.classList.remove('dark');
    });
    afterEach(() => window.localStorage.clear());

    it('parses unknown values as system', () => {
        expect(parseScheme('dark')).toBe('dark');
        expect(parseScheme('light')).toBe('light');
        expect(parseScheme('system')).toBe('system');
        expect(parseScheme('purple')).toBe('system');
        expect(parseScheme(null)).toBe('system');
        expect(parseScheme(undefined)).toBe('system');
    });

    it('resolves dark from the scheme and the device preference', () => {
        expect(isDark('dark', false)).toBe(true);
        expect(isDark('light', true)).toBe(false);
        expect(isDark('system', true)).toBe(true);
        expect(isDark('system', false)).toBe(false);
    });

    it('stores and reads the last scheme', () => {
        expect(readStoredScheme()).toBe('system');
        storeScheme('light');
        expect(readStoredScheme()).toBe('light');
        window.localStorage.setItem('gobia:scheme', 'garbage');
        expect(readStoredScheme()).toBe('system');
    });

    it('toggles the dark class on the document', () => {
        applyScheme('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        applyScheme('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
});
