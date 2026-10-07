import { Outlet, useLocation } from '@tanstack/react-router';
import GobiaShell from '@/gobia/shell/GobiaShell';
import { SidebarContent } from '@/gobia/shell/ShellContext';
import { DefaultSidebar } from '@/gobia/shell/Sidebars';

export default function AuthenticatedLayout() {
    const { pathname } = useLocation();
    // Server and administration pages bring their own sidebar.
    const ownsSidebar = pathname.startsWith('/server/') || pathname === '/panel' || pathname.startsWith('/panel/');

    return (
        <GobiaShell>
            {!ownsSidebar && (
                <SidebarContent>
                    <DefaultSidebar />
                </SidebarContent>
            )}
            <Outlet />
        </GobiaShell>
    );
}
