import { Button, Dialog, PanelLink, Spinner, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery } from '@tanstack/react-query';
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
} from './api';
import { progressPercent, stageStatuses } from './stages';

const input =
    'gb:w-full gb:rounded-md gb:border gb:border-input gb:bg-background gb:px-3 gb:py-2 gb:text-sm gb:text-foreground';

type Step =
    | { kind: 'choose' }
    | { kind: 'browse' }
    | { kind: 'confirm'; template: BrowserTemplate }
    | { kind: 'progress'; template: BrowserTemplate; instance: string };

function Choice({
    title,
    description,
    onClick,
    disabled,
    hint,
}: {
    title: string;
    description: string;
    onClick?: () => void;
    disabled?: boolean;
    hint?: string;
}) {
    return (
        <button
            type={'button'}
            disabled={disabled}
            onClick={onClick}
            className={
                'gb:flex gb:flex-1 gb:flex-col gb:items-start gb:gap-1 gb:rounded-lg gb:border gb:border-border gb:bg-card gb:p-4 gb:text-left gb:transition-colors gb:hover:bg-secondary gb:disabled:cursor-not-allowed gb:disabled:opacity-50'
            }
        >
            <span className={'gb:font-semibold'}>{title}</span>
            <span className={'gb:text-sm gb:text-muted-foreground'}>{description}</span>
            {hint && <span className={'gb:text-xs gb:text-warning'}>{hint}</span>}
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
        <div className={'gb:flex gb:flex-col gb:gap-3'}>
            <input
                type={'search'}
                aria-label={'Search templates'}
                placeholder={'Search templates'}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className={input}
            />
            <ul className={'gb:grid gb:max-h-[55vh] gb:gap-3 gb:overflow-y-auto gb:pr-1 gb:sm:grid-cols-2'}>
                {shown.map((template) => (
                    <li key={template.id}>
                        <button
                            type={'button'}
                            onClick={() => onPick(template)}
                            className={
                                'gb:flex gb:h-full gb:w-full gb:flex-col gb:gap-2 gb:rounded-lg gb:border gb:border-border gb:bg-card gb:p-3 gb:text-left gb:hover:bg-secondary'
                            }
                        >
                            <span className={'gb:flex gb:items-baseline gb:justify-between gb:gap-2'}>
                                <span className={'gb:font-semibold'}>{template.name}</span>
                                <span className={'gb:text-xs gb:text-muted-foreground'}>rev {template.revision}</span>
                            </span>
                            {template.description && (
                                <span className={'gb:line-clamp-2 gb:text-xs gb:text-muted-foreground'}>
                                    {template.description}
                                </span>
                            )}
                            <span className={'gb:text-xs'}>
                                {template.software} · {formatBytes(template.memory * 1024 * 1024)} RAM ·{' '}
                                {formatBytes(template.disk * 1024 * 1024)} disk ·{' '}
                                {template.cpu === 0 ? 'unlimited CPU' : `${template.cpu}% CPU`}
                            </span>
                            <span className={'gb:text-xs gb:text-muted-foreground'}>
                                {template.placement}
                                {template.location && ` · ${template.location}`} ·{' '}
                                {template.lifecycle.temporary ? 'Temporary' : 'Persistent'}
                            </span>
                            <span className={'gb:flex gb:flex-wrap gb:gap-1'}>
                                {template.tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className={
                                            'gb:rounded-full gb:bg-secondary gb:px-2 gb:py-0.5 gb:text-[11px] gb:text-secondary-foreground'
                                        }
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </span>
                        </button>
                    </li>
                ))}
                {shown.length === 0 && <li className={'gb:text-sm gb:text-muted-foreground'}>No templates match.</li>}
            </ul>
        </div>
    );
}

function Confirm({
    template,
    onBack,
    onCreated,
}: {
    template: BrowserTemplate;
    onBack: () => void;
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

    if (details.isPending) return <Spinner centered />;
    if (details.isError) return <p className={'gb:text-sm gb:text-destructive'}>This template could not be loaded.</p>;
    const data = details.data;

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                // An empty owner means "me": the server fills in the signed in administrator.
                create.mutate();
            }}
            className={'gb:flex gb:max-h-[60vh] gb:flex-col gb:gap-4 gb:overflow-y-auto gb:pr-1'}
        >
            <div className={'gb:rounded-lg gb:border gb:border-border gb:p-3 gb:text-sm'}>
                <p className={'gb:font-medium'}>
                    {data.name} · revision {data.revision}
                </p>
                <p className={'gb:text-xs gb:text-muted-foreground'}>
                    {data.software} · {formatBytes(data.memory * 1024 * 1024)} RAM ·{' '}
                    {formatBytes(data.disk * 1024 * 1024)} disk · {data.placement}
                    {data.files_count > 0 && ` · ${data.files_count} files (${formatBytes(data.files_size)}) deployed`}
                </p>
            </div>
            <label className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                Instance name
                <input
                    value={name ?? data.proposed_name}
                    maxLength={191}
                    onChange={(event) => setName(event.currentTarget.value)}
                    className={input}
                />
            </label>
            <label className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                Description (optional)
                <input
                    value={description}
                    maxLength={500}
                    onChange={(event) => setDescription(event.currentTarget.value)}
                    className={input}
                />
            </label>
            <div className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                <label htmlFor={'gobia-owner'}>
                    Owner {owner ? `: ${owner.username}` : '(you, unless you pick someone else)'}
                </label>
                <input
                    id={'gobia-owner'}
                    placeholder={'Search users'}
                    value={ownerQuery}
                    onChange={(event) => setOwnerQuery(event.currentTarget.value)}
                    className={input}
                />
                {owners.data && owners.data.length > 0 && (
                    <ul className={'gb:max-h-32 gb:overflow-y-auto gb:rounded-md gb:border gb:border-border'}>
                        {owners.data.map((user) => (
                            <li key={user.id}>
                                <button
                                    type={'button'}
                                    onClick={() => {
                                        setOwner(user);
                                        setOwnerQuery('');
                                    }}
                                    className={
                                        'gb:w-full gb:px-3 gb:py-1.5 gb:text-left gb:text-sm gb:hover:bg-secondary'
                                    }
                                >
                                    {user.username}{' '}
                                    <span className={'gb:text-xs gb:text-muted-foreground'}>{user.email}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {data.overridable.length > 0 && (
                <fieldset className={'gb:flex gb:flex-col gb:gap-3'}>
                    <legend className={'gb:mb-1 gb:text-sm gb:font-medium'}>Options</legend>
                    {data.overridable.map((variable) => (
                        <label key={variable.env} className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                            {variable.name}
                            <input
                                value={environment[variable.env] ?? variable.value ?? ''}
                                onChange={(event) =>
                                    setEnvironment({ ...environment, [variable.env]: event.currentTarget.value })
                                }
                                className={input}
                            />
                            {variable.description && (
                                <span className={'gb:text-xs gb:text-muted-foreground'}>{variable.description}</span>
                            )}
                        </label>
                    ))}
                </fieldset>
            )}
            <Dialog.Footer>
                <Button.Text type={'button'} onClick={onBack} disabled={create.isPending}>
                    Back
                </Button.Text>
                <Button type={'submit'} color={'primary'} isLoading={create.isPending} disabled={create.isPending}>
                    Create instance
                </Button>
            </Dialog.Footer>
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
        <div className={'gb:flex gb:flex-col gb:gap-4'} aria-live={'polite'}>
            <p className={'gb:text-sm'}>
                Creating <span className={'gb:font-medium'}>{status.data?.name ?? 'your instance'}</span> from{' '}
                {template.name}.
            </p>
            <progress
                max={100}
                value={progressPercent(state)}
                aria-label={'Provisioning progress'}
                className={'gb:w-full'}
            />
            <ol className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                {stages.map((stage) => (
                    <li
                        key={stage.id}
                        className={
                            stage.status === 'failed'
                                ? 'gb:text-destructive'
                                : stage.status === 'pending'
                                  ? 'gb:text-muted-foreground'
                                  : ''
                        }
                    >
                        <span aria-hidden>
                            {stage.status === 'done'
                                ? '✓'
                                : stage.status === 'active'
                                  ? '…'
                                  : stage.status === 'failed'
                                    ? '✕'
                                    : '·'}{' '}
                        </span>
                        {stage.label}
                    </li>
                ))}
            </ol>
            {state === 'failed' && (
                <p className={'gb:rounded-md gb:border gb:border-destructive gb:p-3 gb:text-sm gb:text-destructive'}>
                    {status.data?.error ?? 'Provisioning failed.'}
                </p>
            )}
            <Dialog.Footer>
                {state === 'ready' && status.data?.server ? (
                    <PanelLink
                        destination={{ to: '/server/$id', params: { id: status.data.server } }}
                        onClick={onDone}
                        className={
                            'gb:rounded-md gb:bg-primary gb:px-3 gb:py-2 gb:text-sm gb:font-medium gb:text-primary-foreground gb:no-underline'
                        }
                    >
                        Open instance
                    </PanelLink>
                ) : (
                    <Button.Text type={'button'} onClick={onDone}>
                        {status.data?.finished ? 'Close' : 'Continue in the background'}
                    </Button.Text>
                )}
            </Dialog.Footer>
        </div>
    );
}

/** Create Instance, then Custom or Template. Custom is the panel's own form; Template browses, confirms and follows provisioning. */
export default function CreateInstanceDialog({ onClose }: { onClose: () => void }) {
    const [step, setStep] = useState<Step>({ kind: 'choose' });
    const templates = useQuery({ queryKey: ['gobia-core', 'templates'], queryFn: fetchTemplates, staleTime: 30_000 });
    const available = templates.data !== null && templates.data !== undefined && templates.data.length > 0;

    const title =
        step.kind === 'choose'
            ? 'Create instance'
            : step.kind === 'browse'
              ? 'Choose a template'
              : step.kind === 'confirm'
                ? `New instance from ${step.template.name}`
                : 'Creating your instance';

    return (
        <Dialog
            open
            onClose={step.kind === 'progress' ? onClose : onClose}
            title={title}
            description={step.kind === 'choose' ? 'Start from nothing or from a ready made template.' : undefined}
        >
            {step.kind === 'choose' && (
                <div className={'gb:flex gb:flex-col gb:gap-3 gb:sm:flex-row'}>
                    <PanelLink
                        destination={{ to: '/panel/servers/new' }}
                        onClick={onClose}
                        className={'gb:flex gb:flex-1 gb:no-underline'}
                    >
                        <span
                            className={
                                'gb:flex gb:w-full gb:flex-col gb:gap-1 gb:rounded-lg gb:border gb:border-border gb:bg-card gb:p-4 gb:hover:bg-secondary'
                            }
                        >
                            <span className={'gb:font-semibold gb:text-foreground'}>Custom</span>
                            <span className={'gb:text-sm gb:text-muted-foreground'}>
                                Choose the software, resources and node yourself.
                            </span>
                        </span>
                    </PanelLink>
                    <Choice
                        title={'Template'}
                        description={'Deploy a prepared setup with its files in one step.'}
                        disabled={!available}
                        hint={
                            templates.isPending
                                ? 'Checking templates'
                                : available
                                  ? undefined
                                  : 'No enabled templates yet'
                        }
                        onClick={() => setStep({ kind: 'browse' })}
                    />
                </div>
            )}
            {step.kind === 'browse' && templates.data && (
                <>
                    <Browser templates={templates.data} onPick={(template) => setStep({ kind: 'confirm', template })} />
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setStep({ kind: 'choose' })}>
                            Back
                        </Button.Text>
                    </Dialog.Footer>
                </>
            )}
            {step.kind === 'confirm' && (
                <Confirm
                    template={step.template}
                    onBack={() => setStep({ kind: 'browse' })}
                    onCreated={(instance) => setStep({ kind: 'progress', template: step.template, instance })}
                />
            )}
            {step.kind === 'progress' && (
                <Progress template={step.template} instance={step.instance} onDone={onClose} />
            )}
        </Dialog>
    );
}
