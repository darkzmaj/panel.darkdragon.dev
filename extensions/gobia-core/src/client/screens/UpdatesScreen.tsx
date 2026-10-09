import { Button, ContentBox, PageContentBlock, Spinner, httpErrorToHuman, http, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { failingChecks, isTerminal, updateGate } from '../updates/gate';
import type {
    Compatibility,
    HistoryEntry,
    Preflight,
    RollbackEligibility,
    UpdateCheck,
    UpdateProgress,
} from '../updates/types';

const BASE = '/api/admin/extensions/gobia-core';

/** The updater backend is Majcek's; a missing endpoint just means it is not installed on this panel. */
async function optional<T>(path: string): Promise<T | null> {
    try {
        return (await http.get<T>(`${BASE}/${path}`)).data;
    } catch {
        return null;
    }
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div
            className={
                'gb:flex gb:justify-between gb:gap-4 gb:border-b gb:border-border/55 gb:py-2.5 gb:text-sm last:gb:border-0'
            }
        >
            <dt className={'gb:text-muted-foreground'}>{label}</dt>
            <dd className={'gb:text-right gb:font-medium'}>{value}</dd>
        </div>
    );
}

export default function UpdatesScreen() {
    const queryClient = useQueryClient();
    const [startedId, setStartedId] = useState<string | null>(null);
    const [dismissedId, setDismissedId] = useState<string | null>(null);
    const [confirmRestore, setConfirmRestore] = useState(false);

    const compat = useQuery({
        queryKey: ['gobia-core', 'updates', 'compatibility'],
        queryFn: async () => (await http.get<Compatibility>(`${BASE}/compatibility`)).data,
    });
    const check = useQuery({
        queryKey: ['gobia-core', 'updates', 'check'],
        queryFn: () => optional<UpdateCheck>('updates/check'),
        staleTime: 60_000,
    });
    // "Check for updates" asks the update source again instead of reading the cached answer.
    const recheck = useMutation({
        mutationFn: () => optional<UpdateCheck>('updates/check?refresh=1'),
        onSuccess: (result) => {
            queryClient.setQueryData(['gobia-core', 'updates', 'check'], result);
            void queryClient.invalidateQueries({ queryKey: ['gobia-core', 'updates', 'preflight'] });
            if (result?.error) toast.error(result.error);
            else if (result && !result.update_available) toast.success('This Panel is up to date.');
        },
    });
    // An update that is already running (started in another tab, or before a reload) is followed again.
    const activeId = check.data?.active_update_id ?? null;
    const updateId = startedId ?? (activeId !== dismissedId ? activeId : null);
    const preflight = useQuery({
        queryKey: ['gobia-core', 'updates', 'preflight'],
        queryFn: () => optional<Preflight>('updates/preflight'),
        enabled: Boolean(check.data?.update_available),
    });
    const history = useQuery({
        queryKey: ['gobia-core', 'updates', 'history'],
        queryFn: () => optional<{ data: HistoryEntry[] }>('updates/history'),
    });
    const eligibility = useQuery({
        queryKey: ['gobia-core', 'updates', 'rollback'],
        queryFn: () => optional<RollbackEligibility>('updates/rollback-eligibility'),
    });
    const progress = useQuery({
        queryKey: ['gobia-core', 'updates', 'progress', updateId],
        queryFn: async () => (await http.get<UpdateProgress>(`${BASE}/updates/progress/${updateId}`)).data,
        enabled: updateId !== null,
        // The panel restarts workers and may go into maintenance mid update; keep polling through transient errors.
        refetchInterval: (query) => (query.state.data && isTerminal(query.state.data.state) ? false : 2000),
        retry: true,
    });

    const install = useMutation({
        mutationFn: async () =>
            (
                await http.post<{ update_id: string }>(`${BASE}/updates/install`, {
                    target: check.data?.latest_approved?.gobia,
                    confirm_backup: true,
                })
            ).data,
        onSuccess: (result) => setStartedId(result.update_id),
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });
    const rollback = useMutation({
        mutationFn: async () =>
            (
                await http.post<{ update_id: string }>(`${BASE}/updates/rollback`, {
                    update_id: eligibility.data?.update_id,
                    confirm_database_restore: eligibility.data?.mode === 'requires-db-restore',
                })
            ).data,
        onSuccess: (result) => {
            setConfirmRestore(false);
            setStartedId(result.update_id);
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    const gate = updateGate(check.data, preflight.data);
    const failing = failingChecks(preflight.data);
    const running = progress.data && !isTerminal(progress.data.state);
    const latest = check.data?.latest_approved ?? null;

    if (compat.isPending) return <Spinner centered size={'large'} />;
    if (compat.isError) return <p className={'gb:text-destructive'}>The compatibility report could not be loaded.</p>;
    const report = compat.data;

    return (
        <PageContentBlock title={'Updates'}>
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>Panel Updates</h1>
                    <p>Install published releases of this Panel.</p>
                </div>
            </div>
            <div className={'gb:grid gb:gap-6 gb:lg:grid-cols-2'}>
                <ContentBox title={'This installation'}>
                    <dl>
                        <Row label={'Gobia version'} value={report.gobia_version} />
                        <Row
                            label={'Pterodactyl base'}
                            value={`${report.pterodactyl_base.version}${report.pterodactyl_base.commit ? ` (${report.pterodactyl_base.commit.slice(0, 9)})` : ''}`}
                        />
                        <Row label={'PHP'} value={report.php} />
                        <Row label={'Database'} value={`${report.database.driver} ${report.database.version ?? ''}`} />
                        <Row
                            label={'Pending migrations'}
                            value={report.migrations.pending < 0 ? 'unknown' : String(report.migrations.pending)}
                        />
                        <Row
                            label={'Health'}
                            value={report.health.database && report.health.cache ? 'Healthy' : 'Needs attention'}
                        />
                    </dl>
                </ContentBox>

                <ContentBox title={'Latest approved Gobia release'}>
                    {check.isPending ? (
                        <Spinner centered />
                    ) : latest ? (
                        <div className={'gb:flex gb:flex-col gb:gap-3'}>
                            <dl>
                                <Row label={'Version'} value={latest.gobia} />
                                <Row label={'Pterodactyl base'} value={latest.pterodactyl_base} />
                                <Row label={'Published'} value={latest.published_at} />
                            </dl>
                            {latest.security && (
                                <p
                                    className={
                                        'gb:rounded-md gb:border gb:border-destructive gb:px-3 gb:py-2 gb:text-sm gb:text-destructive'
                                    }
                                >
                                    Contains security fixes.
                                </p>
                            )}
                            <pre
                                className={
                                    'gb:max-h-48 gb:overflow-auto gb:whitespace-pre-wrap gb:rounded-md gb:bg-sunken gb:p-3 gb:text-xs'
                                }
                            >
                                {latest.release_notes_markdown || 'No release notes.'}
                            </pre>
                        </div>
                    ) : (
                        <p
                            className={
                                check.data?.error
                                    ? 'gb:text-sm gb:text-destructive'
                                    : 'gb:text-sm gb:text-muted-foreground'
                            }
                        >
                            {check.data === null
                                ? 'The Gobia update service is not installed on this panel, so no release information is available.'
                                : (check.data?.error ?? 'You are on the latest approved release.')}
                        </p>
                    )}
                    <div className={'gb:mt-4 gb:flex gb:flex-wrap gb:items-center gb:gap-3'}>
                        <Button
                            type={'button'}
                            disabled={recheck.isPending || Boolean(running)}
                            isLoading={recheck.isPending}
                            onClick={() => recheck.mutate()}
                        >
                            Check for updates
                        </Button>
                        {check.data?.checked_at && (
                            <span className={'gb:text-xs gb:text-muted-foreground'}>
                                Last checked {new Date(check.data.checked_at).toLocaleString()}
                            </span>
                        )}
                    </div>
                </ContentBox>
            </div>

            <ContentBox title={'Extensions'} className={'gb:mt-6'}>
                <table className={'gb:w-full gb:text-left gb:text-sm'}>
                    <caption className={'gb:sr-only'}>Installed extensions and compatibility</caption>
                    <thead className={'gb:text-xs gb:uppercase gb:text-muted-foreground'}>
                        <tr>
                            {['Extension', 'Version', 'State', 'Compatibility'].map((heading) => (
                                <th key={heading} scope={'col'} className={'gb:py-2 gb:font-medium'}>
                                    {heading}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {report.extensions.map((extension) => (
                            <tr key={extension.id} className={'gb:border-t gb:border-border'}>
                                <th scope={'row'} className={'gb:py-2 gb:font-medium'}>
                                    {extension.name}
                                </th>
                                <td className={'gb:py-2 gb:tabular-nums'}>{extension.version}</td>
                                <td className={'gb:py-2'}>{extension.enabled ? 'Enabled' : 'Disabled'}</td>
                                <td
                                    className={
                                        extension.compatible ? 'gb:py-2 gb:text-success' : 'gb:py-2 gb:text-destructive'
                                    }
                                >
                                    {extension.compatible ? 'Compatible' : (extension.reason ?? 'Incompatible')}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ContentBox>

            {check.data?.update_available && (
                <ContentBox title={'Preflight'} className={'gb:mt-6'}>
                    {preflight.isPending ? (
                        <Spinner centered />
                    ) : preflight.data === null ? (
                        <p className={'gb:text-sm gb:text-muted-foreground'}>
                            The preflight check is not available, so the update cannot start.
                        </p>
                    ) : (
                        <ul className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                            {preflight.data?.checks.map((item) => (
                                <li key={item.id} className={'gb:flex gb:items-baseline gb:gap-3'}>
                                    <span
                                        className={
                                            item.status === 'pass'
                                                ? 'gb:text-success'
                                                : item.status === 'fail'
                                                  ? 'gb:text-destructive'
                                                  : 'gb:text-warning'
                                        }
                                    >
                                        {item.status.toUpperCase()}
                                    </span>
                                    <span className={'gb:font-medium'}>{item.id.replaceAll('_', ' ')}</span>
                                    <span className={'gb:text-muted-foreground'}>{item.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {failing.length > 0 && (
                        <p className={'gb:mt-3 gb:text-sm gb:text-destructive'}>
                            The update is blocked until the failing checks above are fixed.
                        </p>
                    )}
                </ContentBox>
            )}

            <div className={'gb:mt-6 gb:flex gb:flex-wrap gb:items-center gb:gap-3'}>
                <Button
                    type={'button'}
                    color={'primary'}
                    disabled={gate !== 'ready' || install.isPending || Boolean(running)}
                    isLoading={install.isPending}
                    onClick={() => install.mutate()}
                >
                    Update to {latest?.gobia ?? 'latest'}
                </Button>
                <span className={'gb:text-sm gb:text-muted-foreground'} role={'status'}>
                    {gate === 'no-updater' && 'No update service available.'}
                    {gate === 'up-to-date' && 'No approved update is available.'}
                    {gate === 'not-ready' && 'This installation is not ready for the update.'}
                    {gate === 'ready' && 'Ready. A database backup is taken first.'}
                </span>
                {eligibility.data?.eligible && !running && !confirmRestore && (
                    <Button.Danger
                        type={'button'}
                        isLoading={rollback.isPending}
                        onClick={() =>
                            eligibility.data?.mode === 'requires-db-restore'
                                ? setConfirmRestore(true)
                                : rollback.mutate()
                        }
                    >
                        {eligibility.data.mode === 'requires-db-restore'
                            ? 'Roll back and restore the database'
                            : 'Roll back'}
                    </Button.Danger>
                )}
            </div>

            {confirmRestore && eligibility.data?.eligible && (
                <div
                    className={'gb:mt-4 gb:rounded-md gb:border gb:border-destructive gb:p-4 gb:text-sm'}
                    role={'alertdialog'}
                    aria-label={'Confirm database restore'}
                >
                    <p>
                        The last update changed the database. Rolling back restores the database as it was
                        {eligibility.data.database_snapshot?.taken_at
                            ? ` on ${new Date(eligibility.data.database_snapshot.taken_at).toLocaleString()}`
                            : ' before the update'}
                        . Everything saved since then (new servers, users, settings) is lost.
                    </p>
                    <div className={'gb:mt-3 gb:flex gb:gap-3'}>
                        <Button.Danger type={'button'} isLoading={rollback.isPending} onClick={() => rollback.mutate()}>
                            Restore the database and roll back
                        </Button.Danger>
                        <Button type={'button'} onClick={() => setConfirmRestore(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {progress.data && (
                <ContentBox title={'Update progress'} className={'gb:mt-6'}>
                    <p className={'gb:text-sm'} role={'status'}>
                        {progress.data.state.replaceAll('_', ' ')} · {progress.data.percent}%
                    </p>
                    <progress
                        className={'gb:mt-2 gb:w-full'}
                        max={100}
                        value={progress.data.percent}
                        aria-label={'Update progress'}
                    />
                    {progress.data.failure && (
                        <p className={'gb:mt-2 gb:text-sm gb:text-destructive'}>{progress.data.failure}</p>
                    )}
                    {progress.data.rollback.performed && (
                        <p className={'gb:mt-2 gb:text-sm'}>
                            Rolled back
                            {progress.data.rollback.database_restored
                                ? ' and the database was restored from the snapshot.'
                                : '.'}
                        </p>
                    )}
                    {progress.data.rollback.failed && (
                        <p className={'gb:mt-2 gb:text-sm gb:text-destructive'}>
                            The automatic rollback failed and the Panel stays in maintenance mode. Fix the cause, then
                            run "php artisan gobia-core:update:recover --force-up" on the server.
                        </p>
                    )}
                    {progress.data.log.length > 0 && (
                        <pre
                            className={
                                'gb:mt-3 gb:max-h-56 gb:overflow-auto gb:whitespace-pre-wrap gb:rounded-md gb:bg-sunken gb:p-3 gb:text-xs'
                            }
                            aria-label={'Update log'}
                        >
                            {progress.data.log.map((entry) => entry.message).join('\n')}
                        </pre>
                    )}
                    {isTerminal(progress.data.state) && (
                        <Button
                            type={'button'}
                            className={'gb:mt-3'}
                            onClick={() => {
                                // The Panel's own files changed: load the new frontend instead of patching this one.
                                if (progress.data.state !== 'failed') return window.location.reload();
                                setDismissedId(updateId);
                                setStartedId(null);
                                void queryClient.invalidateQueries({ queryKey: ['gobia-core', 'updates'] });
                            }}
                        >
                            {progress.data.state === 'failed' ? 'Close' : 'Reload the Panel'}
                        </Button>
                    )}
                </ContentBox>
            )}

            {history.data && history.data.data.length > 0 && (
                <ContentBox title={'History'} className={'gb:mt-6'}>
                    <ul className={'gb:flex gb:flex-col gb:gap-1 gb:text-sm'}>
                        {history.data.data.map((entry) => (
                            <li key={entry.update_id} className={'gb:flex gb:justify-between gb:gap-3'}>
                                <span>
                                    {entry.from} to {entry.to}
                                </span>
                                <span className={'gb:text-muted-foreground'}>
                                    {entry.result.replace('_', ' ')} · {entry.started_at}
                                </span>
                            </li>
                        ))}
                    </ul>
                </ContentBox>
            )}
        </PageContentBlock>
    );
}
