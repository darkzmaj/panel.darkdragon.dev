import type { Options, TemplateDetail, TemplatePayload, Variable } from '../api';

export interface TemplateForm {
    name: string;
    description: string;
    egg_id: number | null;
    docker_image: string;
    startup: string;
    memory: string;
    swap: string;
    disk: string;
    cpu: string;
    io: string;
    oom_disabled: boolean;
    database_limit: string;
    allocation_limit: string;
    backup_limit: string;
    placement_mode: 'any' | 'fixed_node' | 'allowed_nodes';
    node_id: number | null;
    allowed_nodes: number[];
    location_id: number | null;
    additional_allocations: string;
    preferred_ports: string;
    max_instances: string;
    start_automatically: boolean;
    temporary: boolean;
    ttl_minutes: string;
    allow_instance_delete: boolean;
    enabled: boolean;
    api_enabled: boolean;
    variables: Record<string, Variable>;
}

export const EMPTY_FORM: TemplateForm = {
    name: '',
    description: '',
    egg_id: null,
    docker_image: '',
    startup: '',
    memory: '1024',
    swap: '0',
    disk: '5120',
    cpu: '0',
    io: '500',
    oom_disabled: true,
    database_limit: '0',
    allocation_limit: '0',
    backup_limit: '0',
    placement_mode: 'any',
    node_id: null,
    allowed_nodes: [],
    location_id: null,
    additional_allocations: '0',
    preferred_ports: '',
    max_instances: '',
    start_automatically: true,
    temporary: false,
    ttl_minutes: '',
    allow_instance_delete: true,
    enabled: true,
    api_enabled: false,
    variables: {},
};

const text = (value: number | string | null): string => (value === null ? '' : String(value));

export function formFromDetail(template: TemplateDetail): TemplateForm {
    return {
        name: template.name,
        description: template.description ?? '',
        egg_id: template.egg?.id ?? null,
        docker_image: template.docker_image,
        startup: template.startup ?? '',
        memory: text(template.memory),
        swap: text(template.swap),
        disk: text(template.disk),
        cpu: text(template.cpu),
        io: text(template.io),
        oom_disabled: template.oom_disabled,
        database_limit: text(template.database_limit),
        allocation_limit: text(template.allocation_limit),
        backup_limit: text(template.backup_limit),
        placement_mode: template.placement_mode,
        node_id: template.node_id,
        allowed_nodes: template.allowed_nodes,
        location_id: template.location_id,
        additional_allocations: text(template.additional_allocations),
        preferred_ports: template.preferred_ports ?? '',
        max_instances: text(template.max_instances),
        start_automatically: template.start_automatically,
        temporary: template.temporary,
        ttl_minutes: text(template.ttl_minutes),
        allow_instance_delete: template.allow_instance_delete,
        enabled: template.enabled,
        api_enabled: template.api_enabled,
        variables: template.variables,
    };
}

const toInt = (value: string): number | null => (value.trim() === '' ? null : Number(value));

/** The request body. Empty optional numbers become null so the server applies its own default. */
export function payloadFromForm(form: TemplateForm): TemplatePayload {
    return {
        name: form.name.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
        egg_id: form.egg_id,
        docker_image: form.docker_image,
        startup: form.startup.trim() === '' ? null : form.startup,
        memory: toInt(form.memory),
        swap: toInt(form.swap),
        disk: toInt(form.disk),
        cpu: toInt(form.cpu),
        io: toInt(form.io),
        oom_disabled: form.oom_disabled,
        database_limit: toInt(form.database_limit),
        allocation_limit: toInt(form.allocation_limit),
        backup_limit: toInt(form.backup_limit),
        placement_mode: form.placement_mode,
        node_id: form.placement_mode === 'fixed_node' ? form.node_id : null,
        allowed_nodes: form.placement_mode === 'allowed_nodes' ? form.allowed_nodes : [],
        location_id: form.location_id,
        additional_allocations: toInt(form.additional_allocations) ?? 0,
        preferred_ports: form.preferred_ports.trim() === '' ? null : form.preferred_ports.trim(),
        max_instances: toInt(form.max_instances),
        start_automatically: form.start_automatically,
        temporary: form.temporary,
        ttl_minutes: form.temporary ? toInt(form.ttl_minutes) : null,
        allow_instance_delete: form.allow_instance_delete,
        enabled: form.enabled,
        api_enabled: form.api_enabled,
        variables: form.variables,
    };
}

/** When the software changes, keep only variables the new egg knows, and fall back to a valid image. */
export function applyEgg(form: TemplateForm, eggId: number, options: Options): TemplateForm {
    const egg = options.eggs.find((item) => item.id === eggId);
    if (!egg) return { ...form, egg_id: eggId };
    const known = new Set(egg.variables.map((variable) => variable.env));
    const variables = Object.fromEntries(Object.entries(form.variables).filter(([env]) => known.has(env)));
    return {
        ...form,
        egg_id: eggId,
        docker_image: egg.images.includes(form.docker_image) ? form.docker_image : (egg.images[0] ?? ''),
        variables,
    };
}
