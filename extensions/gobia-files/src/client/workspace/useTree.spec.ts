import { describe, expect, it } from 'vitest';
import type { TreeEntry } from './api';
import { moveListings, removeFromListings, type Listing, type Listings } from './useTree';
import { nameProblem, validTarget } from './Tree';

const entry = (path: string, directory = false): TreeEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    directory,
    size: 1,
    mimetype: 'text/plain',
    modifiedAt: '',
});

const listings = (): Listings => ({
    '/': { items: [entry('/mods', true), entry('/a.txt'), entry('/world', true)] },
    '/mods': { items: [entry('/mods/x.jar'), entry('/mods/cfg', true)] },
    '/mods/cfg': { items: [entry('/mods/cfg/y.toml')] },
    '/world': { items: [entry('/world/level.dat')] },
});

const paths = (listing: Listing | undefined) =>
    listing && listing !== 'loading' && 'items' in listing ? listing.items.map((item) => item.path) : null;

describe('moving entries in the local tree', () => {
    it('moves a file between loaded folders in listing order', () => {
        const next = moveListings(listings(), '/a.txt', '/world/a.txt');
        expect(paths(next['/'])).toEqual(['/mods', '/world']);
        expect(paths(next['/world'])).toEqual(['/world/a.txt', '/world/level.dat']);
    });

    it('moves a folder with every listing it had', () => {
        const next = moveListings(listings(), '/mods', '/world/mods');
        expect(paths(next['/'])).toEqual(['/a.txt', '/world']);
        expect(paths(next['/world'])).toEqual(['/world/mods', '/world/level.dat']);
        expect(paths(next['/world/mods'])).toEqual(['/world/mods/x.jar', '/world/mods/cfg']);
        expect(paths(next['/world/mods/cfg'])).toEqual(['/world/mods/cfg/y.toml']);
        expect(next['/mods']).toBeUndefined();
    });

    it('renames in place and keeps the folder sorted', () => {
        const next = moveListings(listings(), '/a.txt', '/zz.txt');
        expect(paths(next['/'])).toEqual(['/mods', '/world', '/zz.txt']);
        expect(next['/']).toEqual({ items: expect.arrayContaining([expect.objectContaining({ name: 'zz.txt' })]) });
    });

    it('does not invent a listing for a folder that was never opened', () => {
        const partial = listings();
        delete partial['/world'];
        const next = moveListings(partial, '/a.txt', '/world/a.txt');
        expect(next['/world']).toBeUndefined();
        expect(paths(next['/'])).toEqual(['/mods', '/world']);
    });

    it('removes entries and the listings of removed folders', () => {
        const next = removeFromListings(listings(), ['/mods', '/a.txt']);
        expect(paths(next['/'])).toEqual(['/world']);
        expect(Object.keys(next).sort()).toEqual(['/', '/world']);
    });
});

describe('drop and name rules', () => {
    it('refuses the entry itself, its parent, its descendants, existing names and traversal', () => {
        expect(validTarget('/mods', '/mods')).toBe(false);
        expect(validTarget('/mods/x.jar', '/mods')).toBe(false);
        expect(validTarget('/mods', '/mods/cfg')).toBe(false);
        expect(validTarget('/a.txt', '/world', new Set(['a.txt']))).toBe(false);
        expect(validTarget('/../etc/passwd', '/world')).toBe(false);
        expect(validTarget('/a.txt', '/world', new Set(['level.dat']))).toBe(true);
        expect(validTarget('/mods', '/modsx')).toBe(true);
    });

    it('rejects empty, dot, slash and duplicate names', () => {
        expect(nameProblem('  ', new Set())).not.toBeNull();
        expect(nameProblem('..', new Set())).not.toBeNull();
        expect(nameProblem('a/b', new Set())).not.toBeNull();
        expect(nameProblem('a.txt', new Set(['a.txt']))).not.toBeNull();
        expect(nameProblem('b.txt', new Set(['a.txt']))).toBeNull();
    });
});
