import { Link, useLocation } from '@tanstack/react-router';
import { cn } from '@/lib/cn';

interface Tab {
    label: string;
    to: string;
}

export interface AdminTabGroup {
    /** The heading shown above the tabs, in place of the page's own. */
    heading: string;
    tabs: Tab[];
}

const settings = (label: string, to: string): Tab => ({ label, to });

/** Related admin pages shown as one workspace: each tab is the page's own address, so links and refresh keep working. */
export const adminTabGroups: AdminTabGroup[] = [
    {
        heading: 'Nodes & Instances',
        tabs: [
            { label: 'Nodes', to: '/panel/nodes' },
            { label: 'Instances', to: '/panel/servers' },
        ],
    },
    {
        heading: 'Eggs & Mounts',
        tabs: [
            { label: 'Eggs', to: '/panel/eggs' },
            { label: 'Mounts', to: '/panel/mounts' },
        ],
    },
    {
        heading: 'Settings',
        tabs: [
            settings('General', '/panel/settings'),
            settings('Mail', '/panel/settings/mail'),
            settings('Advanced', '/panel/settings/advanced'),
            settings('API Keys', '/panel/api'),
            settings('Extensions', '/panel/extensions'),
            settings('Tags', '/panel/tags'),
        ],
    },
];

export function tabGroupFor(pathname: string): AdminTabGroup | undefined {
    const path = pathname.replace(/\/+$/, '');

    return adminTabGroups.find((group) => group.tabs.some((tab) => tab.to === path));
}

export default function AdminTabs() {
    const path = useLocation({ select: (location) => location.pathname.replace(/\/+$/, '') });
    const group = tabGroupFor(path);
    if (!group) return null;

    return (
        <nav aria-label={group.heading} className={'flex flex-wrap border-b border-border mb-6'}>
            {group.tabs.map((tab) => {
                const active = tab.to === path;

                return (
                    <Link
                        key={tab.to}
                        to={tab.to}
                        viewTransition={false}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                            'px-4 py-2 text-sm uppercase tracking-wide border-b-2 transition-colors duration-150',
                            active
                                ? 'border-primary text-foreground'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
