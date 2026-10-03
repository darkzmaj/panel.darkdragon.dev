import React from 'react';
import { NavLink, Route, Switch } from 'react-router-dom';
import { useLocation } from 'react-router';
import { useStoreState } from 'easy-peasy';
import { ChevronRight, Server, Settings, ShieldCheck } from 'lucide-react';
import { ApplicationStore } from '@/state';
import AppShell from '@/components/shell/AppShell';
import { NavAnchor, NavItem, NavLabel } from '@/components/shell/Nav';
import { useTopbarTitle } from '@/components/shell/ShellContext';
import DashboardContainer from '@/components/dashboard/DashboardContainer';
import { NotFound } from '@/components/elements/ScreenBlock';
import TransitionRouter from '@/TransitionRouter';
import RouteSuspense from '@/components/elements/RouteSuspense';
import routes from '@/routers/accountRoutes';

const accountPath = (path: string) => `/account/${path}`.replace('//', '/');

// Keeps the top bar title in step with the page that is open.
const DashboardTitle = () => {
    const location = useLocation();
    const panel = useStoreState((state: ApplicationStore) => state.settings.data!.name);
    const account = location.pathname.startsWith('/account');
    const active = routes.find(({ path, exact }) => {
        const full = accountPath(path);

        return exact
            ? location.pathname.replace(/\/$/, '') === full.replace(/\/$/, '')
            : location.pathname.startsWith(full);
    });

    useTopbarTitle(account ? 'Account' : 'Instances', account ? active?.name : `${panel} Infrastructure`);

    return null;
};

// Account pages: a local menu on the left, the page's cards on the right (the same pattern as the Gobia settings screen).
const AccountLayout: React.FC = ({ children }) => (
    <div className={'gb-split'}>
        <nav className={'gb-subnav'} aria-label={'Account'}>
            {routes
                .filter((route) => !!route.name)
                .map(({ path, name, exact = false, icon: Icon, preload }) => (
                    <NavLink
                        key={path}
                        to={accountPath(path)}
                        exact={exact}
                        activeClassName={'active'}
                        onMouseEnter={() => preload?.()}
                        onFocus={() => preload?.()}
                    >
                        {Icon && <Icon aria-hidden />}
                        <span>{name}</span>
                        <ChevronRight aria-hidden className={'gb-chevron'} />
                    </NavLink>
                ))}
        </nav>
        <div className={'gb-split-content'}>{children}</div>
    </div>
);

export default () => {
    const location = useLocation();
    const rootAdmin = useStoreState((state: ApplicationStore) => state.user.data!.rootAdmin);

    return (
        <AppShell
            title={'Instances'}
            sidebar={
                <>
                    <NavLabel>Workspace</NavLabel>
                    <NavItem to={'/'} exact icon={Server}>
                        Instances
                    </NavItem>
                    <NavLabel>Account</NavLabel>
                    <NavItem to={'/account'} icon={Settings}>
                        Account
                    </NavItem>
                    {rootAdmin && (
                        <>
                            <NavLabel>Administration</NavLabel>
                            <NavAnchor href={'/admin'} icon={ShieldCheck}>
                                Admin
                            </NavAnchor>
                        </>
                    )}
                </>
            }
        >
            <DashboardTitle />
            <TransitionRouter>
                <RouteSuspense>
                    <Switch location={location}>
                        <Route path={'/'} exact>
                            <DashboardContainer />
                        </Route>
                        <Route path={'/account'}>
                            <AccountLayout>
                                <Switch location={location}>
                                    {routes.map(({ path, component: Component }) => (
                                        <Route key={path} path={accountPath(path)} exact>
                                            <Component />
                                        </Route>
                                    ))}
                                    <Route path={'*'}>
                                        <NotFound />
                                    </Route>
                                </Switch>
                            </AccountLayout>
                        </Route>
                        <Route path={'*'}>
                            <NotFound />
                        </Route>
                    </Switch>
                </RouteSuspense>
            </TransitionRouter>
        </AppShell>
    );
};
