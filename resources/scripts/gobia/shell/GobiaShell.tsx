import { useEffect, useRef } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Menu, Server, X } from 'lucide-react';
import { useSiteSettings } from '@/api/settings/queries';
import { useLogout } from '@/api/auth/queries';
import SpinnerOverlay from '@/components/elements/SpinnerOverlay';
import { DEFAULT_ICON } from '@/gobia/branding';
import Brand from '@/gobia/shell/Brand';
import GobiaFooter from '@/gobia/shell/GobiaFooter';
import { ShellProvider, useShell } from '@/gobia/shell/ShellContext';
import UserMenu from '@/gobia/shell/UserMenu';
import Slot from '@/extensions/Slot';

function Shell({ children }: { children: React.ReactNode }) {
    const { drawerOpen, setDrawerOpen, setSidebarEl } = useShell();
    const { pathname } = useLocation();
    const name = useSiteSettings().name;
    const logout = useLogout();
    const content = useRef<HTMLDivElement>(null);
    const admin = pathname === '/panel' || pathname.startsWith('/panel/');

    // Only the page area animates on navigation: restart its short fade without remounting anything.
    useEffect(() => {
        const element = content.current;
        if (!element) return;
        element.classList.remove('gb-route');
        void element.offsetWidth;
        element.classList.add('gb-route');
    }, [pathname]);

    // Navigating always closes the mobile drawer.
    useEffect(() => setDrawerOpen(false), [pathname, setDrawerOpen]);

    useEffect(() => {
        if (!drawerOpen) return;
        const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawerOpen(false);
        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [drawerOpen, setDrawerOpen]);

    return (
        <div className={'gb-app' + (drawerOpen ? ' gb-drawer-open' : '')}>
            <SpinnerOverlay visible={logout.isPending} />
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
                    <Slot name={'nav.items.before'} />
                    <Slot name={'nav.items.after'} />
                    {admin && (
                        <Link to={'/'} className={'gb-btn gb-btn-sm gb-hide-sm'}>
                            <Server aria-hidden /> Instances
                        </Link>
                    )}
                    <UserMenu onLogout={() => logout.mutate({})} />
                </div>
            </header>
            <div className={'gb-layout'}>
                <div className={'gb-sidebar-wrap'}>
                    <aside className={'gb-sidebar'} aria-label={'Primary'}>
                        <nav className={'gb-sidebar-scroll'} ref={setSidebarEl} />
                        <Link to={admin ? '/' : '/account'} className={'gb-sidebar-foot'}>
                            <img src={DEFAULT_ICON} alt={''} />
                            <span style={{ minWidth: 0 }}>
                                <strong>{name}</strong>
                                <span>{admin ? 'Back to instances' : 'Beyond The Clouds'}</span>
                            </span>
                        </Link>
                    </aside>
                </div>
                <div className={'gb-drawer-backdrop'} onClick={() => setDrawerOpen(false)} aria-hidden />
                <main className={'gb-main'} id={'gb-main'}>
                    <div ref={content} className={'gb-main-inner'}>
                        {children}
                    </div>
                </main>
            </div>
            <GobiaFooter />
        </div>
    );
}

/** The Gobia application shell: top bar, sidebar (filled by each area through <SidebarContent>), content and footer. */
export default function GobiaShell({ children }: { children: React.ReactNode }) {
    return (
        <ShellProvider>
            <Shell>{children}</Shell>
        </ShellProvider>
    );
}
