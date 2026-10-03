// Pre-save checks for structured configuration files.
//
// Two separate levels, kept apart on purpose:
//  1. syntax   - the file cannot be parsed at all (JSON, YAML, TOML, XML). These block saving.
//  2. schema   - the file parses but a registered schema disagrees. Shown to the user, never blocks saving.
//
// Source code (Java, JavaScript, PHP, shell...) is deliberately never validated here: people save unfinished code on purpose.
// This module does not import Monaco, so it can be unit tested and is only ever loaded with the file workspace.

export interface Diagnostic {
    message: string;
    line: number; // 1-based
    column: number; // 1-based
    endLine?: number;
    endColumn?: number;
    severity: 'error' | 'warning';
    source: 'syntax' | 'schema';
}

export interface ValidationResult {
    diagnostics: Diagnostic[];
    // The parsed document for formats that were parsed successfully, handed to schemas.
    parsed?: unknown;
    // Human name of the format, used in messages ("YAML").
    format?: string;
}

export interface FileSchema {
    id: string;
    description: string;
    // Which files this schema applies to, for example (path) => path.endsWith('/paper-global.yml').
    matches: (path: string, language: string) => boolean;
    validate: (
        parsed: unknown
    ) => Array<Omit<Diagnostic, 'source' | 'severity'> & { severity?: Diagnostic['severity'] }>;
}

const schemas: FileSchema[] = [];

// Lets configuration-specific knowledge be added later without touching the editor. No schemas ship yet.
export const registerSchema = (schema: FileSchema) => {
    if (!schemas.some((s) => s.id === schema.id)) schemas.push(schema);
};

export const clearSchemas = () => {
    schemas.length = 0;
};

const offsetToPosition = (text: string, offset: number) => {
    const before = text.slice(0, Math.max(0, offset));
    const lines = before.split('\n');

    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
};

const error = (message: string, line: number, column: number, endLine?: number, endColumn?: number): Diagnostic => ({
    message,
    line: Math.max(1, line),
    column: Math.max(1, column),
    endLine,
    endColumn,
    severity: 'error',
    source: 'syntax',
});

// Browsers no longer include an error position in JSON.parse messages, so a failing document is re-read by this
// small strict scanner purely to find where it first goes wrong.
const locateJsonError = (text: string): { offset: number; message: string } => {
    let i = 0;
    const fail = (message: string, at = i): never => {
        throw { offset: at, message };
    };
    const ws = () => {
        while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
    };
    const literal = (word: string) => {
        if (text.startsWith(word, i)) i += word.length;
        else fail(`Unexpected token, expected ${word}`);
    };
    const string = () => {
        i++;
        while (i < text.length) {
            const c = text[i];
            if (c === '"') return void i++;
            if (c === '\n' || c < ' ') fail('Unterminated or invalid string');
            if (c === '\\') {
                const n = text[i + 1];
                if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
                else if (n && '"\\/bfnrt'.includes(n)) i += 2;
                else fail('Invalid escape sequence');
            } else i++;
        }
        fail('Unterminated string');
    };
    const value = (): void => {
        ws();
        const c = text[i];
        if (c === '{') {
            i++;
            ws();
            if (text[i] === '}') return void i++;
            for (;;) {
                ws();
                if (text[i] !== '"') fail('Expected a property name in double quotes');
                string();
                ws();
                if (text[i] !== ':') fail("Expected ':' after the property name");
                i++;
                value();
                ws();
                if (text[i] === ',') i++;
                else if (text[i] === '}') return void i++;
                else fail("Expected ',' or '}'");
            }
        } else if (c === '[') {
            i++;
            ws();
            if (text[i] === ']') return void i++;
            for (;;) {
                value();
                ws();
                if (text[i] === ',') i++;
                else if (text[i] === ']') return void i++;
                else fail("Expected ',' or ']'");
            }
        } else if (c === '"') string();
        else if (c === 't') literal('true');
        else if (c === 'f') literal('false');
        else if (c === 'n') literal('null');
        else {
            const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
            if (!m) fail(i >= text.length ? 'Unexpected end of JSON' : `Unexpected character '${c}'`);
            else i += m[0].length;
        }
    };
    try {
        value();
        ws();
        if (i < text.length) fail('Unexpected content after the end of the JSON value');
    } catch (e) {
        return e as { offset: number; message: string };
    }

    return { offset: 0, message: 'Invalid JSON' };
};

const validateJson = (content: string): ValidationResult => {
    try {
        return { diagnostics: [], parsed: JSON.parse(content), format: 'JSON' };
    } catch (e) {
        const found = locateJsonError(content);
        const where = offsetToPosition(content, found.offset);

        return { diagnostics: [error(found.message, where.line, where.column)], format: 'JSON' };
    }
};

const validateYaml = async (content: string): Promise<ValidationResult> => {
    const YAML = await import(/* webpackChunkName: "config-validators" */ 'yaml');
    const diagnostics: Diagnostic[] = [];
    const documents = YAML.parseAllDocuments(content, { uniqueKeys: true });

    for (const doc of documents) {
        for (const issue of doc.errors) {
            const [start, end] = issue.linePos || [{ line: 1, col: 1 }];
            diagnostics.push(error(issue.message.split('\n')[0], start.line, start.col, end?.line, end?.col));
        }
    }

    return {
        diagnostics,
        parsed: diagnostics.length === 0 ? documents.map((d) => d.toJS()) : undefined,
        format: 'YAML',
    };
};

const validateToml = async (content: string): Promise<ValidationResult> => {
    const toml = await import(/* webpackChunkName: "config-validators" */ 'smol-toml');
    try {
        return { diagnostics: [], parsed: toml.parse(content), format: 'TOML' };
    } catch (e) {
        const err = e as { message: string; line?: number; column?: number };

        return { diagnostics: [error(err.message.split('\n')[0], err.line ?? 1, err.column ?? 1)], format: 'TOML' };
    }
};

const validateXml = (content: string): ValidationResult => {
    const doc = new DOMParser().parseFromString(content, 'application/xml');
    const problem = doc.getElementsByTagName('parsererror')[0];
    if (!problem) return { diagnostics: [], parsed: doc, format: 'XML' };

    // Browsers word this differently; take the first line and any "line N ... column M" they mention.
    const text = (problem.textContent || 'Malformed XML').trim();
    const match = /line\s+(?:number\s+)?(\d+)[^\d]+(?:column\s+)?(\d+)/i.exec(text);
    const message = text.split('\n').find((l) => l.trim() && !/^this page contains/i.test(l)) || 'Malformed XML';

    return {
        diagnostics: [error(message.trim(), match ? Number(match[1]) : 1, match ? Number(match[2]) : 1)],
        format: 'XML',
    };
};

/**
 * Checks a file's content. Empty files are never a syntax error (a freshly created file is empty).
 */
export const validateContent = async (language: string, content: string, path = ''): Promise<ValidationResult> => {
    if (content.trim() === '') return { diagnostics: [] };

    let result: ValidationResult;
    switch (language) {
        case 'json':
            result = validateJson(content);
            break;
        case 'yaml':
            result = await validateYaml(content);
            break;
        case 'toml':
            result = await validateToml(content);
            break;
        case 'xml':
            result = validateXml(content);
            break;
        default:
            return { diagnostics: [] };
    }

    // Schema checks only run on a document that parsed, and only ever add non-blocking warnings.
    if (result.parsed !== undefined) {
        for (const schema of schemas.filter((s) => s.matches(path, language))) {
            for (const issue of schema.validate(result.parsed)) {
                result.diagnostics.push({ ...issue, severity: issue.severity || 'warning', source: 'schema' });
            }
        }
    }

    return result;
};

/** Errors that must stop a save: syntax problems only. */
export const blockingErrors = (diagnostics: Diagnostic[]) =>
    diagnostics.filter((d) => d.source === 'syntax' && d.severity === 'error');

export const describeBlocking = (fileName: string, result: ValidationResult): string => {
    const first = blockingErrors(result.diagnostics)[0];

    return first
        ? `Cannot save ${fileName}: ${result.format || 'Syntax'} error at line ${first.line}, column ${first.column}. ${
              first.message
          }`
        : '';
};
