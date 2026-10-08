import { Button, Dialog, PageContentBlock, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import AccessEditor from '../access/AccessEditor';
import { accessQueryKey, fetchAccess, revokeAccess, type Grant } from '../access/api';
import { PRESET_LABELS, presetOf, type PermissionGroups } from '../access/permissions';

function presetLabel(grant: Grant, groups: PermissionGroups) {
    const preset = presetOf(grant.permissions, groups, null);
    return preset ? PRESET_LABELS[preset] : `Custom (${grant.permissions.length} permissions)`;
}

export default function AccessScreen() {
    const queryClient = useQueryClient();
    const { data, isPending, isError, refetch } = useQuery({ queryKey: accessQueryKey, queryFn: fetchAccess });
    const [editing, setEditing] = useState<Grant | 'new' | null>(null);
    const [removing, setRemoving] = useState<Grant | null>(null);
    // The old server Users address lands here as ?server=<uuid> (and &grant=1 for "add someone").
    const [preselected] = useState(() => new URLSearchParams(window.location.search).get('server'));
    const [openOnArrival] = useState(() => new URLSearchParams(window.location.search).get('grant') === '1');
    const loaded = data !== undefined;
    useEffect(() => {
        if (loaded && openOnArrival) setEditing('new');
    }, [loaded, openOnArrival]);

    const remove = useMutation({
        mutationFn: (grant: Grant) => revokeAccess(grant.uuid),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: accessQueryKey });
            toast.success('Access removed.');
            setRemoving(null);
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    return (
        <PageContentBlock title={'Access'}>
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>Access</h1>
                    <p>
                        Choose who can open your instances and what they may do. This replaces the Users page of each
                        instance.
                    </p>
                </div>
                <div className={'gb-page-actions'}>
                    <Button type={'button'} onClick={() => setEditing('new')} disabled={!data}>
                        Grant Access
                    </Button>
                </div>
            </div>
            {isPending ? (
                <div className={'gb-list'}>
                    {[0, 1].map((row) => (
                        <div key={row} className={'gb-skeleton'} style={{ height: 76, borderRadius: 0 }} />
                    ))}
                </div>
            ) : isError ? (
                <div className={'gb-list'} role={'alert'} style={{ padding: '40px 16px', textAlign: 'center' }}>
                    <p className={'gb-secondary'} style={{ marginBottom: 12 }}>
                        Access could not be loaded.
                    </p>
                    <Button type={'button'} onClick={() => refetch()}>
                        Retry
                    </Button>
                </div>
            ) : data.grants.length === 0 ? (
                <div className={'gb-list'} style={{ padding: '40px 16px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--gb-text-strong)', fontWeight: 600 }}>Nobody else has access yet</p>
                    <p className={'gb-secondary'}>
                        People you grant access to see your instances under the Other filter.
                    </p>
                </div>
            ) : (
                <div className={'gb-list'}>
                    {data.grants.map((grant, index) => (
                        <div
                            key={grant.uuid}
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: 12,
                                padding: 16,
                                borderTop: index ? '1px solid var(--gb-border-muted)' : 0,
                            }}
                        >
                            <div
                                aria-hidden
                                className={
                                    'grid size-10 shrink-0 place-items-center rounded-full bg-secondary font-semibold text-muted-foreground'
                                }
                            >
                                {grant.username.slice(0, 1).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ color: 'var(--gb-text-strong)', fontWeight: 600 }} className={'truncate'}>
                                    {grant.username} <span className={'gb-muted'}>{grant.email}</span>
                                </p>
                                <p className={'gb-secondary truncate'} style={{ fontSize: 13 }}>
                                    {grant.servers.map((server) => server.name).join(', ')} ·{' '}
                                    {presetLabel(grant, data.permission_groups)}
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Button.Text type={'button'} onClick={() => setEditing(grant)}>
                                    Edit
                                </Button.Text>
                                <Button.Danger type={'button'} onClick={() => setRemoving(grant)}>
                                    Remove
                                </Button.Danger>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {data && editing && (
                <AccessEditor
                    data={data}
                    grant={editing === 'new' ? null : editing}
                    initialServer={preselected}
                    onClose={() => setEditing(null)}
                />
            )}
            {removing && (
                <Dialog.Confirm
                    open
                    onClose={() => setRemoving(null)}
                    title={`Remove ${removing.username}?`}
                    confirm={'Remove access'}
                    pending={remove.isPending}
                    onConfirmed={() => remove.mutate(removing)}
                >
                    They will lose access to {removing.servers.map((server) => server.name).join(', ')} immediately.
                </Dialog.Confirm>
            )}
        </PageContentBlock>
    );
}
