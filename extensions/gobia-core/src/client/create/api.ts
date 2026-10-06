import { http } from '@pterodactyl/sdk';

const BASE = '/api/client/extensions/gobia-templates';

export interface BrowserTemplate {
    id: number;
    name: string;
    description: string | null;
    revision: number;
    software: string;
    memory: number;
    cpu: number;
    disk: number;
    placement: string;
    location: string | null;
    lifecycle: { start_automatically: boolean; temporary: boolean; ttl_minutes: number | null };
    tags: string[];
    files_count: number;
    files_size: number;
}

export interface TemplateDetails extends BrowserTemplate {
    proposed_name: string;
    allowed_nodes: string[];
    overridable: { env: string; name: string; description: string | null; value: string | null }[];
    files: { path: string; size: number }[];
}

export interface InstanceState {
    id: string;
    name: string;
    state: string;
    finished: boolean;
    failed_stage: string | null;
    error: string | null;
    server: string | null;
}

export interface Owner {
    id: number;
    username: string;
    email: string;
}

/** Null when the templates extension is not installed or the user may not use it. */
export async function fetchTemplates(): Promise<BrowserTemplate[] | null> {
    try {
        return (await http.get<{ data: BrowserTemplate[] }>(`${BASE}/templates`)).data.data;
    } catch {
        return null;
    }
}

export const fetchTemplate = async (id: number) => (await http.get<TemplateDetails>(`${BASE}/templates/${id}`)).data;
export const searchOwners = async (q: string) =>
    (await http.get<{ data: Owner[] }>(`${BASE}/owners`, { params: { q } })).data.data;
export interface InstanceRequest {
    name: string;
    owner_id?: number;
    description?: string;
    environment?: Record<string, string>;
}

export const createInstance = async (id: number, body: InstanceRequest, key: string) =>
    (await http.post<InstanceState>(`${BASE}/templates/${id}/instances`, body, { headers: { 'Idempotency-Key': key } }))
        .data;
export const fetchInstance = async (templateId: number, instanceId: string) =>
    (await http.get<InstanceState>(`${BASE}/templates/${templateId}/instances/${instanceId}`)).data;
