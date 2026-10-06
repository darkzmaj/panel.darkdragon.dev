import { http } from '@pterodactyl/sdk';
import type { PermissionGroups } from './permissions';

const BASE = '/api/client/extensions/gobia-core/access';

export interface Grant {
    uuid: string;
    email: string;
    username: string;
    servers: { uuid: string; name: string; permissions: string[] }[];
    permissions: string[];
}

export interface AccessData {
    grants: Grant[];
    servers: { uuid: string; name: string }[];
    permission_groups: PermissionGroups;
}

export const accessQueryKey = ['gobia-core', 'access'] as const;

export async function fetchAccess(): Promise<AccessData> {
    return (await http.get<AccessData>(BASE)).data;
}

export async function grantAccess(email: string, servers: string[], permissions: string[]): Promise<void> {
    await http.post(BASE, { email, servers, permissions });
}

export async function replaceAccess(person: string, servers: string[], permissions: string[]): Promise<void> {
    await http.put(`${BASE}/${person}`, { servers, permissions });
}

export async function revokeAccess(person: string): Promise<void> {
    await http.delete(`${BASE}/${person}`);
}
