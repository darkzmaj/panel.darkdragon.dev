import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Layers, LayoutTemplate, SlidersHorizontal } from 'lucide-react';
import { useStoreState } from 'easy-peasy';
import { v4 } from 'uuid';
import { ApplicationStore } from '@/state';
import Modal from '@/components/elements/Modal';
import { httpErrorToHuman } from '@/api/http';
import { bytesToString, mbToBytes } from '@/lib/formatters';
import {
    createTemplateInstance,
    getTemplate,
    getTemplateInstance,
    getTemplates,
    Owner,
    searchOwners,
    TemplateDetails,
    TemplateInstanceStatus,
    TemplateSummary,
} from '@/api/templates';

type Step = 'choose' | 'templates' | 'configure' | 'progress';

interface Props {
    visible: boolean;
    onClose: () => void;
    // Called once an instance created from a template is ready (the dashboard refreshes its list).
    onCreated: () => void;
}

const STAGES: Array<[TemplateInstanceStatus['state'], string]> = [
    ['queued', 'Queued'],
    ['allocating', 'Choosing a node'],
    ['creating', 'Creating the instance'],
    ['installing', 'Installing the software'],
    ['deploying_files', 'Deploying template files'],
    ['starting', 'Starting'],
    ['ready', 'Ready'],
];

const resources = (t: TemplateSummary) =>
    [
        t.memory ? bytesToString(mbToBytes(t.memory)) + ' RAM' : 'Unlimited RAM',
        t.cpu ? `${t.cpu}% CPU` : 'Unlimited CPU',
        t.disk ? bytesToString(mbToBytes(t.disk)) + ' disk' : 'Unlimited disk',
    ].join(' · ');

const lifecycle = (t: TemplateSummary) =>
    [
        t.lifecycle.temporary
            ? `Temporary${t.lifecycle.ttl_minutes ? ` (${t.lifecycle.ttl_minutes} min)` : ''}`
            : 'Persistent',
        t.lifecycle.start_automatically ? 'starts automatically' : 'starts manually',
    ].join(', ');

// "Create Instance": first a choice between building one by hand (Custom) and deploying a reusable Template.
export default ({ visible, onClose, onCreated }: Props) => {
    const [step, setStep] = useState<Step>('choose');
    const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<TemplateDetails | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const me = useStoreState((state: ApplicationStore) => state.user.data!);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [owner, setOwner] = useState<Owner>({ id: 0, username: me.username, email: me.email });
    const [ownerQuery, setOwnerQuery] = useState('');
    const [owners, setOwners] = useState<Owner[]>([]);
    const [environment, setEnvironment] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<TemplateInstanceStatus | null>(null);
    // One key per attempt: if the request is sent twice (a double click, a retry) only one instance is created.
    const idempotency = useRef(v4());

    useEffect(() => {
        if (!visible) return;
        setStep('choose');
        setError(null);
        setSelected(null);
        setStatus(null);
        idempotency.current = v4();
    }, [visible]);

    useEffect(() => {
        if (step !== 'templates' || templates) return;
        getTemplates()
            .then(setTemplates)
            .catch((e) => setError(httpErrorToHuman(e)));
    }, [step]);

    useEffect(() => {
        if (step !== 'configure') return;
        const handle = setTimeout(
            () =>
                searchOwners(ownerQuery)
                    .then(setOwners)
                    .catch(() => setOwners([])),
            200
        );

        return () => clearTimeout(handle);
    }, [step, ownerQuery]);

    // Follow the provisioning job until it is ready or failed.
    useEffect(() => {
        if (step !== 'progress' || !selected || !status || status.finished) return;
        const handle = setTimeout(() => {
            getTemplateInstance(selected.id, status.id)
                .then((fresh) => {
                    setStatus(fresh);
                    if (fresh.state === 'ready') onCreated();
                })
                .catch((e) => setError(httpErrorToHuman(e)));
        }, 1500);

        return () => clearTimeout(handle);
    }, [step, status]);

    const filtered = useMemo(
        () =>
            (templates || []).filter((t) =>
                (t.name + ' ' + (t.description || '') + ' ' + t.tags.join(' '))
                    .toLowerCase()
                    .includes(query.toLowerCase())
            ),
        [templates, query]
    );

    const choose = (template: TemplateSummary) => {
        setBusy(true);
        setError(null);
        getTemplate(template.id)
            .then((details) => {
                setSelected(details);
                setName(details.proposed_name);
                setDescription('');
                setOwner({ id: 0, username: me.username, email: me.email });
                setOwnerQuery('');
                setEnvironment(Object.fromEntries(details.overridable.map((v) => [v.env, v.value || ''])));
                idempotency.current = v4();
                setStep('configure');
            })
            .catch((e) => setError(httpErrorToHuman(e)))
            .then(() => setBusy(false));
    };

    const create = () => {
        if (!selected) return;
        setBusy(true);
        setError(null);

        const changed = Object.fromEntries(
            selected.overridable
                .filter((v) => environment[v.env] !== (v.value || ''))
                .map((v) => [v.env, environment[v.env]])
        );
        createTemplateInstance(
            selected.id,
            {
                name: name.trim(),
                // 0 means "me": the server resolves it to the signed in administrator.
                owner_id: owner.id || undefined,
                description: description.trim() || undefined,
                environment: Object.keys(changed).length ? changed : undefined,
            },
            idempotency.current
        )
            .then((created) => {
                setStatus(created);
                setStep('progress');
            })
            .catch((e) => setError(httpErrorToHuman(e)))
            .then(() => setBusy(false));
    };

    const stageIndex = status ? STAGES.findIndex(([state]) => state === status.state) : -1;

    return (
        <Modal visible={visible} onDismissed={onClose} dismissable closeOnEscape>
            {error && (
                <p
                    role={'alert'}
                    className={'gb-badge gb-badge-danger'}
                    style={{
                        height: 'auto',
                        padding: '8px 12px',
                        textTransform: 'none',
                        letterSpacing: 0,
                        marginBottom: 12,
                        whiteSpace: 'normal',
                    }}
                >
                    {error}
                </p>
            )}

            {step === 'choose' && (
                <>
                    <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                        Create Instance
                    </h3>
                    <p className={'gb-card-sub'} style={{ marginBottom: 18 }}>
                        How would you like to create this instance?
                    </p>
                    <a href={'/admin/servers/new'} className={'gb-option'} style={{ textDecoration: 'none' }}>
                        <span className={'gb-file-icon'}>
                            <SlidersHorizontal aria-hidden />
                        </span>
                        <span>
                            <strong>Custom</strong>
                            <span>Configure everything manually.</span>
                        </span>
                    </a>
                    <button type={'button'} className={'gb-option'} onClick={() => setStep('templates')}>
                        <span className={'gb-file-icon'}>
                            <LayoutTemplate aria-hidden />
                        </span>
                        <span>
                            <strong>Template</strong>
                            <span>Deploy using a reusable template.</span>
                        </span>
                    </button>
                </>
            )}

            {step === 'templates' && (
                <>
                    <button
                        type={'button'}
                        className={'gb-btn gb-btn-ghost gb-btn-sm'}
                        onClick={() => setStep('choose')}
                        style={{ marginBottom: 8, marginLeft: -8 }}
                    >
                        <ArrowLeft aria-hidden /> Back
                    </button>
                    <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                        Choose a template
                    </h3>
                    <p className={'gb-card-sub'} style={{ marginBottom: 14 }}>
                        Each template fixes the software, resources, placement and files of the new instance.
                    </p>
                    <input
                        className={'gb-input'}
                        placeholder={'Search templates'}
                        aria-label={'Search templates'}
                        value={query}
                        onChange={(e) => setQuery(e.currentTarget.value)}
                    />
                    <div className={'gb-template-grid'}>
                        {!templates &&
                            !error &&
                            [0, 1].map((i) => <div key={i} className={'gb-skeleton'} style={{ height: 150 }} />)}
                        {templates && filtered.length === 0 && (
                            <p
                                className={'gb-muted'}
                                style={{ gridColumn: '1 / -1', padding: 16, textAlign: 'center' }}
                            >
                                {templates.length === 0
                                    ? 'No templates yet. Create one under Network, Templates in the admin area.'
                                    : 'No template matches your search.'}
                            </p>
                        )}
                        {filtered.map((t) => (
                            <div key={t.id} className={'gb-template-card' + (t.enabled ? '' : ' disabled')}>
                                <div
                                    style={{
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'baseline',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <strong>{t.name}</strong>
                                    <span className={'gb-badge'}>r{t.revision}</span>
                                </div>
                                <p className={'gb-secondary'} style={{ margin: '4px 0 10px', fontSize: 13 }}>
                                    {t.description || 'No description.'}
                                </p>
                                <div className={'gb-tags'}>
                                    {t.tags.map((tag) => (
                                        <span key={tag} className={'gb-badge'}>
                                            {tag}
                                        </span>
                                    ))}
                                    {!t.enabled && <span className={'gb-badge gb-badge-warning'}>Disabled</span>}
                                </div>
                                <dl className={'gb-facts'}>
                                    <div>
                                        <dt>Resources</dt>
                                        <dd>{resources(t)}</dd>
                                    </div>
                                    <div>
                                        <dt>Placement</dt>
                                        <dd>{t.placement}</dd>
                                    </div>
                                    <div>
                                        <dt>Lifecycle</dt>
                                        <dd>{lifecycle(t)}</dd>
                                    </div>
                                    <div>
                                        <dt>Used</dt>
                                        <dd>
                                            {t.instances_count} instance{t.instances_count === 1 ? '' : 's'}
                                        </dd>
                                    </div>
                                </dl>
                                <button
                                    type={'button'}
                                    className={'gb-btn gb-btn-primary gb-btn-sm gb-btn-block'}
                                    disabled={!t.enabled || busy}
                                    onClick={() => choose(t)}
                                >
                                    Select
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {step === 'configure' && selected && (
                <>
                    <button
                        type={'button'}
                        className={'gb-btn gb-btn-ghost gb-btn-sm'}
                        onClick={() => setStep('templates')}
                        style={{ marginBottom: 8, marginLeft: -8 }}
                    >
                        <ArrowLeft aria-hidden /> Templates
                    </button>
                    <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                        {selected.name}
                    </h3>
                    <p className={'gb-card-sub'} style={{ marginBottom: 16 }}>
                        Revision {selected.revision}. Only the values below can be changed; everything else comes from
                        the template.
                    </p>
                    <label className={'gb-label'} htmlFor={'ci-name'}>
                        Name
                    </label>
                    <input
                        id={'ci-name'}
                        className={'gb-input'}
                        value={name}
                        maxLength={191}
                        onChange={(e) => setName(e.currentTarget.value)}
                    />
                    <p className={'gb-hint'}>Proposed from the template. You can edit it before creating.</p>

                    <label className={'gb-label'} htmlFor={'ci-owner'} style={{ marginTop: 10 }}>
                        Owner
                    </label>
                    <input
                        id={'ci-owner'}
                        className={'gb-input'}
                        list={'ci-owners'}
                        placeholder={`${owner.username} (${owner.email})`}
                        value={ownerQuery}
                        onChange={(e) => {
                            const value = e.currentTarget.value;
                            setOwnerQuery(value);
                            const match = owners.find((o) => `${o.username} (${o.email})` === value);
                            if (match) setOwner(match);
                        }}
                    />
                    <datalist id={'ci-owners'}>
                        {owners.map((o) => (
                            <option key={o.id} value={`${o.username} (${o.email})`} />
                        ))}
                    </datalist>
                    <p className={'gb-hint'}>Owner: {owner.username}. Type to search for someone else.</p>

                    <label className={'gb-label'} htmlFor={'ci-desc'} style={{ marginTop: 10 }}>
                        Description
                    </label>
                    <input
                        id={'ci-desc'}
                        className={'gb-input'}
                        value={description}
                        maxLength={255}
                        onChange={(e) => setDescription(e.currentTarget.value)}
                    />

                    {selected.overridable.map((v) => (
                        <div key={v.env} style={{ marginTop: 10 }}>
                            <label className={'gb-label'} htmlFor={`ci-${v.env}`}>
                                {v.name}
                            </label>
                            <input
                                id={`ci-${v.env}`}
                                className={'gb-input'}
                                value={environment[v.env] ?? ''}
                                onChange={(e) => setEnvironment({ ...environment, [v.env]: e.currentTarget.value })}
                            />
                            {v.description && <p className={'gb-hint'}>{v.description}</p>}
                        </div>
                    ))}

                    <div className={'gb-subcard'} style={{ marginTop: 18 }}>
                        <dl className={'gb-facts'} style={{ margin: 0 }}>
                            <div>
                                <dt>Software</dt>
                                <dd>{selected.software}</dd>
                            </div>
                            <div>
                                <dt>Resources</dt>
                                <dd>{resources(selected)}</dd>
                            </div>
                            <div>
                                <dt>Placement</dt>
                                <dd>
                                    {selected.placement}
                                    {selected.allowed_nodes.length > 0 && ` (${selected.allowed_nodes.join(', ')})`}
                                    {selected.location && ` · ${selected.location}`}
                                </dd>
                            </div>
                            <div>
                                <dt>Lifecycle</dt>
                                <dd>{lifecycle(selected)}</dd>
                            </div>
                            <div>
                                <dt>Files</dt>
                                <dd>
                                    {selected.files_count === 0
                                        ? 'None'
                                        : `${selected.files_count} file${
                                              selected.files_count === 1 ? '' : 's'
                                          } (${bytesToString(selected.files_size)}) deployed before the first start`}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                        <button type={'button'} className={'gb-btn'} onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type={'button'}
                            className={'gb-btn gb-btn-primary'}
                            disabled={busy || !name.trim()}
                            onClick={create}
                        >
                            Create Instance
                        </button>
                    </div>
                </>
            )}

            {step === 'progress' && status && (
                <>
                    <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                        {status.state === 'ready'
                            ? 'Instance ready'
                            : status.state === 'failed'
                            ? 'Creation failed'
                            : 'Creating instance'}
                    </h3>
                    <p className={'gb-card-sub'} style={{ marginBottom: 16 }}>
                        {status.name}
                    </p>
                    {status.state === 'failed' ? (
                        <p
                            role={'alert'}
                            className={'gb-badge gb-badge-danger'}
                            style={{
                                height: 'auto',
                                padding: '10px 12px',
                                textTransform: 'none',
                                letterSpacing: 0,
                                whiteSpace: 'normal',
                            }}
                        >
                            Failed while {status.failed_stage ? status.failed_stage.replace('_', ' ') : 'provisioning'}:{' '}
                            {status.error}
                        </p>
                    ) : (
                        <ol className={'gb-steps'}>
                            {STAGES.map(([state, label], index) => (
                                <li
                                    key={state}
                                    className={
                                        index < stageIndex || status.state === 'ready'
                                            ? 'done'
                                            : index === stageIndex
                                            ? 'active'
                                            : ''
                                    }
                                >
                                    <span>
                                        {index < stageIndex || status.state === 'ready' ? (
                                            <Check aria-hidden />
                                        ) : (
                                            <Layers aria-hidden />
                                        )}
                                    </span>
                                    {label}
                                </li>
                            ))}
                        </ol>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                        <button type={'button'} className={'gb-btn'} onClick={onClose}>
                            Close
                        </button>
                        {status.state === 'ready' && status.server && (
                            <a className={'gb-btn gb-btn-primary'} href={`/server/${status.server}`}>
                                Open instance
                            </a>
                        )}
                    </div>
                </>
            )}
        </Modal>
    );
};
