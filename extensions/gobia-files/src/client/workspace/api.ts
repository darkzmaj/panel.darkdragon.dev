import { http } from '@pterodactyl/sdk';
import { basename, dirname } from './paths';

const base = (uuid: string) => `/api/client/servers/${uuid}/files`;

export async function readFile(uuid: string, path: string): Promise<string> {
    const response = await http.get<string>(`${base(uuid)}/contents`, {
        params: { file: path },
        responseType: 'text',
        transformResponse: (data: string) => data,
        timeout: 60000,
    });
    return response.data;
}

export async function writeFile(uuid: string, path: string, content: string): Promise<void> {
    await http.post(`${base(uuid)}/write`, content, {
        params: { file: path },
        headers: { 'Content-Type': 'text/plain' },
        transformRequest: [(data: string) => data],
        timeout: 60000,
    });
}

interface ListedFile {
    attributes: { name: string; modified_at: string };
}

/** Modification time Wings reports for a file, or null when it no longer exists. */
export async function modifiedAt(uuid: string, path: string): Promise<string | null> {
    const response = await http.get<{ data: ListedFile[] }>(`${base(uuid)}/list`, {
        params: { directory: dirname(path) },
    });
    const name = basename(path);
    return response.data.data.find((file) => file.attributes.name === name)?.attributes.modified_at ?? null;
}

export interface TreeEntry {
    name: string;
    path: string;
    directory: boolean;
    size: number;
    mimetype: string;
    modifiedAt: string;
}

interface ListedEntry {
    attributes: {
        name: string;
        is_file: boolean;
        size: number;
        mimetype: string;
        modified_at: string;
    };
}

const sorted = (entries: TreeEntry[]): TreeEntry[] =>
    entries.sort((a, b) =>
        a.directory === b.directory ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.directory ? -1 : 1
    );

/** One directory, directories first. */
export async function listDirectory(uuid: string, directory: string): Promise<TreeEntry[]> {
    const response = await http.get<{ data: ListedEntry[] }>(`${base(uuid)}/list`, { params: { directory } });
    return sorted(
        response.data.data.map(({ attributes }) => ({
            name: attributes.name,
            path: directory.endsWith('/') ? `${directory}${attributes.name}` : `${directory}/${attributes.name}`,
            directory: !attributes.is_file,
            size: attributes.size,
            mimetype: attributes.mimetype,
            modifiedAt: attributes.modified_at,
        }))
    );
}

export const createFolder = (uuid: string, root: string, name: string) =>
    http.post(`${base(uuid)}/create-folder`, { root, name });

export const renameEntries = (uuid: string, root: string, files: ReadonlyArray<{ from: string; to: string }>) =>
    http.put(`${base(uuid)}/rename`, { root, files });

export const deleteEntries = (uuid: string, root: string, files: readonly string[]) =>
    http.post(`${base(uuid)}/delete`, { root, files });

export const copyEntry = (uuid: string, location: string) => http.post(`${base(uuid)}/copy`, { location });

export const compressEntries = (uuid: string, root: string, files: readonly string[]) =>
    http.post(`${base(uuid)}/compress`, { root, files });

export const decompressEntry = (uuid: string, root: string, file: string) =>
    http.post(`${base(uuid)}/decompress`, { root, file });

export async function downloadUrl(uuid: string, file: string): Promise<string> {
    const response = await http.get<{ attributes: { url: string } }>(`${base(uuid)}/download`, { params: { file } });
    return response.data.attributes.url;
}
