import { http, serverQueryOptions, serverResourcesQueryOptions } from '@pterodactyl/sdk';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

/** A server the signed in person can open, as the picker lists it. */
export interface PickableServer {
    uuid: string;
    identifier: string;
    name: string;
    description: string | null;
    node: string;
    suspended: boolean;
    installing: boolean;
}

interface Listed {
    data: Array<{
        attributes: {
            uuid: string;
            identifier: string;
            name: string;
            description: string | null;
            node: string;
            is_suspended: boolean;
            status: string | null;
        };
    }>;
}

interface ServerQuery {
    per_page: number;
    'filter[*]'?: string;
}

export async function fetchServers(search: string): Promise<PickableServer[]> {
    const params: ServerQuery = { per_page: 40 };
    if (search.trim()) params['filter[*]'] = search.trim();
    const response = await http.get<Listed>('/api/client', { params });
    return response.data.data.map(({ attributes }) => ({
        uuid: attributes.uuid,
        identifier: attributes.identifier,
        name: attributes.name,
        description: attributes.description || null,
        node: attributes.node,
        suspended: attributes.is_suspended,
        installing: attributes.status === 'installing',
    }));
}

/** The servers matching a search, newest search first; the previous list stays on screen while the next one loads. */
export const useServers = (search: string, enabled = true) =>
    useQuery({
        queryKey: ['gobia-files', 'servers', search.trim().toLowerCase()],
        queryFn: () => fetchServers(search),
        enabled,
        staleTime: 15_000,
        placeholderData: keepPreviousData,
    });

/** What the person may do with one server's files, from the server's own response. */
export interface FilePermissions {
    create: boolean;
    update: boolean;
    delete: boolean;
    archive: boolean;
}

const NONE: FilePermissions = { create: false, update: false, delete: false, archive: false };

export function filePermissions(
    meta: { is_server_owner?: boolean; user_permissions?: readonly string[] } | undefined
): FilePermissions {
    if (!meta) return NONE;
    if (meta.is_server_owner) return { create: true, update: true, delete: true, archive: true };
    const held = new Set(meta.user_permissions ?? []);
    const has = (key: string) => held.has('*') || held.has(key);
    return {
        create: has('file.create'),
        update: has('file.update'),
        delete: has('file.delete'),
        archive: has('file.archive'),
    };
}

export interface ServerSummary {
    uuid: string;
    identifier: string;
    name: string;
    node: string;
    permissions: FilePermissions;
    canRead: boolean;
    canReadContent: boolean;
}

/** One server's name, node and the person's file permissions. */
export function useServerSummary(uuid: string | null) {
    return useQuery({
        ...serverQueryOptions(uuid ?? ''),
        enabled: uuid !== null && uuid !== '',
        staleTime: 30_000,
        select: (response): ServerSummary => {
            const meta = (response as { meta?: { is_server_owner?: boolean; user_permissions?: string[] } }).meta;
            const held = new Set(meta?.user_permissions ?? []);
            const has = (key: string) => meta?.is_server_owner === true || held.has('*') || held.has(key);
            return {
                uuid: response.attributes.uuid,
                identifier: response.attributes.identifier,
                name: response.attributes.name,
                node: response.attributes.node,
                permissions: filePermissions(meta),
                canRead: has('file.read'),
                canReadContent: has('file.read-content'),
            };
        },
    });
}

/** Power state of one server (running, offline, starting...), or null while unknown. */
export function usePowerState(uuid: string | null, enabled = true) {
    return useQuery({
        ...serverResourcesQueryOptions(uuid ?? ''),
        enabled: enabled && uuid !== null && uuid !== '',
        staleTime: 10_000,
        retry: false,
        select: (resources) => resources.attributes.current_state as string,
    });
}
