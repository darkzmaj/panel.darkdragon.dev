import http from '@/api/http';

export interface OwnedServer {
    uuid: string;
    identifier: string;
    name: string;
}

export interface AccessGrant {
    uuid: string;
    email: string;
    username: string;
    image: string | null;
    servers: Array<OwnedServer & { permissions: string[] }>;
    // eslint-disable-next-line camelcase
    all_servers: boolean;
    permissions: string[];
    // eslint-disable-next-line camelcase
    full_access: boolean;
}

export interface AccessOverview {
    servers: OwnedServer[];
    grants: AccessGrant[];
}

export interface AccessInput {
    servers: string[];
    permissions: string[];
    fullAccess: boolean;
}

const body = ({ servers, permissions, fullAccess }: AccessInput) => ({
    servers,
    permissions,
    // eslint-disable-next-line camelcase
    all_permissions: fullAccess,
});

export const getAccess = async (): Promise<AccessOverview> => (await http.get('/api/client/account/access')).data;

export const grantAccess = async (email: string, input: AccessInput): Promise<AccessGrant[]> =>
    (await http.post('/api/client/account/access', { email, ...body(input) })).data.grants;

export const updateAccess = async (uuid: string, input: AccessInput): Promise<AccessGrant[]> =>
    (await http.put(`/api/client/account/access/${uuid}`, body(input))).data.grants;

export const revokeAccess = (uuid: string): Promise<void> => http.delete(`/api/client/account/access/${uuid}`);
