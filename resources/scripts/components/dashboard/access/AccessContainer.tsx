import React, { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { httpErrorToHuman } from '@/api/http';
import PageContentBlock from '@/components/elements/PageContentBlock';
import FlashMessageRender from '@/components/FlashMessageRender';
import Spinner from '@/components/elements/Spinner';
import Avatar from '@/components/Avatar';
import { Button } from '@/components/elements/button/index';
import ConfirmationModal from '@/components/elements/ConfirmationModal';
import {
    AccessGrant,
    AccessInput,
    AccessOverview,
    getAccess,
    grantAccess,
    revokeAccess,
    updateAccess,
} from '@/api/account/access';
import AccessEditorModal from '@/components/dashboard/access/AccessEditorModal';

type Editing = { grant: AccessGrant | null } | null;

export default () => {
    const [data, setData] = useState<AccessOverview | null>(null);
    const [editing, setEditing] = useState<Editing>(null);
    const [removing, setRemoving] = useState<AccessGrant | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { clearFlashes, addFlash } = useStoreActions((actions: Actions<ApplicationStore>) => actions.flashes);
    const getPermissions = useStoreActions((actions: Actions<ApplicationStore>) => actions.permissions.getPermissions);

    useEffect(() => {
        clearFlashes('account:access');
        getPermissions().catch(console.error);
        getAccess()
            .then(setData)
            .catch((e) =>
                addFlash({ type: 'error', key: 'account:access', title: 'Error', message: httpErrorToHuman(e) })
            );
    }, []);

    const save = (email: string, input: AccessInput) => {
        const target = editing?.grant;
        setSaving(true);
        setError(null);

        (target ? updateAccess(target.uuid, input) : grantAccess(email, input))
            .then((grants) => {
                setData((d) => (d ? { ...d, grants } : d));
                setEditing(null);
                addFlash({ type: 'success', key: 'account:access', message: 'Access updated.' });
            })
            // Nothing is partially applied: the server rolls back every server if any one fails.
            .catch((e) => setError(httpErrorToHuman(e)))
            .then(() => setSaving(false));
    };

    const remove = (grant: AccessGrant) => {
        setRemoving(null);
        revokeAccess(grant.uuid)
            .then(() => {
                setData((d) => (d ? { ...d, grants: d.grants.filter((g) => g.uuid !== grant.uuid) } : d));
                addFlash({ type: 'success', key: 'account:access', message: `${grant.email} no longer has access.` });
            })
            .catch((e) =>
                addFlash({ type: 'error', key: 'account:access', title: 'Error', message: httpErrorToHuman(e) })
            );
    };

    return (
        <PageContentBlock title={'Access'}>
            <FlashMessageRender byKey={'account:access'} css={tw`mb-4`} />
            <div css={tw`flex items-center mb-4`}>
                <div css={tw`flex-1`}>
                    <h2 css={tw`text-2xl text-neutral-300`}>Access to your servers</h2>
                    <p css={tw`text-sm text-neutral-400`}>
                        Choose who can use the servers you own and what they are allowed to do, in one place.
                    </p>
                </div>
                <Button
                    type={'button'}
                    onClick={() => setEditing({ grant: null })}
                    disabled={!data || !data.servers.length}
                >
                    Give access
                </Button>
            </div>

            {!data ? (
                <Spinner centered size={'large'} />
            ) : data.grants.length === 0 ? (
                <p css={tw`text-center text-sm text-neutral-400 py-10`}>
                    {data.servers.length
                        ? 'Nobody else has access to your servers.'
                        : "You don't own any servers, so there is nothing to share."}
                </p>
            ) : (
                <div css={tw`bg-neutral-700 rounded shadow-lg divide-y divide-neutral-600`}>
                    {data.grants.map((grant) => (
                        <div key={grant.uuid} css={tw`flex flex-wrap items-center p-4`}>
                            <div css={tw`w-10 h-10 rounded-full overflow-hidden bg-neutral-600 flex-none`}>
                                <Avatar name={grant.uuid} src={grant.image} thumbnail />
                            </div>
                            <div css={tw`ml-4 flex-1 min-w-0`}>
                                <p css={tw`truncate`}>{grant.email}</p>
                                <p css={tw`text-xs text-neutral-400`}>
                                    {grant.all_servers
                                        ? 'All servers'
                                        : `${grant.servers.length} server${grant.servers.length === 1 ? '' : 's'}`}
                                    {' · '}
                                    {grant.full_access
                                        ? 'Full access'
                                        : `${
                                              grant.permissions.filter((p) => p !== 'websocket.connect').length
                                          } permissions`}
                                </p>
                                <p css={tw`text-xs text-neutral-400 truncate`}>
                                    {grant.servers.map((s) => s.name).join(', ')}
                                </p>
                            </div>
                            <div css={tw`flex mt-3 sm:mt-0`}>
                                <Button.Text
                                    type={'button'}
                                    onClick={() => setEditing({ grant })}
                                    aria-label={`Edit access for ${grant.email}`}
                                >
                                    Edit
                                </Button.Text>
                                <Button.Danger
                                    type={'button'}
                                    css={tw`ml-2`}
                                    onClick={() => setRemoving(grant)}
                                    aria-label={`Remove all access for ${grant.email}`}
                                >
                                    Remove
                                </Button.Danger>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AccessEditorModal
                visible={!!editing}
                servers={data?.servers || []}
                grant={editing?.grant || null}
                saving={saving}
                error={error}
                onCancel={() => setEditing(null)}
                onSave={save}
            />
            <ConfirmationModal
                visible={!!removing}
                title={`Remove ${removing?.email}?`}
                buttonText={'Remove access'}
                onConfirmed={() => removing && remove(removing)}
                onModalDismissed={() => setRemoving(null)}
            >
                They will immediately lose access to all {removing?.servers.length} of your servers they can currently
                use.
            </ConfirmationModal>
        </PageContentBlock>
    );
};
