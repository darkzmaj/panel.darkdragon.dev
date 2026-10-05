import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStoreState } from 'easy-peasy';
import { Menu, X } from 'lucide-react';
import { ApplicationStore } from '@/state';
import http from '@/api/http';
import UserMenu from '@/components/UserMenu';
import GobiaFooter from '@/components/elements/GobiaFooter';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import { ShellProvider, useShell } from '@/components/shell/ShellContext';

export const Brand = () => {
    const name = useStoreState((state: ApplicationStore) => state.settings.data!.name);
    const logo = useStoreState((state: ApplicationStore) => state.settings.data!.logo);

    return (
        <Link to={'/'} className={'gb-topbar-brand'} style={{ textDecoration: 'none' }} aria-label={name}>
            <img
                src={logo || '/themes/gobia/img/logo-text-240.png'}
                srcSet={
                    logo ? undefined : '/themes/gobia/img/logo-text-240.png 1x, /themes/gobia/img/logo-text-480.png 2x'
                }
                alt={name}
            />
        </Link>
    );
};

interface Props {
    // Sidebar navigation (NavLabel / NavItem children).
    sidebar: React.ReactNode;
    // The two lines of the card at the bottom of the sidebar. Defaults to the Panel name.
    footer?: React.ReactNode;
}

const Shell: React.FC<Props> = ({ sidebar, footer, children }) => {
    const { drawerOpen, setDrawerOpen } = useShell();
    const location = useLocation();
    const name = useStoreState((state: ApplicationStore) => state.settings.data!.name);
    const [loggingOut, setLoggingOut] = useState(false);

    // Navigating always closes the mobile drawer.
    useEffect(() => setDrawerOpen(false), [location.pathname]);

    useEffect(() => {
        if (!drawerOpen) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [drawerOpen]);

    const logout = () => {
        setLoggingOut(true);
        http.post('/auth/logout').finally(() => {
            // @ts-expect-error this is valid
            window.location = '/';
        });
    };

    return (
        <div className={'gb-app' + (drawerOpen ? ' gb-drawer-open' : '')}>
            <SpinnerOverlay visible={loggingOut} />
            <header className={'gb-topbar'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <button
                        type={'button'}
                        className={'gb-icon-btn gb-menu-toggle'}
                        aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
                        aria-expanded={drawerOpen}
                        onClick={() => setDrawerOpen(!drawerOpen)}
                    >
                        {drawerOpen ? <X aria-hidden /> : <Menu aria-hidden />}
                    </button>
                    <Brand />
                </div>
                <div className={'gb-topbar-actions'}>
                    <UserMenu onLogout={logout} />
                </div>
            </header>
            <div className={'gb-layout'}>
                <div className={'gb-sidebar-wrap'}>
                    <aside className={'gb-sidebar'} aria-label={'Primary'}>
                        <nav className={'gb-sidebar-scroll'}>{sidebar}</nav>
                        <Link to={'/account'} className={'gb-sidebar-foot'}>
                            <img src={'/themes/gobia/img/icon-64.png'} alt={''} />
                            {footer || (
                                <span style={{ minWidth: 0 }}>
                                    <strong>{name}</strong>
                                    <span>Beyond The Clouds</span>
                                </span>
                            )}
                        </Link>
                    </aside>
                </div>
                <div className={'gb-drawer-backdrop'} onClick={() => setDrawerOpen(false)} aria-hidden />
                <main className={'gb-main'} id={'gb-main'}>
                    <div className={'gb-main-inner'}>{children}</div>
                </main>
            </div>
            <GobiaFooter />
        </div>
    );
};

const AppShell: React.FC<Props & { title: string; subtitle?: string }> = ({ title, subtitle, ...props }) => (
    <ShellProvider initial={{ title, subtitle }}>
        <Shell {...props} />
    </ShellProvider>
);

export default AppShell;
