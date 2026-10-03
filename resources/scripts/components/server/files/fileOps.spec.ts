import { checkMove, copyName, decodeDrag, encodeDrag, hasUnsafeSegments, isInside, remapPath } from './fileOps';

describe('checkMove', () => {
    it('allows moving a file into another folder', () => {
        expect(checkMove('/a/file.txt', '/b')).toEqual({ ok: true });
        expect(checkMove('/file.txt', '/plugins/deep')).toEqual({ ok: true });
    });

    it('treats moving into the current folder as a no-op', () => {
        expect(checkMove('/a/file.txt', '/a')).toEqual({ ok: true, noop: true });
        expect(checkMove('/file.txt', '/')).toEqual({ ok: true, noop: true });
    });

    it('refuses recursive moves', () => {
        expect(checkMove('/a', '/a').ok).toBe(false);
        expect(checkMove('/a', '/a/b').ok).toBe(false);
        expect(checkMove('/a', '/a/b/c/d').ok).toBe(false);
    });

    it('does not mistake a sibling with a common prefix for a descendant', () => {
        expect(checkMove('/plugins', '/plugins-old')).toEqual({ ok: true });
    });

    it('refuses traversal and the root', () => {
        expect(checkMove('/a/b', '/a/../etc').ok).toBe(false);
        expect(checkMove('/a/../b', '/c').ok).toBe(false);
        expect(checkMove('/', '/a').ok).toBe(false);
    });
});

describe('path helpers', () => {
    it('detects containment', () => {
        expect(isInside('/a', '/a')).toBe(true);
        expect(isInside('/a', '/a/b')).toBe(true);
        expect(isInside('/a', '/ab')).toBe(false);
        expect(isInside('/', '/anything')).toBe(true);
    });

    it('flags unsafe segments', () => {
        expect(hasUnsafeSegments('/a/../b')).toBe(true);
        expect(hasUnsafeSegments('/a/./b')).toBe(true);
        expect(hasUnsafeSegments('/a/b..c')).toBe(false);
    });

    it('remaps open file paths after a move or rename', () => {
        expect(remapPath('/a/b.txt', '/a/b.txt', '/c/b.txt')).toBe('/c/b.txt');
        expect(remapPath('/a/sub/b.txt', '/a', '/z/a')).toBe('/z/a/sub/b.txt');
        expect(remapPath('/ab/x', '/a', '/z')).toBe('/ab/x');
    });

    it('names copies without clashing', () => {
        expect(copyName('server.properties', ['server.properties'])).toBe('server (copy).properties');
        expect(copyName('server.properties', ['server (copy).properties'])).toBe('server (copy 2).properties');
        expect(copyName('plugins', [])).toBe('plugins (copy)');
        expect(copyName('a (copy).txt', ['a (copy).txt'])).toBe('a (copy 2).txt');
    });

    it('round trips drag payloads and rejects foreign data', () => {
        const payload = { directory: '/a', names: ['x', 'y'] };
        expect(decodeDrag(encodeDrag(payload))).toEqual(payload);
        expect(decodeDrag('nope')).toBeNull();
        expect(decodeDrag('{"directory":1,"names":[]}')).toBeNull();
    });
});
