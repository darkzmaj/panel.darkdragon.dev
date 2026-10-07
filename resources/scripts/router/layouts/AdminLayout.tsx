import { Outlet } from '@tanstack/react-router';
import { SidebarContent } from '@/gobia/shell/ShellContext';
import { AdminSidebar } from '@/gobia/shell/Sidebars';

export default function AdminLayout() {
    return (
        <>
            <SidebarContent>
                <AdminSidebar />
            </SidebarContent>
            <div className={'min-w-0'}>
                <Outlet />
            </div>
        </>
    );
}
