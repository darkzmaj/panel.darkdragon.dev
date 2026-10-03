import http from '@/api/http';

export interface TemplateSummary {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    enabled: boolean;
    revision: number;
    software: string | null;
    nest: string | null;
    memory: number;
    cpu: number;
    disk: number;
    placement: string;
    location: string | null;
    lifecycle: { start_automatically: boolean; temporary: boolean; ttl_minutes: number | null };
    tags: string[];
    instances_count: number;
    files_count: number;
    files_size: number;
}

export interface TemplateDetails extends TemplateSummary {
    proposed_name: string;
    allowed_nodes: string[];
    overridable: Array<{ env: string; name: string; description: string | null; value: string | null }>;
    files: Array<{ path: string; size: number }>;
}

export interface TemplateInstanceStatus {
    id: string;
    name: string;
    state: 'queued' | 'allocating' | 'creating' | 'installing' | 'deploying_files' | 'starting' | 'ready' | 'failed';
    finished: boolean;
    // eslint-disable-next-line camelcase
    failed_stage: string | null;
    error: string | null;
    server: string | null;
}

export interface Owner {
    id: number;
    username: string;
    email: string;
}

export const getTemplates = async (): Promise<TemplateSummary[]> => (await http.get('/api/client/templates')).data.data;

export const getTemplate = async (id: number): Promise<TemplateDetails> =>
    (await http.get(`/api/client/templates/${id}`)).data;

export const searchOwners = async (q: string): Promise<Owner[]> =>
    (await http.get('/api/client/templates/owners', { params: { q } })).data.data;

export const createTemplateInstance = async (
    id: number,
    data: { name: string; owner_id?: number; description?: string; environment?: Record<string, string> },
    idempotencyKey: string
): Promise<TemplateInstanceStatus> =>
    (await http.post(`/api/client/templates/${id}/instances`, data, { headers: { 'Idempotency-Key': idempotencyKey } }))
        .data;

export const getTemplateInstance = async (id: number, instance: string): Promise<TemplateInstanceStatus> =>
    (await http.get(`/api/client/templates/${id}/instances/${instance}`)).data;
