import { Button, CopyOnClick, Spinner, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createSftp, fetchSftp, keys, revokeSftp } from '../api';

const control = 'gt:rounded-md gt:border gt:border-input gt:bg-background gt:px-3 gt:py-2 gt:text-sm';

/** SFTP access to the working files: a separate process, short lived credentials, the secret is shown exactly once. */
export default function SftpTab({ id }: { id: number }) {
    const queryClient = useQueryClient();
    const sftp = useQuery({ queryKey: keys.sftp(id), queryFn: () => fetchSftp(id) });
    const [label, setLabel] = useState('');
    const [permission, setPermission] = useState<'rw' | 'ro'>('rw');
    const [days, setDays] = useState('7');
    const [secret, setSecret] = useState<{ username: string; password: string; host: string; port: number } | null>(
        null
    );
    const refresh = () => queryClient.invalidateQueries({ queryKey: keys.sftp(id) });

    const create = useMutation({
        mutationFn: () =>
            createSftp(id, {
                label: label.trim() || undefined,
                permission,
                expires_in_days: Number(days) || undefined,
            }),
        onSuccess: async (result) => {
            setSecret(result);
            setLabel('');
            await refresh();
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });
    const revoke = useMutation({
        mutationFn: (credential: number) => revokeSftp(id, credential),
        onSuccess: refresh,
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    if (sftp.isPending) return <Spinner centered />;
    if (sftp.isError) return <p className={'gt:text-destructive'}>SFTP information could not be loaded.</p>;
    const data = sftp.data;

    return (
        <div className={'gt:flex gt:flex-col gt:gap-5'}>
            {!data.enabled && (
                <p className={'gt:rounded-md gt:border gt:border-warning gt:p-3 gt:text-sm'}>
                    The SFTP service is not configured on this panel (GOBIA_SFTP_SERVICE_TOKEN). Credentials can be
                    created, but nobody can connect yet.
                </p>
            )}

            {secret && (
                <div
                    role={'alert'}
                    className={
                        'gt:flex gt:flex-col gt:gap-1 gt:rounded-lg gt:border gt:border-primary gt:bg-card gt:p-4 gt:text-sm'
                    }
                >
                    <p className={'gt:font-medium'}>Copy the password now. It is never shown again.</p>
                    <p>
                        Host{' '}
                        <CopyOnClick text={secret.host}>
                            <code>{secret.host}</code>
                        </CopyOnClick>{' '}
                        port <code>{secret.port}</code>
                    </p>
                    <p>
                        Username{' '}
                        <CopyOnClick text={secret.username}>
                            <code>{secret.username}</code>
                        </CopyOnClick>
                    </p>
                    <p>
                        Password{' '}
                        <CopyOnClick text={secret.password}>
                            <code>{secret.password}</code>
                        </CopyOnClick>
                    </p>
                    <Button.Text type={'button'} onClick={() => setSecret(null)}>
                        I have saved it
                    </Button.Text>
                </div>
            )}

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate();
                }}
                className={
                    'gt:flex gt:flex-wrap gt:items-end gt:gap-3 gt:rounded-lg gt:border gt:border-border gt:bg-card gt:p-4'
                }
            >
                <label className={'gt:flex gt:flex-col gt:gap-1 gt:text-sm'}>
                    Label
                    <input
                        value={label}
                        maxLength={80}
                        onChange={(event) => setLabel(event.currentTarget.value)}
                        className={control}
                    />
                </label>
                <label className={'gt:flex gt:flex-col gt:gap-1 gt:text-sm'}>
                    Access
                    <select
                        value={permission}
                        onChange={(event) => setPermission(event.currentTarget.value === 'ro' ? 'ro' : 'rw')}
                        className={control}
                    >
                        <option value={'rw'}>Read and write</option>
                        <option value={'ro'}>Read only</option>
                    </select>
                </label>
                <label className={'gt:flex gt:flex-col gt:gap-1 gt:text-sm'}>
                    Expires in (days, up to {data.max_days})
                    <input
                        type={'number'}
                        min={1}
                        max={data.max_days}
                        value={days}
                        onChange={(event) => setDays(event.currentTarget.value)}
                        className={`${control} gt:w-28`}
                    />
                </label>
                <Button type={'submit'} color={'primary'} isLoading={create.isPending}>
                    Create credentials
                </Button>
            </form>

            <ul className={'gt:flex gt:flex-col gt:gap-2'} aria-label={'Credentials'}>
                {data.credentials.map((credential) => (
                    <li
                        key={credential.id}
                        className={
                            'gt:flex gt:flex-wrap gt:items-center gt:justify-between gt:gap-3 gt:rounded-lg gt:border gt:border-border gt:p-3 gt:text-sm'
                        }
                    >
                        <div>
                            <p className={'gt:font-medium'}>
                                {credential.username}{' '}
                                {credential.label && (
                                    <span className={'gt:font-normal gt:text-muted-foreground'}>
                                        ({credential.label})
                                    </span>
                                )}
                            </p>
                            <p className={'gt:text-xs gt:text-muted-foreground'}>
                                {credential.permission === 'rw' ? 'Read and write' : 'Read only'} · {credential.status}
                                {credential.expires_at && ` · expires ${credential.expires_at.slice(0, 10)}`}
                                {credential.last_used_at &&
                                    ` · last used ${credential.last_used_at.slice(0, 16).replace('T', ' ')} from ${credential.last_used_ip ?? 'unknown'}`}
                            </p>
                        </div>
                        {credential.status === 'active' && (
                            <Button.Danger type={'button'} onClick={() => revoke.mutate(credential.id)}>
                                Revoke
                            </Button.Danger>
                        )}
                    </li>
                ))}
                {data.credentials.length === 0 && (
                    <li className={'gt:text-sm gt:text-muted-foreground'}>No credentials yet.</li>
                )}
            </ul>

            {data.events.length > 0 && (
                <div>
                    <h3 className={'gt:mb-2 gt:text-xs gt:font-medium gt:uppercase gt:text-muted-foreground'}>
                        Recent activity
                    </h3>
                    <ul className={'gt:flex gt:flex-col gt:gap-1 gt:text-xs gt:text-muted-foreground'}>
                        {data.events.map((event, index) => (
                            <li key={index}>
                                {event.created_at.slice(0, 19).replace('T', ' ')} · {event.event} ·{' '}
                                {event.username ?? '-'} · {event.ip ?? '-'}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
