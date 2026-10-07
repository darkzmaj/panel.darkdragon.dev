import { Dialog, PanelLink, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Layers, LayoutTemplate, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes } from '../dashboard/format';
import {
    createInstance,
    fetchInstance,
    fetchTemplate,
    fetchTemplates,
    searchOwners,
    type BrowserTemplate,
    type InstanceRequest,
    type TemplateDetails,
} from './api';
import { stageStatuses } from './stages';

type Step =
    | { kind: 'choose' }
    | { kind: 'browse' }
    | { kind: 'confirm'; template: BrowserTemplate }
    | { kind: 'progress'; template: BrowserTemplate; instance: string };

const resources = (t: Pick<BrowserTemplate, 'memory' | 'cpu' | 'disk'>) =>
    [
        t.memory ? formatBytes(t.memory * 1024 * 1024) + ' RAM' : 'Unlimited RAM',
        t.cpu ? `${t.cpu}% CPU` : 'Unlimited CPU',
        t.disk ? formatBytes(t.disk * 1024 * 1024) + ' disk' : 'Unlimited disk',
    ].join(' · ');

const lifecycle = (t: Pick<BrowserTemplate, 'lifecycle'>) =>
    [
        t.lifecycle.temporary
            ? `Temporary${t.lifecycle.ttl_minutes ? ` (${t.lifecycle.ttl_minutes} min)` : ''}`
            : 'Persistent',
        t.lifecycle.start_automatically ? 'starts automatically' : 'starts manually',
    ].join(', ');

function Back({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type={'button'}
            className={'gb-btn gb-btn-ghost gb-btn-sm'}
            onClick={onClick}
            style={{ marginBottom: 8, marginLeft: -8 }}
        >
            <ArrowLeft aria-hidden /> {label}
        </button>
    );
}

function Browser({ templates, onPick }: { templates: BrowserTemplate[]; onPick: (template: BrowserTemplate) => void }) {
    const [query, setQuery] = useState('');
    const q = query.trim().toLowerCase();
    const shown = templates.filter(
        (template) =>
            !q ||
            [template.name, template.software, template.description ?? '', ...template.tags]
                .join(' ')
                .toLowerCase()
                .includes(q)
    );

    return (
        <div>
            <input
                className={'gb-input'}
                type={'search'}
                placeholder={'Search templates'}
                aria-label={'Search templates'}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <div className={'gb-template-grid'}>
                {shown.length === 0 && (
                    <p className={'gb-muted'} style={{ gridColumn: '1 / -1', padding: 16, textAlign: 'center' }}>
                        {templates.length === 0
                            ? 'No templates yet. Create one under Network, Templates in the admin area.'
                            : 'No template matches your search.'}
                    </p>
                )}
                {shown.map((template) => (
                    <div key={template.id} className={'gb-template-card'}>
                        <div
                            style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}
                        >
                            <strong>{template.name}</strong>
                            <span className={'gb-badge'}>r{template.revision}</span>
                        </div>
                        <p className={'gb-secondary'} style={{ margin: '4px 0 10px', fontSize: 13 }}>
                            {template.description || 'No description.'}
                        </p>
                        <div className={'gb-tags'}>
                            {template.tags.map((tag) => (
                                <span key={tag} className={'gb-badge'}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <dl className={'gb-facts'}>
                            <div>
                                <dt>Resources</dt>
                                <dd>{resources(template)}</dd>
                            </div>
                            <div>
                                <dt>Placement</dt>
                                <dd>
                                    {template.placement}
                                    {template.location && ` · ${template.location}`}
                                </dd>
                            </div>
                            <div>
                                <dt>Lifecycle</dt>
                                <dd>{lifecycle(template)}</dd>
                            </div>
                        </dl>
                        <button
                            type={'button'}
                            className={'gb-btn gb-btn-primary gb-btn-sm gb-btn-block'}
                            onClick={() => onPick(template)}
                        >
                            Select
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Facts({ data }: { data: TemplateDetails }) {
    return (
        <div className={'gb-subcard'} style={{ marginTop: 18, padding: 16 }}>
            <dl className={'gb-facts'} style={{ margin: 0 }}>
                <div>
                    <dt>Software</dt>
                    <dd>{data.software}</dd>
                </div>
                <div>
                    <dt>Resources</dt>
                    <dd>{resources(data)}</dd>
                </div>
                <div>
                    <dt>Placement</dt>
                    <dd>
                        {data.placement}
                        {data.location && ` · ${data.location}`}
                    </dd>
                </div>
                <div>
                    <dt>Lifecycle</dt>
                    <dd>{lifecycle(data)}</dd>
                </div>
                <div>
                    <dt>Files</dt>
                    <dd>
                        {data.files_count === 0
                            ? 'None'
                            : `${data.files_count} file${data.files_count === 1 ? '' : 's'} (${formatBytes(data.files_size)}) deployed before the first start`}
                    </dd>
                </div>
            </dl>
        </div>
    );
}

function Confirm({
    template,
    onBack,
    onClose,
    onCreated,
}: {
    template: BrowserTemplate;
    onBack: () => void;
    onClose: () => void;
    onCreated: (instance: string) => void;
}) {
    const details = useQuery({
        queryKey: ['gobia-core', 'template', template.id],
        queryFn: () => fetchTemplate(template.id),
    });
    const [name, setName] = useState<string | null>(null);
    const [description, setDescription] = useState('');
    const [ownerQuery, setOwnerQuery] = useState('');
    const [owner, setOwner] = useState<{ id: number; username: string } | null>(null);
    const [environment, setEnvironment] = useState<Record<string, string>>({});
    const key = useRef(crypto.randomUUID());
    const owners = useQuery({
        queryKey: ['gobia-core', 'owners', ownerQuery],
        queryFn: () => searchOwners(ownerQuery),
        enabled: ownerQuery.trim().length > 0,
    });

    const create = useMutation({
        mutationFn: () => {
            const data = details.data;
            if (!data) throw new Error('Template details are not loaded.');
            const body: InstanceRequest = { name: (name ?? data.proposed_name).trim() };
            if (owner) body.owner_id = owner.id;
            if (description.trim()) body.description = description.trim();
            if (Object.keys(environment).length) body.environment = environment;
            return createInstance(template.id, body, key.current);
        },
        onSuccess: (instance) => onCreated(instance.id),
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    if (details.isPending) return <div className={'gb-skeleton'} style={{ height: 220 }} />;
    if (details.isError) {
        return (
            <p role={'alert'} className={'gb-badge gb-badge-danger'}>
                This template could not be loaded.
            </p>
        );
    }
    const data = details.data;
    const shownName = name ?? data.proposed_name;

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                // An empty owner means "me": the server fills in the signed in administrator.
                create.mutate();
            }}
        >
            <Back label={'Templates'} onClick={onBack} />
            <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                {data.name}
            </h3>
            <p className={'gb-card-sub'} style={{ marginBottom: 16 }}>
                Revision {data.revision}. Only the values below can be changed; everything else comes from the template.
            </p>
            <label className={'gb-label'} htmlFor={'gb-ci-name'}>
                Name
            </label>
            <input
                id={'gb-ci-name'}
                className={'gb-input'}
                value={shownName}
                maxLength={191}
                onChange={(event) => setName(event.currentTarget.value)}
            />
            <p className={'gb-hint'}>Proposed from the template. You can edit it before creating.</p>

            <label className={'gb-label'} htmlFor={'gb-ci-owner'} style={{ marginTop: 10 }}>
                Owner
            </label>
            <input
                id={'gb-ci-owner'}
                className={'gb-input'}
                placeholder={owner ? owner.username : 'You, unless you pick someone else'}
                value={ownerQuery}
                onChange={(event) => setOwnerQuery(event.currentTarget.value)}
            />
            {owners.data && owners.data.length > 0 && (
                <ul className={'gb-menu'} style={{ marginTop: 6, maxHeight: 160, overflowY: 'auto', width: '100%' }}>
                    {owners.data.map((user) => (
                        <li key={user.id} style={{ listStyle: 'none' }}>
                            <button
                                type={'button'}
                                className={'gb-menu-item'}
                                onClick={() => {
                                    setOwner(user);
                                    setOwnerQuery('');
                                }}
                            >
                                {user.username} <span className={'gb-muted'}>{user.email}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <p className={'gb-hint'}>Owner: {owner ? owner.username : 'you'}. Type to search for someone else.</p>

            <label className={'gb-label'} htmlFor={'gb-ci-desc'} style={{ marginTop: 10 }}>
                Description
            </label>
            <input
                id={'gb-ci-desc'}
                className={'gb-input'}
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.currentTarget.value)}
            />

            {data.overridable.map((variable) => (
                <div key={variable.env} style={{ marginTop: 10 }}>
                    <label className={'gb-label'} htmlFor={`gb-ci-${variable.env}`}>
                        {variable.name}
                    </label>
                    <input
                        id={`gb-ci-${variable.env}`}
                        className={'gb-input'}
                        value={environment[variable.env] ?? variable.value ?? ''}
                        onChange={(event) =>
                            setEnvironment({ ...environment, [variable.env]: event.currentTarget.value })
                        }
                    />
                    {variable.description && <p className={'gb-hint'}>{variable.description}</p>}
                </div>
            ))}

            <Facts data={data} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type={'button'} className={'gb-btn'} onClick={onClose}>
                    Cancel
                </button>
                <button
                    type={'submit'}
                    className={'gb-btn gb-btn-primary'}
                    disabled={create.isPending || !shownName.trim()}
                >
                    Create Instance
                </button>
            </div>
        </form>
    );
}

function Progress({ template, instance, onDone }: { template: BrowserTemplate; instance: string; onDone: () => void }) {
    const status = useQuery({
        queryKey: ['gobia-core', 'instance', instance],
        queryFn: () => fetchInstance(template.id, instance),
        refetchInterval: (query) => (query.state.data?.finished ? false : 1500),
    });
    const state = status.data?.state ?? 'queued';
    const stages = stageStatuses(state, status.data?.failed_stage ?? null);

    return (
        <div aria-live={'polite'}>
            <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                {state === 'ready' ? 'Instance ready' : state === 'failed' ? 'Creation failed' : 'Creating instance'}
            </h3>
            <p className={'gb-card-sub'} style={{ marginBottom: 16 }}>
                {status.data?.name ?? template.name}
            </p>
            {state === 'failed' ? (
                <p
                    role={'alert'}
                    className={'gb-badge gb-badge-danger'}
                    style={{ height: 'auto', padding: '10px 12px' }}
                >
                    Failed while{' '}
                    {status.data?.failed_stage ? status.data.failed_stage.replace('_', ' ') : 'provisioning'}:{' '}
                    {status.data?.error ?? 'Provisioning failed.'}
                </p>
            ) : (
                <ol className={'gb-steps'}>
                    {stages.map((stage) => (
                        <li
                            key={stage.id}
                            className={stage.status === 'done' ? 'done' : stage.status === 'active' ? 'active' : ''}
                        >
                            <span>{stage.status === 'done' ? <Check aria-hidden /> : <Layers aria-hidden />}</span>
                            {stage.label}
                        </li>
                    ))}
                </ol>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button type={'button'} className={'gb-btn'} onClick={onDone}>
                    {status.data?.finished ? 'Close' : 'Continue in the background'}
                </button>
                {state === 'ready' && status.data?.server && (
                    <PanelLink
                        destination={{ to: '/server/$id', params: { id: status.data.server } }}
                        onClick={onDone}
                        className={'gb-btn gb-btn-primary'}
                    >
                        Open instance
                    </PanelLink>
                )}
            </div>
        </div>
    );
}

/** Create Instance, then Custom or Template. Custom is the panel's own form; Template browses, confirms and follows provisioning. */
export default function CreateInstanceDialog({ onClose }: { onClose: () => void }) {
    const [step, setStep] = useState<Step>({ kind: 'choose' });
    const templates = useQuery({ queryKey: ['gobia-core', 'templates'], queryFn: fetchTemplates, staleTime: 30_000 });
    const available = templates.data !== null && templates.data !== undefined && templates.data.length > 0;

    return (
        <Dialog
            open
            onClose={onClose}
            title={
                step.kind === 'choose' ? 'Create Instance' : step.kind === 'browse' ? 'Choose a template' : undefined
            }
            description={
                step.kind === 'choose'
                    ? 'How would you like to create this instance?'
                    : step.kind === 'browse'
                      ? 'Each template fixes the software, resources, placement and files of the new instance.'
                      : undefined
            }
        >
            {step.kind === 'choose' && (
                <div style={{ paddingBottom: 4 }}>
                    <PanelLink
                        destination={{ to: '/panel/servers/new' }}
                        onClick={onClose}
                        className={'gb-option'}
                        style={{ textDecoration: 'none' }}
                    >
                        <span className={'gb-file-icon'}>
                            <SlidersHorizontal aria-hidden />
                        </span>
                        <span>
                            <strong>Custom</strong>
                            <span>Configure everything manually.</span>
                        </span>
                    </PanelLink>
                    <button
                        type={'button'}
                        className={'gb-option'}
                        disabled={!available}
                        onClick={() => setStep({ kind: 'browse' })}
                    >
                        <span className={'gb-file-icon'}>
                            <LayoutTemplate aria-hidden />
                        </span>
                        <span>
                            <strong>Template</strong>
                            <span>
                                {templates.isPending
                                    ? 'Checking templates.'
                                    : available
                                      ? 'Deploy using a reusable template.'
                                      : 'No enabled templates yet.'}
                            </span>
                        </span>
                    </button>
                </div>
            )}
            {step.kind === 'browse' && templates.data && (
                <div style={{ paddingBottom: 4 }}>
                    <Back label={'Back'} onClick={() => setStep({ kind: 'choose' })} />
                    <Browser templates={templates.data} onPick={(template) => setStep({ kind: 'confirm', template })} />
                </div>
            )}
            {step.kind === 'confirm' && (
                <Confirm
                    template={step.template}
                    onBack={() => setStep({ kind: 'browse' })}
                    onClose={onClose}
                    onCreated={(instance) => setStep({ kind: 'progress', template: step.template, instance })}
                />
            )}
            {step.kind === 'progress' && (
                <Progress template={step.template} instance={step.instance} onDone={onClose} />
            )}
        </Dialog>
    );
}
