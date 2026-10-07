import { describe, expect, it } from 'vitest';
import { buildPattern, findHits, replaceAll, replaceHit } from './search';

const pattern = (query: string, extra: Partial<Parameters<typeof buildPattern>[0]> = {}) => {
    const built = buildPattern({ query, caseSensitive: false, wholeWord: false, regex: false, ...extra });
    if (!built || !('pattern' in built)) throw new Error('not a pattern');
    return built.pattern;
};

describe('workspace search', () => {
    it('treats the query literally unless regex is on', () => {
        expect(findHits('a.b\naxb', pattern('a.b')).map((hit) => hit.line)).toEqual([1]);
        expect(findHits('a.b\naxb', pattern('a.b', { regex: true })).map((hit) => hit.line)).toEqual([1, 2]);
    });

    it('honours case and whole words', () => {
        expect(findHits('Cat cat concat', pattern('cat'))).toHaveLength(3);
        expect(findHits('Cat cat concat', pattern('cat', { caseSensitive: true }))).toHaveLength(2);
        expect(findHits('Cat cat concat', pattern('cat', { wholeWord: true }))).toHaveLength(2);
    });

    it('reports an invalid regex instead of throwing', () => {
        expect(buildPattern({ query: '(', caseSensitive: false, wholeWord: false, regex: true })).toHaveProperty(
            'error'
        );
        expect(buildPattern({ query: '', caseSensitive: false, wholeWord: false, regex: false })).toBeNull();
    });

    it('replaces everything, or one match, keeping the rest', () => {
        const text = 'port=1\nport=1\r\nother';
        expect(replaceAll(text, pattern('port=1'), 'port=2', false)).toBe('port=2\nport=2\r\nother');
        const [, second] = findHits(text, pattern('port=1'));
        expect(replaceHit(text, second!, pattern('port=1'), 'port=9', false)).toBe('port=1\nport=9\r\nother');
    });

    it('expands groups in regex mode only', () => {
        expect(replaceAll('id-42', pattern('id-(\\d+)', { regex: true }), 'n$1', true)).toBe('n42');
        expect(replaceAll('id-42', pattern('id-(\\d+)', { regex: true }), 'n$1', false)).toBe('n$1');
    });
});
