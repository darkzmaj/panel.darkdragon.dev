import { lazy } from 'react';
import ServerConsole from '@/components/server/console/ServerConsoleContainer';
import { ServerRouteDefinition } from '@/routers/types';

// The console is the landing page of a server so it is part of the server chunk. The other pages share
// one chunk that is loaded the first time any of them is visited. The editors are heavier and separate.
const FileManagerContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/files/FileManagerContainer')
);
const FileEditContainer = lazy(() => import('@/components/server/files/FileEditContainer'));
const DatabasesContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/databases/DatabasesContainer')
);
const ScheduleContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/schedules/ScheduleContainer')
);
const ScheduleEditContainer = lazy(() => import('@/components/server/schedules/ScheduleEditContainer'));
const UsersContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/users/UsersContainer')
);
const BackupContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/backups/BackupContainer')
);
const NetworkContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/network/NetworkContainer')
);
const StartupContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/startup/StartupContainer')
);
const SettingsContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/settings/SettingsContainer')
);
const ServerActivityLogContainer = lazy(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/ServerActivityLogContainer')
);

export default [
    {
        path: '/',
        permission: null,
        name: 'Console',
        component: ServerConsole,
        exact: true,
    },
    {
        path: '/files',
        permission: 'file.*',
        name: 'Files',
        component: FileManagerContainer,
    },
    {
        path: '/files/:action(edit|new)',
        permission: 'file.*',
        name: undefined,
        component: FileEditContainer,
    },
    {
        path: '/databases',
        permission: 'database.*',
        name: 'Databases',
        component: DatabasesContainer,
    },
    {
        path: '/schedules',
        permission: 'schedule.*',
        name: 'Schedules',
        component: ScheduleContainer,
    },
    {
        path: '/schedules/:id',
        permission: 'schedule.*',
        name: undefined,
        component: ScheduleEditContainer,
    },
    {
        path: '/users',
        permission: 'user.*',
        name: 'Users',
        component: UsersContainer,
    },
    {
        path: '/backups',
        permission: 'backup.*',
        name: 'Backups',
        component: BackupContainer,
    },
    {
        path: '/network',
        permission: 'allocation.*',
        name: 'Network',
        component: NetworkContainer,
    },
    {
        path: '/startup',
        permission: 'startup.*',
        name: 'Startup',
        component: StartupContainer,
    },
    {
        path: '/settings',
        permission: ['settings.*', 'file.sftp'],
        name: 'Settings',
        component: SettingsContainer,
    },
    {
        path: '/activity',
        permission: 'activity.*',
        name: 'Activity',
        component: ServerActivityLogContainer,
    },
] as ServerRouteDefinition[];
