import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldOff } from 'lucide-react';

interface Credential {
    id: number;
    label: string | null;
    username: string;
    permission: 'rw' | 'ro';
    status: 'active' | 'expired' | 'revoked';
    created_at: string | null;
    expires_at: string | null;
    last_used_at: string | null;
    last_used_ip: string | null;
}

interface Listing {
    enabled: boolean;
    host: string;
    port: number;
    max_days: number;
    credentials: Credential[];
    events: Array<{
        event: string;
        username: string | null;
        ip: string | null;
        detail: string | null;
        created_at: string;
    }>;
}

interface Created {
    id: number;
    username: string;
    password: string;
    permission: string;
    host: string;
    port: number;
    expires_at: string | null;
}

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Never');

const call = async (url: string, csrf: string, method = 'GET', body?: unknown) => {
    const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-CSRF-TOKEN': csrf,
            'X-Requested-With': 'XMLHttpRequest',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            data?.errors?.[0]?.detail ||
                (data?.errors && Object.values<string[]>(data.errors)[0]?.[0]) ||
                'The request failed.'
        );
    }

    return data;
};

// SFTP access to a template's working files. Each credential opens this template only, as read/write or read only.
// The password is shown once, when the credential is created.
export default ({ url, csrf }: { url: string; csrf: string }) => {
    const [data, setData] = useState<Listing | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<Created | null>(null);
    const [label, setLabel] = useState('');
    const [permission, setPermission] = useState<'rw' | 'ro'>('rw');
    const [days, setDays] = useState('30');
    const [busy, setBusy] = useState(false);

    const load = useCallback(
        () =>
            call(url, csrf)
                .then(setData)
                .catch((e) => setError(e.message)),
        [url, csrf]
    );
    useEffect(() => {
        load();
    }, [load]);

    const create = async () => {
        setBusy(true);
        setError(null);
        try {
            setCreated(
                await call(url, csrf, 'POST', {
                    label: label || null,
                    permission,
                    expires_in_days: days ? Number(days) : null,
                })
            );
            setLabel('');
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
        setBusy(false);
    };

    const revoke = async (credential: Credential) => {
        if (!window.confirm(`Revoke ${credential.username}? Anyone using it is disconnected at their next login.`))
            return;
        try {
            await call(`${url}/${credential.id}`, csrf, 'DELETE');
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined);

    if (!data)
        return (
            <div className={'box box-primary'}>
                <div className={'box-body text-muted'}>{error || 'Loading…'}</div>
            </div>
        );

    return (
        <>
            <div className={'box box-primary'}>
                <div className={'box-header with-border'}>
                    <h3 className={'box-title'}>SFTP access</h3>
                </div>
                <div className={'box-body'}>
                    {!data.enabled && (
                        <div className={'alert alert-warning'}>
                            The SFTP service is not configured. Set <code>GOBIA_SFTP_SERVICE_TOKEN</code> (at least 32
                            characters) in the Panel environment and start the service. See docs/server-templates.md.
                        </div>
                    )}
                    <p className={'text-muted'} style={{ marginTop: 0 }}>
                        A credential gives access to this template&apos;s working files only: its folder is the SFTP
                        root, and nothing outside it can be reached. Changes made over SFTP stay in the working files
                        until you publish them on the Files tab.
                    </p>
                    <dl className={'gb-facts'} style={{ marginBottom: 0 }}>
                        <div>
                            <dt>Host</dt>
                            <dd>
                                <code>{data.host}</code>
                            </dd>
                        </div>
                        <div>
                            <dt>Port</dt>
                            <dd>
                                <code>{data.port}</code>
                            </dd>
                        </div>
                        <div>
                            <dt>Root</dt>
                            <dd>
                                <code>/</code> (this template)
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>

            {created && (
                <div className={'box box-success'}>
                    <div className={'box-header with-border'}>
                        <h3 className={'box-title'}>Credential created</h3>
                    </div>
                    <div className={'box-body'}>
                        <p>Copy the password now. It is not stored and cannot be shown again.</p>
                        <dl className={'gb-facts'}>
                            {(
                                [
                                    ['Host', created.host],
                                    ['Port', String(created.port)],
                                    ['Username', created.username],
                                    ['Password', created.password],
                                ] as Array<[string, string]>
                            ).map(([k, v]) => (
                                <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>
                                        <code>{v}</code>{' '}
                                        <button
                                            type={'button'}
                                            className={'gb-btn gb-btn-xs gb-btn-ghost'}
                                            aria-label={`Copy ${k}`}
                                            onClick={() => copy(v)}
                                        >
                                            <Copy aria-hidden />
                                        </button>
                                    </dd>
                                </div>
                            ))}
                            <div>
                                <dt>Access</dt>
                                <dd>
                                    {created.permission === 'rw' ? 'Read / write' : 'Read only'}
                                    {created.expires_at && `, expires ${when(created.expires_at)}`}
                                </dd>
                            </div>
                        </dl>
                        <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => setCreated(null)}>
                            I have saved it
                        </button>
                    </div>
                </div>
            )}

            <div className={'box box-primary'}>
                <div className={'box-header with-border'}>
                    <h3 className={'box-title'}>Create credential</h3>
                </div>
                <div className={'box-body'}>
                    {error && <div className={'alert alert-danger'}>{error}</div>}
                    <div className={'row'}>
                        <div className={'form-group col-md-4'}>
                            <label htmlFor={'sftpLabel'}>Label</label>
                            <input
                                id={'sftpLabel'}
                                className={'form-control'}
                                maxLength={80}
                                placeholder={'Deploy pipeline'}
                                value={label}
                                onChange={(e) => setLabel(e.currentTarget.value)}
                            />
                        </div>
                        <div className={'form-group col-md-4'}>
                            <label htmlFor={'sftpPermission'}>Access</label>
                            <select
                                id={'sftpPermission'}
                                className={'form-control'}
                                value={permission}
                                onChange={(e) => setPermission(e.currentTarget.value as 'rw' | 'ro')}
                            >
                                <option value={'rw'}>Read / write</option>
                                <option value={'ro'}>Read only</option>
                            </select>
                        </div>
                        <div className={'form-group col-md-4'}>
                            <label htmlFor={'sftpDays'}>Valid for (days)</label>
                            <input
                                id={'sftpDays'}
                                className={'form-control'}
                                type={'number'}
                                min={1}
                                max={data.max_days}
                                value={days}
                                onChange={(e) => setDays(e.currentTarget.value)}
                            />
                        </div>
                    </div>
                </div>
                <div className={'box-footer'}>
                    <button
                        type={'button'}
                        className={'gb-btn gb-btn-primary gb-btn-sm pull-right'}
                        disabled={busy || !data.enabled}
                        onClick={create}
                    >
                        <KeyRound aria-hidden /> Create credential
                    </button>
                </div>
            </div>

            <div className={'box box-primary'}>
                <div className={'box-header with-border'}>
                    <h3 className={'box-title'}>Credentials</h3>
                </div>
                <div className={'box-body table-responsive no-padding'}>
                    <table className={'table table-hover'}>
                        <tbody>
                            <tr>
                                <th>Username</th>
                                <th>Label</th>
                                <th>Access</th>
                                <th>Created</th>
                                <th>Expires</th>
                                <th>Last used</th>
                                <th>Status</th>
                                <th />
                            </tr>
                            {data.credentials.length === 0 && (
                                <tr>
                                    <td colSpan={8} className={'text-center text-muted'} style={{ padding: 20 }}>
                                        No credentials yet.
                                    </td>
                                </tr>
                            )}
                            {data.credentials.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        <code>{c.username}</code>
                                    </td>
                                    <td>{c.label || <span className={'text-muted'}>—</span>}</td>
                                    <td>{c.permission === 'rw' ? 'Read / write' : 'Read only'}</td>
                                    <td>{when(c.created_at)}</td>
                                    <td>{when(c.expires_at)}</td>
                                    <td>{c.last_used_at ? `${when(c.last_used_at)} (${c.last_used_ip})` : 'Never'}</td>
                                    <td>
                                        <span
                                            className={
                                                'gb-badge ' +
                                                (c.status === 'active' ? 'gb-badge-success' : 'gb-badge-danger')
                                            }
                                        >
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className={'text-right'}>
                                        {c.status === 'active' && (
                                            <button
                                                type={'button'}
                                                className={'gb-btn gb-btn-sm'}
                                                onClick={() => revoke(c)}
                                            >
                                                <ShieldOff aria-hidden /> Revoke
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {data.events.length > 0 && (
                <div className={'box box-primary'}>
                    <div className={'box-header with-border'}>
                        <h3 className={'box-title'}>Recent activity</h3>
                    </div>
                    <div className={'box-body table-responsive no-padding'}>
                        <table className={'table'}>
                            <tbody>
                                {data.events.map((event, i) => (
                                    <tr key={i}>
                                        <td>{when(event.created_at)}</td>
                                        <td>{event.event.replace('_', ' ')}</td>
                                        <td>
                                            <code>{event.username}</code>
                                        </td>
                                        <td>{event.ip}</td>
                                        <td className={'small text-muted'}>{event.detail}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </>
    );
};
