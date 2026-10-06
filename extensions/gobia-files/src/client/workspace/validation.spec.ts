import { describe, expect, it } from 'vitest';
import { formatOf, validate } from './validation';

describe('formatOf', () => {
    it('recognises the validated formats by extension only', () => {
        expect(formatOf('server.properties')).toBeNull();
        expect(formatOf('config.JSON')).toBe('json');
        expect(formatOf('a.yml')).toBe('yaml');
        expect(formatOf('a.yaml')).toBe('yaml');
        expect(formatOf('Cargo.toml')).toBe('toml');
        expect(formatOf('pom.xml')).toBe('xml');
        expect(formatOf('json')).toBeNull();
    });
});

describe('validate', () => {
    it('accepts valid files and files that are not checked', async () => {
        expect(await validate('a.json', '{"a": [1, 2]}')).toBeNull();
        expect(await validate('a.yml', 'a:\n  - 1\n  - 2\n')).toBeNull();
        expect(await validate('a.toml', 'a = 1\n[b]\nc = "d"\n')).toBeNull();
        expect(await validate('a.xml', '<a><b/></a>')).toBeNull();
        expect(await validate('a.txt', '{{{ not checked')).toBeNull();
        expect(await validate('a.json', '')).toBeNull();
    });

    it('reports a JSON error, with its line when the engine says where', async () => {
        const problem = await validate('a.json', '{\n  "a": 1,\n  "b": \n}');
        expect(problem).not.toBeNull();
        if (problem?.line) expect(problem.line).toBe(4);
    });

    it('reports YAML errors with a line', async () => {
        const problem = await validate('a.yml', 'a: 1\nb: [1, 2\nc: 3\n');
        expect(problem).not.toBeNull();
        expect(problem?.line).toBeGreaterThan(0);
    });

    it('reports TOML errors', async () => {
        const problem = await validate('a.toml', 'a = \nb = 1\n');
        expect(problem).not.toBeNull();
        expect(problem?.message).not.toBe('');
    });

    it('reports XML errors', async () => {
        const problem = await validate('a.xml', '<a><b></a>');
        expect(problem).not.toBeNull();
    });
});
