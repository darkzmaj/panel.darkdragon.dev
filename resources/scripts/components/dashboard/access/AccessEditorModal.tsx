import React, { useEffect, useMemo, useState } from 'react';
import tw from 'twin.macro';
import { useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import Modal from '@/components/elements/Modal';
import Input from '@/components/elements/Input';
import Label from '@/components/elements/Label';
import { Button } from '@/components/elements/button/index';
import { AccessGrant, AccessInput, OwnedServer } from '@/api/account/access';

interface Props {
    visible: boolean;
    servers: OwnedServer[];
    // The person being edited, or null to grant access to someone new.
    grant: AccessGrant | null;
    saving: boolean;
    error: string | null;
    onCancel: () => void;
    onSave: (email: string, input: AccessInput) => void;
}

// Ticks a list of values on or off, keeping the order stable.
const toggle = (list: string[], value: string, on: boolean) =>
    on ? (list.includes(value) ? list : [...list, value]) : list.filter((v) => v !== value);

export default ({ visible, servers, grant, saving, error, onCancel, onSave }: Props) => {
    const catalog = useStoreState((state: ApplicationStore) => state.permissions.data);
    const [email, setEmail] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [permissions, setPermissions] = useState<string[]>([]);
    const [full, setFull] = useState(false);

    useEffect(() => {
        if (!visible) return;

        setEmail(grant?.email || '');
        setSelected(grant ? grant.servers.map((s) => s.uuid) : []);
        setPermissions(grant ? grant.permissions.filter((p) => p !== 'websocket.connect') : []);
        setFull(grant?.full_access || false);
    }, [visible, grant]);

    const groups = useMemo(
        () =>
            Object.keys(catalog)
                .filter((key) => key !== 'websocket')
                .map((key) => ({
                    key,
                    description: catalog[key].description,
                    keys: Object.keys(catalog[key].keys).map((k) => `${key}.${k}`),
                })),
        [catalog]
    );
    const everything = useMemo(() => groups.flatMap((g) => g.keys), [groups]);

    const allSelected = servers.length > 0 && selected.length === servers.length;
    const canSave =
        (grant || /.+@.+\..+/.test(email)) && selected.length > 0 && (full || permissions.length > 0) && !saving;

    return (
        <Modal visible={visible} onDismissed={onCancel} dismissable closeOnEscape showSpinnerOverlay={saving}>
            <h2 css={tw`text-2xl mb-1 text-neutral-100`}>
                {grant ? `Edit access for ${grant.email}` : 'Give someone access'}
            </h2>
            <p css={tw`text-sm text-neutral-400 mb-4`}>
                Access applies to the servers you pick below, with the permissions you choose.
            </p>
            {error && <p css={tw`text-sm text-red-400 mb-4`}>{error}</p>}
            {!grant && (
                <div css={tw`mb-4`}>
                    <Label htmlFor={'access-email'}>Email address</Label>
                    <Input
                        id={'access-email'}
                        type={'email'}
                        value={email}
                        onChange={(e) => setEmail(e.currentTarget.value)}
                        placeholder={'friend@example.com'}
                    />
                </div>
            )}

            <h3 css={tw`text-sm uppercase text-neutral-300 mb-2`}>Servers</h3>
            <div css={tw`bg-neutral-800 rounded p-3 mb-4 max-h-48 overflow-y-auto`}>
                <label css={tw`flex items-center py-1 cursor-pointer`}>
                    <Input
                        type={'checkbox'}
                        checked={allSelected}
                        onChange={(e) => setSelected(e.currentTarget.checked ? servers.map((s) => s.uuid) : [])}
                    />
                    <span css={tw`ml-3 text-sm font-medium`}>All servers</span>
                </label>
                {servers.map((server) => (
                    <label key={server.uuid} css={tw`flex items-center py-1 cursor-pointer`}>
                        <Input
                            type={'checkbox'}
                            checked={selected.includes(server.uuid)}
                            onChange={(e) => setSelected((s) => toggle(s, server.uuid, e.currentTarget.checked))}
                        />
                        <span css={tw`ml-3 text-sm`}>{server.name}</span>
                    </label>
                ))}
                {servers.length === 0 && <p css={tw`text-sm text-neutral-400`}>You don&apos;t own any servers yet.</p>}
            </div>

            <h3 css={tw`text-sm uppercase text-neutral-300 mb-2`}>Permissions</h3>
            <label css={tw`flex items-center mb-3 cursor-pointer`}>
                <Input
                    type={'checkbox'}
                    checked={full}
                    onChange={(e) => {
                        setFull(e.currentTarget.checked);
                        if (e.currentTarget.checked) setPermissions(everything);
                    }}
                />
                <span css={tw`ml-3 text-sm font-medium`}>Full access (every permission)</span>
            </label>
            <div
                css={[
                    tw`grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto`,
                    full && tw`opacity-50 pointer-events-none`,
                ]}
            >
                {groups.map((group) => {
                    const all = group.keys.every((p) => permissions.includes(p));

                    return (
                        <fieldset key={group.key} css={tw`bg-neutral-800 rounded p-3`}>
                            <legend css={tw`sr-only`}>{group.key}</legend>
                            <label css={tw`flex items-center cursor-pointer mb-1`}>
                                <Input
                                    type={'checkbox'}
                                    checked={all}
                                    onChange={(e) =>
                                        setPermissions((p) =>
                                            e.currentTarget.checked
                                                ? [...p, ...group.keys.filter((k) => !p.includes(k))]
                                                : p.filter((k) => !group.keys.includes(k))
                                        )
                                    }
                                />
                                <span css={tw`ml-3 text-sm uppercase`}>{group.key}</span>
                            </label>
                            <p css={tw`text-xs text-neutral-400 mb-2`}>{group.description}</p>
                            {group.keys.map((permission) => (
                                <label key={permission} css={tw`flex items-center py-0.5 cursor-pointer`}>
                                    <Input
                                        type={'checkbox'}
                                        checked={permissions.includes(permission)}
                                        onChange={(e) => {
                                            setFull(false);
                                            setPermissions((p) => toggle(p, permission, e.currentTarget.checked));
                                        }}
                                    />
                                    <span css={tw`ml-3 text-xs`}>{permission.split('.')[1].replace(/_/g, ' ')}</span>
                                </label>
                            ))}
                        </fieldset>
                    );
                })}
            </div>

            <div css={tw`flex justify-end mt-6`}>
                <Button.Text type={'button'} onClick={onCancel} css={tw`mr-2`}>
                    Cancel
                </Button.Text>
                <Button
                    type={'button'}
                    disabled={!canSave}
                    onClick={() => onSave(email.trim(), { servers: selected, permissions, fullAccess: full })}
                >
                    {grant ? 'Save changes' : 'Give access'}
                </Button>
            </div>
        </Modal>
    );
};
