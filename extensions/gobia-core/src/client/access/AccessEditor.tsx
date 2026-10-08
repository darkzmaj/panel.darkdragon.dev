import { Button, Dialog, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { grantAccess, replaceAccess, accessQueryKey, type AccessData, type Grant } from './api';
import {
    CATEGORIES,
    PRESET_HINTS,
    PRESET_LABELS,
    grantableOn,
    labelOf,
    presetKeys,
    presetOf,
    toggleGroup,
    toggleKey,
    type PresetId,
} from './permissions';

interface Props {
    data: AccessData;
    /** The person being edited, or null to grant access to someone new. */
    grant: Grant | null;
    /** An instance to have ticked when the dialog opens (the old server Users address passes one). */
    initialServer?: string | null;
    onClose: () => void;
}

const FORM = 'gobia-access-form';
const ALWAYS = 'websocket.connect';

export default function AccessEditor({ data, grant, initialServer = null, onClose }: Props) {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState('');
    const [servers, setServers] = useState<string[]>(
        grant
            ? grant.servers.map((server) => server.uuid)
            : initialServer && data.servers.some((server) => server.uuid === initialServer)
              ? [initialServer]
              : []
    );
    const chosen = data.servers.filter((server) => servers.includes(server.uuid));
    const grantable = grantableOn(chosen.length > 0 ? chosen : data.servers);
    const [permissions, setPermissions] = useState<string[]>(
        grant ? grant.permissions : presetKeys('view', data.permission_groups, grantableOn(data.servers))
    );
    const [custom, setCustom] = useState(false);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const active = presetOf(permissions, data.permission_groups, grantable);

    const save = useMutation({
        mutationFn: () => {
            const final = permissions.includes(ALWAYS) ? permissions : [ALWAYS, ...permissions];
            return grant ? replaceAccess(grant.uuid, servers, final) : grantAccess(email.trim(), servers, final);
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: accessQueryKey });
            await queryClient.invalidateQueries({ queryKey: ['gobia-core', 'instances'] });
            toast.success('Access saved.');
            onClose();
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (ready) save.mutate();
    };
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const ready = (grant !== null || validEmail) && servers.length > 0;
    const allChosen = data.servers.length > 0 && servers.length === data.servers.length;

    const changeServers = (next: string[]) => {
        setServers(next);
        // Keep the selection inside what can be handed out on the chosen instances.
        const limit = grantableOn(data.servers.filter((server) => next.includes(server.uuid)));
        if (limit !== null) setPermissions((current) => current.filter((key) => key === ALWAYS || limit.includes(key)));
    };

    return (
        <Dialog
            open
            onClose={save.isPending ? () => {} : onClose}
            title={grant ? `Access for ${grant.username}` : 'Grant Access'}
            description={grant ? grant.email : 'Choose who, which instances and what they may do.'}
        >
            <form id={FORM} onSubmit={submit} noValidate style={{ display: 'grid', gap: 18, paddingBottom: 4 }}>
                {!grant && (
                    <section>
                        <label className={'gb-label'} htmlFor={'access-email'}>
                            Person
                        </label>
                        <input
                            id={'access-email'}
                            className={'gb-input'}
                            type={'email'}
                            value={email}
                            placeholder={'Email address'}
                            onChange={(event) => setEmail(event.currentTarget.value)}
                            autoComplete={'off'}
                            aria-invalid={email.trim() !== '' && !validEmail}
                        />
                        {email.trim() !== '' && !validEmail && (
                            <p role={'alert'} style={{ color: 'rgb(var(--gb-danger))', fontSize: 12, marginTop: 4 }}>
                                Enter a complete email address.
                            </p>
                        )}
                    </section>
                )}

                <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <legend className={'gb-label'} style={{ margin: 0, flex: 1 }}>
                            Instances <span className={'gb-muted'}>({servers.length} selected)</span>
                        </legend>
                        <button
                            type={'button'}
                            className={'gb-chip'}
                            disabled={allChosen}
                            onClick={() => changeServers(data.servers.map((server) => server.uuid))}
                        >
                            Select All
                        </button>
                        <button
                            type={'button'}
                            className={'gb-chip'}
                            disabled={servers.length === 0}
                            onClick={() => changeServers([])}
                        >
                            Clear Selection
                        </button>
                    </div>
                    <div className={'gb-subcard'} style={{ padding: 4, maxHeight: 168, overflowY: 'auto' }}>
                        {data.servers.map((server) => (
                            <label key={server.uuid} className={'gb-check-row'}>
                                <input
                                    type={'checkbox'}
                                    checked={servers.includes(server.uuid)}
                                    onChange={(event) =>
                                        changeServers(toggleKey(servers, server.uuid, event.currentTarget.checked))
                                    }
                                />
                                <span>{server.name}</span>
                                {!server.owned && <span className={'gb-muted'}>shared with you</span>}
                            </label>
                        ))}
                        {data.servers.length === 0 && (
                            <p className={'gb-secondary'} style={{ padding: 8, fontSize: 13 }}>
                                You have no instances you can share yet.
                            </p>
                        )}
                    </div>
                </fieldset>

                <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                    <legend className={'gb-label'}>Permissions</legend>
                    <div
                        role={'group'}
                        aria-label={'Permission presets'}
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                    >
                        {(Object.keys(PRESET_LABELS) as PresetId[]).map((preset) => (
                            <button
                                key={preset}
                                type={'button'}
                                aria-pressed={active === preset}
                                title={PRESET_HINTS[preset]}
                                className={'gb-chip' + (active === preset ? ' active' : '')}
                                onClick={() => setPermissions(presetKeys(preset, data.permission_groups, grantable))}
                            >
                                {PRESET_LABELS[preset]}
                            </button>
                        ))}
                        <span className={'gb-muted'} style={{ alignSelf: 'center', fontSize: 12 }}>
                            {active ? PRESET_HINTS[active] : 'Custom selection.'}
                        </span>
                    </div>

                    <button
                        type={'button'}
                        className={'gb-btn gb-btn-sm'}
                        aria-expanded={custom}
                        aria-controls={'access-custom'}
                        style={{ marginTop: 10 }}
                        onClick={() => setCustom((value) => !value)}
                    >
                        {custom ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />} Customize Permissions
                    </button>

                    {custom && (
                        <div id={'access-custom'} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                            {CATEGORIES.map(([title, prefix]) => {
                                const group = data.permission_groups[prefix];
                                if (!group) return null;
                                const keys = Object.keys(group.keys)
                                    .map((key) => `${prefix}.${key}`)
                                    .filter((key) => grantable === null || grantable.includes(key));
                                if (keys.length === 0) return null;
                                const selected = keys.filter((key) => permissions.includes(key)).length;
                                const expanded = open.has(prefix);
                                return (
                                    <div key={prefix} className={'gb-subcard'} style={{ padding: 0 }}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                padding: '6px 10px',
                                            }}
                                        >
                                            <input
                                                type={'checkbox'}
                                                aria-label={`All ${title} permissions`}
                                                checked={selected === keys.length}
                                                ref={(element) => {
                                                    if (element)
                                                        element.indeterminate = selected > 0 && selected < keys.length;
                                                }}
                                                onChange={(event) =>
                                                    setPermissions(
                                                        toggleGroup(
                                                            permissions,
                                                            prefix,
                                                            group,
                                                            event.currentTarget.checked,
                                                            grantable
                                                        )
                                                    )
                                                }
                                            />
                                            <button
                                                type={'button'}
                                                aria-expanded={expanded}
                                                onClick={() =>
                                                    setOpen((current) => {
                                                        const next = new Set(current);
                                                        if (!next.delete(prefix)) next.add(prefix);
                                                        return next;
                                                    })
                                                }
                                                style={{
                                                    flex: 1,
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    background: 'none',
                                                    border: 0,
                                                    color: 'var(--gb-text-strong)',
                                                    font: 'inherit',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    padding: '4px 0',
                                                }}
                                            >
                                                {title}
                                                <span className={'gb-muted'} style={{ fontWeight: 400, fontSize: 12 }}>
                                                    {selected} of {keys.length}
                                                </span>
                                            </button>
                                        </div>
                                        {expanded && (
                                            <div style={{ padding: '0 10px 6px 34px', display: 'grid' }}>
                                                {keys.map((key) => {
                                                    const label = labelOf(
                                                        key,
                                                        group.keys[key.slice(prefix.length + 1)] ?? ''
                                                    );
                                                    const locked = key === ALWAYS;
                                                    return (
                                                        <label
                                                            key={key}
                                                            className={'gb-check-row'}
                                                            style={{ alignItems: 'flex-start' }}
                                                        >
                                                            <input
                                                                type={'checkbox'}
                                                                checked={locked || permissions.includes(key)}
                                                                disabled={locked}
                                                                onChange={(event) =>
                                                                    setPermissions(
                                                                        toggleKey(
                                                                            permissions,
                                                                            key,
                                                                            event.currentTarget.checked
                                                                        )
                                                                    )
                                                                }
                                                            />
                                                            <span>
                                                                {label.title}
                                                                <span
                                                                    className={'gb-muted'}
                                                                    style={{ display: 'block', fontSize: 12 }}
                                                                >
                                                                    {label.hint}
                                                                </span>
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </fieldset>
            </form>
            <Dialog.Footer>
                <Button.Text type={'button'} onClick={onClose} disabled={save.isPending}>
                    Cancel
                </Button.Text>
                <Button type={'submit'} form={FORM} color={'primary'} isLoading={save.isPending} disabled={!ready}>
                    {grant ? 'Save Access' : 'Grant Access'}
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
}
