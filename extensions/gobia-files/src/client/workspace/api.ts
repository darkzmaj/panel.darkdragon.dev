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
