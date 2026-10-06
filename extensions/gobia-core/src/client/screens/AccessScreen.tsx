import {
    Button,
    ContentBox,
    Dialog,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
    PageContentBlock,
    Spinner,
    httpErrorToHuman,
    toast,
} from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import AccessEditor from '../access/AccessEditor';
import { accessQueryKey, fetchAccess, revokeAccess, type Grant } from '../access/api';

export default function AccessScreen() {
    const queryClient = useQueryClient();
    const { data, isPending, isError, refetch } = useQuery({ queryKey: accessQueryKey, queryFn: fetchAccess });
    const [editing, setEditing] = useState<Grant | 'new' | null>(null);
    const [removing, setRemoving] = useState<Grant | null>(null);

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
            <ContentBox title={'People with access to your instances'}>
                <div className={'gb:mb-4 gb:flex gb:items-center gb:justify-between gb:gap-3'}>
                    <p className={'gb:text-sm gb:text-muted-foreground'}>
                        Share several instances with one person at once. Permissions are the same ones you can set per
                        instance.
                    </p>
                    <Button type={'button'} color={'primary'} onClick={() => setEditing('new')} disabled={!data}>
                        Grant access
                    </Button>
                </div>
                {isPending ? (
                    <Spinner centered />
                ) : isError ? (
                    <Button type={'button'} onClick={() => refetch()}>
                        Retry
                    </Button>
                ) : data.grants.length === 0 ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyTitle>Nobody else has access</EmptyTitle>
                            <EmptyDescription>
                                People you grant access to see your instances under the Other filter.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <ul className={'gb:flex gb:flex-col gb:gap-2'}>
                        {data.grants.map((grant) => (
                            <li
                                key={grant.uuid}
                                className={
                                    'gb:flex gb:flex-wrap gb:items-center gb:justify-between gb:gap-3 gb:rounded-lg gb:border gb:border-border gb:p-3'
                                }
                            >
                                <div className={'gb:min-w-0'}>
                                    <p className={'gb:truncate gb:font-medium'}>{grant.username}</p>
                                    <p className={'gb:truncate gb:text-xs gb:text-muted-foreground'}>{grant.email}</p>
                                    <p className={'gb:mt-1 gb:text-xs gb:text-muted-foreground'}>
                                        {grant.servers.map((server) => server.name).join(', ')} ·{' '}
                                        {grant.permissions.length} permissions
                                    </p>
                                </div>
                                <div className={'gb:flex gb:gap-2'}>
                                    <Button type={'button'} onClick={() => setEditing(grant)}>
                                        Edit
                                    </Button>
                                    <Button.Danger type={'button'} onClick={() => setRemoving(grant)}>
                                        Remove
                                    </Button.Danger>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </ContentBox>
            {data && editing && (
                <AccessEditor data={data} grant={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
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
