import TransferListener from '@/components/server/TransferListener';
import React, { useEffect, useState } from 'react';
import { Route, Switch, useRouteMatch } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import AppShell from '@/components/shell/AppShell';
import { NavAnchor, NavItem, NavLabel } from '@/components/shell/Nav';
import { useTopbarTitle } from '@/components/shell/ShellContext';
import TransitionRouter from '@/TransitionRouter';
import WebsocketHandler from '@/components/server/WebsocketHandler';
import { ServerContext } from '@/state/server';
import Can from '@/components/elements/Can';
import RouteSuspense from '@/components/elements/RouteSuspense';
import { invalidateServerRequests } from '@/state/server';
import { NotFound, ServerError } from '@/components/elements/ScreenBlock';
import { httpErrorToHuman } from '@/api/http';
import { useStoreState } from 'easy-peasy';
import InstallListener from '@/components/server/InstallListener';
import ErrorBoundary from '@/components/elements/ErrorBoundary';
import { useLocation } from 'react-router';
import ConflictStateRenderer from '@/components/server/ConflictStateRenderer';
import PermissionRoute from '@/components/elements/PermissionRoute';
import routes from '@/routers/serverRoutes';
import { Skeleton } from '@/components/elements/Skeleton';

const statusDot = (state: string | null | undefined) =>
    state === 'running' ? 'gb-dot-success' : state === 'starting' || state === 'stopping' ? 'gb-dot-warning' : '';

// The title in the top bar and the instance card at the top of the sidebar.
const ServerTitle = () => {
    const name = ServerContext.useStoreState((state) => state.server.data?.name);
    const node = ServerContext.useStoreState((state) => state.server.data?.node);
    const allocation = ServerContext.useStoreState((state) => state.server.data?.allocations.find((a) => a.isDefault));
    const subtitle = [node, allocation && `${allocation.alias || allocation.ip}:${allocation.port}`]
        .filter(Boolean)
        .join(' · ');

    useTopbarTitle(name || 'Instance', subtitle || undefined);

    return null;
};

export default () => {
    const match = useRouteMatch<{ id: string }>();
    const location = useLocation();

    const rootAdmin = useStoreState((state) => state.user.data!.rootAdmin);
    const [error, setError] = useState('');

    const id = ServerContext.useStoreState((state) => state.server.data?.id);
    const uuid = ServerContext.useStoreState((state) => state.server.data?.uuid);
    const name = ServerContext.useStoreState((state) => state.server.data?.name);
    const node = ServerContext.useStoreState((state) => state.server.data?.node);
    const power = ServerContext.useStoreState((state) => state.status.value);
    const inConflictState = ServerContext.useStoreState((state) => state.server.inConflictState);
    const serverId = ServerContext.useStoreState((state) => state.server.data?.internalId);
    const getServer = ServerContext.useStoreActions((actions) => actions.server.getServer);
    const clearServerState = ServerContext.useStoreActions((actions) => actions.clearServerState);

    const to = (value: string, url = false) => {
        if (value === '/') {
            return url ? match.url : match.path;
        }
        return `${(url ? match.url : match.path).replace(/\/*$/, '')}/${value.replace(/^\/+/, '')}`;
    };

    useEffect(
        () => () => {
            clearServerState();
        },
        []
    );

    useEffect(() => {
        setError('');

        getServer(match.params.id).catch((error) => {
            console.error(error);
            setError(httpErrorToHuman(error));
        });

        return () => {
            // A response for this server that arrives after leaving it must not populate the next one.
            invalidateServerRequests();
            clearServerState();
        };
    }, [match.params.id]);

    // Once a server is open, fetch the other pages' shared chunk when the browser is idle so first visits feel instant.
    // Heavy routes (the Monaco workspace) are intentionally excluded: they load on demand or on hover.
    useEffect(() => {
        if (!uuid) return;
        const run = () => routes.filter((r) => r.idle && r.preload).forEach((r) => r.preload?.());
        const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
        const handle = w.requestIdleCallback ? w.requestIdleCallback(run) : window.setTimeout(run, 1500);

        return () => {
            if (!w.requestIdleCallback) window.clearTimeout(handle);
        };
    }, [uuid]);

    const ready = !!uuid && !!id;

    const sidebar = (
        <>
            <NavItem to={'/'} exact icon={ArrowLeft}>
                All instances
            </NavItem>
            <div
                className={'gb-subcard'}
                style={{ margin: '10px 0 2px', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}
            >
                {ready ? (
                    <>
                        <span className={'gb-dot ' + statusDot(power)} aria-label={power || 'offline'} />
                        <span style={{ minWidth: 0 }}>
                            <strong
                                style={{
                                    display: 'block',
                                    color: 'var(--gb-text-strong)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {name}
                            </strong>
                            <span className={'gb-secondary'} style={{ fontSize: 12 }}>
                                {node} · {power || 'offline'}
                            </span>
                        </span>
                    </>
                ) : (
                    <Skeleton style={{ height: 34, width: '100%' }} />
                )}
            </div>
            <NavLabel>Instance</NavLabel>
            {ready &&
                routes
                    .filter((route) => !!route.name)
                    .map((route) => {
                        const Icon = route.icon!;
                        const link = (
                            <NavItem
                                key={route.path}
                                to={to(route.path, true)}
                                exact={route.exact}
                                icon={Icon}
                                onMouseEnter={() => route.preload?.()}
                                onFocus={() => route.preload?.()}
                            >
                                {route.name}
                            </NavItem>
                        );

                        return route.permission ? (
                            <Can key={route.path} action={route.permission} matchAny>
                                {link}
                            </Can>
                        ) : (
                            link
                        );
                    })}
            {ready && rootAdmin && (
                <>
                    <NavLabel>Administration</NavLabel>
                    <NavAnchor href={`/admin/servers/view/${serverId}`} icon={ExternalLink} target={'_blank'}>
                        Manage in admin
                    </NavAnchor>
                </>
            )}
        </>
    );

    return (
        <AppShell title={'Instance'} sidebar={sidebar}>
            <ServerTitle />
            {!ready ? (
                error ? (
                    <ServerError message={error} />
                ) : (
                    <div role={'status'} aria-label={'Loading'}>
                        <Skeleton style={{ height: 32, width: 220, marginBottom: 20 }} />
                        <Skeleton style={{ height: 180 }} />
                    </div>
                )
            ) : (
                <>
                    <InstallListener />
                    <TransferListener />
                    <WebsocketHandler />
                    {inConflictState && (!rootAdmin || (rootAdmin && !location.pathname.endsWith(`/server/${id}`))) ? (
                        <ConflictStateRenderer />
                    ) : (
                        <ErrorBoundary>
                            <TransitionRouter>
                                <Switch location={location}>
                                    {routes.map(({ path, permission, component: Component }) => (
                                        <PermissionRoute key={path} permission={permission} path={to(path)} exact>
                                            <RouteSuspense>
                                                <Component />
                                            </RouteSuspense>
                                        </PermissionRoute>
                                    ))}
                                    <Route path={'*'} component={NotFound} />
                                </Switch>
                            </TransitionRouter>
                        </ErrorBoundary>
                    )}
                </>
            )}
        </AppShell>
    );
};
