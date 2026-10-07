import { http } from '@pterodactyl/sdk';

const ADMIN = '/api/admin/extensions/gobia-templates';

export interface Variable {
    value: string | null;
    overridable: boolean;
}

export interface TemplateSummary {
    id: number;
    uuid: string;
    name: string;
    slug: string;
    description: string | null;
    enabled: boolean;
    api_enabled: boolean;
    revision: number;
    egg: { id: number; name: string } | null;
    memory: number;
    disk: number;
    cpu: number;
    placement_mode: 'any' | 'fixed_node' | 'allowed_nodes';
    temporary: boolean;
    instances: number;
    published_at: string | null;
}

export interface TemplateDetail extends TemplateSummary {
    docker_image: string;
    startup: string | null;
    swap: number;
    io: number;
    oom_disabled: boolean;
    database_limit: number | null;
    allocation_limit: number | null;
    backup_limit: number | null;
    node_id: number | null;
    location_id: number | null;
    additional_allocations: number;
    preferred_ports: string | null;
    max_instances: number | null;
    start_automatically: boolean;
    ttl_minutes: number | null;
    allow_instance_delete: boolean;
    allowed_nodes: number[];
    variables: Record<string, Variable>;
}

export interface TemplatePayload {
    name: string;
    description: string | null;
    egg_id: number | null;
    docker_image: string;
    startup: string | null;
    memory: number | null;
    swap: number | null;
    disk: number | null;
    cpu: number | null;
    io: number | null;
    oom_disabled: boolean;
    database_limit: number | null;
    allocation_limit: number | null;
    backup_limit: number | null;
    placement_mode: 'any' | 'fixed_node' | 'allowed_nodes';
    node_id: number | null;
    allowed_nodes: number[];
    location_id: number | null;
    additional_allocations: number;
    preferred_ports: string | null;
    max_instances: number | null;
    start_automatically: boolean;
    temporary: boolean;
    ttl_minutes: number | null;
    allow_instance_delete: boolean;
    enabled: boolean;
    api_enabled: boolean;
    variables: Record<string, Variable>;
}

export interface InstanceRow {
    id: string;
    name: string;
    state: string;
    failed_stage: string | null;
    error: string | null;
    server_id: number | null;
    finished: boolean;
    created_at: string | null;
}

export interface DetailResponse {
    template: TemplateDetail;
    revisions: { revision: number; created_at: string | null }[];
    instances: InstanceRow[];
    created_revision?: boolean;
}

export interface Options {
    eggs: {
        id: number;
        name: string;
        images: string[];
        startup: string | null;
        variables: { env: string; name: string; default: string | null; rules: string }[];
    }[];
    nodes: { id: number; name: string; location_id: number }[];
    locations: { id: number; short: string }[];
    users: { id: number; username: string; email: string }[];
}

export interface FileEntry {
    path: string;
    size: number;
    type: 'file' | 'directory';
    modified: number | null;
}

export interface FilesResponse {
    data: FileEntry[];
    status: {
        dirty: boolean;
        added: number;
        modified: number;
        deleted: number;
        revision: number;
        published_at: string | null;
        working_changed_at: string | null;
    };
    limits: { max_file_bytes: number; max_total_bytes: number; max_files: number; max_edit_bytes: number };
}

export interface RevisionRow {
    revision: number;
    created_at: string | null;
    created_by: { id: number; username: string | null } | null;
    current: boolean;
    instances: number;
    summary: {
        memory: number | null;
        disk: number | null;
        cpu: number | null;
        docker_image: string | null;
        files: number;
        bytes: number;
        variables: number;
    };
    changes: string[];
}

export const keys = {
    revisions: (id: number) => ['gobia-templates', 'revisions', id] as const,
    list: ['gobia-templates', 'list'] as const,
    options: ['gobia-templates', 'options'] as const,
    detail: (id: number) => ['gobia-templates', 'detail', id] as const,
    files: (id: number) => ['gobia-templates', 'files', id] as const,
    sftp: (id: number) => ['gobia-templates', 'sftp', id] as const,
};

export const fetchList = async () => (await http.get<{ data: TemplateSummary[] }>(`${ADMIN}/templates`)).data.data;
export const fetchOptions = async () => (await http.get<Options>(`${ADMIN}/options`)).data;
export const fetchDetail = async (id: number) => (await http.get<DetailResponse>(`${ADMIN}/templates/${id}`)).data;
export const saveTemplate = async (id: number | null, body: TemplatePayload) =>
    (id === null
        ? await http.post<DetailResponse>(`${ADMIN}/templates`, body)
        : await http.patch<DetailResponse>(`${ADMIN}/templates/${id}`, body)
    ).data;
export const duplicateTemplate = async (id: number) =>
    (await http.post<DetailResponse>(`${ADMIN}/templates/${id}/duplicate`)).data;
export const toggleTemplate = async (id: number) =>
    (await http.post<{ enabled: boolean }>(`${ADMIN}/templates/${id}/toggle`)).data;
export const deleteTemplate = async (id: number) => http.delete(`${ADMIN}/templates/${id}`);
export const publishTemplate = async (id: number) =>
    (await http.post<{ revision: number; created_revision: boolean }>(`${ADMIN}/templates/${id}/publish`)).data;

export const fetchRevisions = async (id: number) =>
    (await http.get<{ data: RevisionRow[] }>(`${ADMIN}/templates/${id}/revisions`)).data.data;

export const fetchFiles = async (id: number) => (await http.get<FilesResponse>(`${ADMIN}/templates/${id}/files`)).data;
export const readFile = async (id: number, path: string) =>
    (
        await http.get<{ path: string; binary: boolean; size: number; content?: string }>(
            `${ADMIN}/templates/${id}/files/content`,
            { params: { path } }
        )
    ).data;
export const writeFile = async (id: number, path: string, content: string) =>
    http.put(`${ADMIN}/templates/${id}/files`, { path, content });
export const deleteFile = async (id: number, path: string) =>
    http.delete(`${ADMIN}/templates/${id}/files`, { data: { path } });
export const makeFolder = async (id: number, path: string) =>
    http.post(`${ADMIN}/templates/${id}/files/folder`, { path });
export const moveFile = async (id: number, from: string, to: string) =>
    http.post(`${ADMIN}/templates/${id}/files/move`, { from, to });
export const uploadFile = async (id: number, path: string, file: File, onProgress?: (fraction: number) => void) =>
    http.put(`${ADMIN}/templates/${id}/files/upload`, file, {
        params: { path },
        headers: { 'Content-Type': 'application/octet-stream' },
        onUploadProgress: (event) => onProgress?.(event.total ? event.loaded / event.total : 0),
    });
export const downloadUrl = (id: number, path: string) =>
    `${ADMIN}/templates/${id}/files/download?path=${encodeURIComponent(path)}`;

export interface SftpCredential {
    id: number;
    label: string | null;
    username: string;
    permission: 'rw' | 'ro';
    status: string;
    created_at: string | null;
    expires_at: string | null;
    last_used_at: string | null;
    last_used_ip: string | null;
}

export interface SftpResponse {
    enabled: boolean;
    host: string;
    port: number;
    max_days: number;
    credentials: SftpCredential[];
    events: { event: string; username: string | null; ip: string | null; detail: string | null; created_at: string }[];
}

export const fetchSftp = async (id: number) => (await http.get<SftpResponse>(`${ADMIN}/templates/${id}/sftp`)).data;
export const createSftp = async (
    id: number,
    body: { label?: string; permission: 'rw' | 'ro'; expires_in_days?: number }
) =>
    (
        await http.post<{
            id: number;
            username: string;
            password: string;
            permission: string;
            host: string;
            port: number;
            expires_at: string | null;
        }>(`${ADMIN}/templates/${id}/sftp`, body)
    ).data;
export const revokeSftp = async (id: number, credential: number) =>
    http.delete(`${ADMIN}/templates/${id}/sftp/${credential}`);
