import { useLocation } from '@tanstack/react-router';
import { TabLinks } from '@/components/admin/AdminTabs';
import { useCurrentServer } from '@/api/server/queries';
import { usePermissions } from '@/plugins/usePermissions';

/** Settings has two tabs, each its own address: General and Startup. A tab the person may not use is not shown. */
export default function ServerSettingsTabs() {
    const id = useCurrentServer()!.attributes.identifier;
    const path = useLocation({ select: (location) => location.pathname.replace(/\/+$/, '') });
    const [settings, sftp, startup] = usePermissions(['settings.*', 'file.sftp', 'startup.*']);
    const tabs = [
        ...(settings || sftp ? [{ label: 'General', to: `/server/${id}/settings` }] : []),
        ...(startup ? [{ label: 'Startup', to: `/server/${id}/settings/startup` }] : []),
    ];

    return tabs.length > 1 ? <TabLinks label={'Settings'} tabs={tabs} path={path} /> : null;
}
