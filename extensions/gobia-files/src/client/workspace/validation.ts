export interface Problem {
    message: string;
    line: number | null;
    column: number | null;
}

export type ValidatedFormat = 'json' | 'yaml' | 'toml' | 'xml';

const formats = {
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    xml: 'xml',
} satisfies Record<string, ValidatedFormat>;
const FORMATS = new Map<string, ValidatedFormat>(Object.entries(formats));

export function formatOf(name: string): ValidatedFormat | null {
    if (!name.includes('.')) return null;
    return FORMATS.get(name.slice(name.lastIndexOf('.') + 1).toLowerCase()) ?? null;
}

const position = (text: string, offset: number) => {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
};

const failure = (message: string, line: number | null = null, column: number | null = null): Problem => ({
    message,
    line,
    column,
});

function json(text: string): Problem | null {
    if (text.trim() === '') return null;
    try {
        JSON.parse(text);
        return null;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid JSON';
        // Engines word this differently: "at position 12", "(line 3 column 5)", or no location at all.
        const lineColumn = /line (\d+) column (\d+)/.exec(message);
        if (lineColumn) return failure(message, Number(lineColumn[1]), Number(lineColumn[2]));
        const at = /position (\d+)/.exec(message);
        const where = at ? position(text, Number(at[1])) : null;
        return failure(message, where?.line ?? null, where?.column ?? null);
    }
}

function xml(text: string): Problem | null {
    if (text.trim() === '') return null;
    const document = new DOMParser().parseFromString(text, 'application/xml');
    const error = document.getElementsByTagName('parsererror')[0];
    if (!error) return null;
    const detail = error.textContent ?? 'Invalid XML';
    const message =
        detail
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line !== '') ?? 'Invalid XML';
    const line = /line (?:number )?(\d+)/i.exec(detail);
    return failure(message, line ? Number(line[1]) : null);
}

async function yaml(text: string): Promise<Problem | null> {
    const { parseAllDocuments } = await import('yaml');
    for (const document of parseAllDocuments(text)) {
        const error = document.errors[0];
        if (error) {
            const first = error.linePos?.[0];
            const message = (error.message.split('\n')[0] ?? error.message).replace(/ at line \d+, column \d+:?$/, '');
            return failure(message, first?.line ?? null, first?.col ?? null);
        }
    }
    return null;
}

interface TomlFailure {
    line?: number;
    column?: number;
}

async function toml(text: string): Promise<Problem | null> {
    const { parse } = await import('smol-toml');
    try {
        parse(text);
        return null;
    } catch (error) {
        const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'Invalid TOML';
        const where = error as TomlFailure;
        return failure(message, where.line ?? null, where.column ?? null);
    }
}

/** Syntax problem of a JSON, YAML, TOML or XML file, or null when it parses or the format is not checked. */
export async function validate(name: string, text: string): Promise<Problem | null> {
    switch (formatOf(name)) {
        case 'json':
            return json(text);
        case 'xml':
            return xml(text);
        case 'yaml':
            return yaml(text);
        case 'toml':
            return toml(text);
        default:
            return null;
    }
}
