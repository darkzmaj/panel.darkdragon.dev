/**
 * @jest-environment jsdom
 */
import { blockingErrors, clearSchemas, describeBlocking, registerSchema, validateContent } from './validation';

const errors = async (language: string, content: string) =>
    blockingErrors((await validateContent(language, content)).diagnostics);

describe('structured config validation', () => {
    afterEach(clearSchemas);

    it('accepts valid files', async () => {
        expect(await errors('json', '{"a": [1, 2, {"b": null}]}')).toEqual([]);
        expect(await errors('yaml', 'a:\n  b: 1\n  c:\n    - x\n    - y\n')).toEqual([]);
        expect(await errors('toml', '[server]\nport = 25565\nname = "x"\n')).toEqual([]);
        expect(await errors('xml', '<config><a b="1"/></config>')).toEqual([]);
    });

    it('never treats an empty file as a syntax error', async () => {
        for (const language of ['json', 'yaml', 'toml', 'xml']) expect(await errors(language, '  \n')).toEqual([]);
    });

    it('blocks invalid JSON with a position', async () => {
        const found = await errors('json', '{\n  "a": 1,\n  "b": }\n');
        expect(found).toHaveLength(1);
        expect(found[0].line).toBe(3);
        expect(found[0].source).toBe('syntax');
    });

    it('blocks invalid YAML (bad indentation, unclosed flow, duplicate keys)', async () => {
        expect((await errors('yaml', 'a:\n  b: 1\n c: 2\n')).length).toBeGreaterThan(0);
        expect((await errors('yaml', 'a: [1, 2\n')).length).toBeGreaterThan(0);
        const duplicate = await errors('yaml', 'a: 1\nb: 2\na: 3\n');
        expect(duplicate[0].line).toBe(3);
    });

    it('blocks invalid TOML with line and column', async () => {
        const found = await errors('toml', 'a = 1\nb = \n');
        expect(found).toHaveLength(1);
        expect(found[0].line).toBeGreaterThanOrEqual(2);
    });

    it('blocks malformed XML', async () => {
        expect((await errors('xml', '<a><b></a>')).length).toBeGreaterThan(0);
    });

    it('does not validate formats that are not structured data', async () => {
        for (const language of ['java', 'javascript', 'php', 'shell', 'properties', 'plaintext', 'typescript']) {
            expect((await validateContent(language, 'this is {{ not valid ]] anything')).diagnostics).toEqual([]);
        }
    });

    it('describes the blocking error for the user', async () => {
        const result = await validateContent('yaml', 'a: [1, 2\n');
        expect(describeBlocking('config.yml', result)).toMatch(
            /^Cannot save config\.yml: YAML error at line \d+, column \d+/
        );
    });

    it('reports schema problems as warnings that do not block saving', async () => {
        registerSchema({
            id: 'test',
            description: 'requires a port',
            matches: (path) => path.endsWith('server.json'),
            validate: (parsed) =>
                (parsed as Record<string, unknown>).port === undefined
                    ? [{ message: 'port is required', line: 1, column: 1 }]
                    : [],
        });

        const result = await validateContent('json', '{"name": "x"}', '/server.json');
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({ source: 'schema', severity: 'warning' });
        expect(blockingErrors(result.diagnostics)).toEqual([]);

        expect((await validateContent('json', '{"port": 1}', '/server.json')).diagnostics).toEqual([]);
        expect((await validateContent('json', '{"name": "x"}', '/other.json')).diagnostics).toEqual([]);
    });
});
