import { Button, Dialog, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { grantAccess, replaceAccess, accessQueryKey, type AccessData, type Grant } from './api';
import { PRESET_LABELS, presetKeys, toggleGroup, toggleKey, type PresetId } from './permissions';

const inputClass =
    'gb:w-full gb:rounded-md gb:border gb:border-input gb:bg-background gb:px-3 gb:py-2 gb:text-sm gb:text-foreground';

interface Props {
    data: AccessData;
    /** The person being edited, or null to grant access to someone new. */
    grant: Grant | null;
    onClose: () => void;
}

export default function AccessEditor({ data, grant, onClose }: Props) {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState('');
    const [servers, setServers] = useState<string[]>(grant ? grant.servers.map((server) => server.uuid) : []);
    const [permissions, setPermissions] = useState<string[]>(
        grant ? grant.permissions : presetKeys('view', data.permission_groups)
    );

    const save = useMutation({
        mutationFn: () =>
            grant ? replaceAccess(grant.uuid, servers, permissions) : grantAccess(email.trim(), servers, permissions),
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
        save.mutate();
    };
    const allServers = data.servers.length > 0 && servers.length === data.servers.length;
    const ready = (grant !== null || email.trim() !== '') && servers.length > 0;

    return (
        <Dialog
            open
            onClose={save.isPending ? () => {} : onClose}
            title={grant ? `Access for ${grant.username}` : 'Grant access'}
            description={'Choose the instances you own and what this person may do on them.'}
        >
            <form
                onSubmit={submit}
                className={'gb:flex gb:max-h-[60vh] gb:flex-col gb:gap-5 gb:overflow-y-auto gb:pr-1'}
            >
                {!grant && (
                    <label className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                        Email address
                        <input
                            type={'email'}
                            value={email}
                            onChange={(event) => setEmail(event.currentTarget.value)}
                            autoComplete={'off'}
                            className={inputClass}
                        />
                    </label>
                )}

                <fieldset className={'gb:flex gb:flex-col gb:gap-1'}>
                    <legend className={'gb:mb-1 gb:text-sm gb:font-medium'}>Instances</legend>
                    <label
                        className={
                            'gb:flex gb:items-center gb:gap-3 gb:rounded-md gb:px-2 gb:py-1.5 gb:text-sm gb:hover:bg-secondary'
                        }
                    >
                        <input
                            type={'checkbox'}
                            checked={allServers}
                            onChange={(event) =>
                                setServers(event.currentTarget.checked ? data.servers.map((server) => server.uuid) : [])
                            }
                            className={'gb:size-4 gb:accent-primary'}
                        />
                        All of my instances
                    </label>
                    {data.servers.map((server) => (
                        <label
                            key={server.uuid}
                            className={
                                'gb:flex gb:items-center gb:gap-3 gb:rounded-md gb:px-2 gb:py-1.5 gb:text-sm gb:hover:bg-secondary'
                            }
                        >
                            <input
                                type={'checkbox'}
                                checked={servers.includes(server.uuid)}
                                onChange={(event) =>
                                    setServers(toggleKey(servers, server.uuid, event.currentTarget.checked))
                                }
                                className={'gb:size-4 gb:accent-primary'}
                            />
                            {server.name}
                        </label>
                    ))}
                    {data.servers.length === 0 && (
                        <p className={'gb:text-sm gb:text-muted-foreground'}>You do not own any instances yet.</p>
                    )}
                </fieldset>

                <fieldset className={'gb:flex gb:flex-col gb:gap-3'}>
                    <legend className={'gb:mb-1 gb:text-sm gb:font-medium'}>Permissions</legend>
                    <div className={'gb:flex gb:flex-wrap gb:gap-2'}>
                        {(Object.keys(PRESET_LABELS) as PresetId[]).map((preset) => (
                            <Button.Text
                                key={preset}
                                type={'button'}
                                onClick={() => setPermissions(presetKeys(preset, data.permission_groups))}
                            >
                                {PRESET_LABELS[preset]}
                            </Button.Text>
                        ))}
                    </div>
                    {Object.entries(data.permission_groups).map(([prefix, group]) => {
                        const keys = Object.keys(group.keys).map((key) => `${prefix}.${key}`);
                        if (keys.length === 0) return null;
                        const every = keys.every((key) => permissions.includes(key));
                        return (
                            <div key={prefix} className={'gb:rounded-lg gb:border gb:border-border gb:p-3'}>
                                <label className={'gb:flex gb:items-center gb:gap-3 gb:text-sm gb:font-medium'}>
                                    <input
                                        type={'checkbox'}
                                        checked={every}
                                        onChange={(event) =>
                                            setPermissions(
                                                toggleGroup(permissions, prefix, group, event.currentTarget.checked)
                                            )
                                        }
                                        className={'gb:size-4 gb:accent-primary'}
                                    />
                                    {group.description}
                                </label>
                                <div className={'gb:mt-2 gb:grid gb:gap-1 gb:pl-7 gb:sm:grid-cols-2'}>
                                    {Object.entries(group.keys).map(([key, description]) => (
                                        <label
                                            key={key}
                                            title={description}
                                            className={
                                                'gb:flex gb:items-center gb:gap-2 gb:text-xs gb:text-muted-foreground'
                                            }
                                        >
                                            <input
                                                type={'checkbox'}
                                                checked={permissions.includes(`${prefix}.${key}`)}
                                                onChange={(event) =>
                                                    setPermissions(
                                                        toggleKey(
                                                            permissions,
                                                            `${prefix}.${key}`,
                                                            event.currentTarget.checked
                                                        )
                                                    )
                                                }
                                                className={'gb:size-3.5 gb:accent-primary'}
                                            />
                                            {key}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </fieldset>
                <Dialog.Footer>
                    <Button.Text type={'button'} onClick={onClose} disabled={save.isPending}>
                        Cancel
                    </Button.Text>
                    <Button type={'submit'} color={'primary'} isLoading={save.isPending} disabled={!ready}>
                        Save access
                    </Button>
                </Dialog.Footer>
            </form>
        </Dialog>
    );
}
