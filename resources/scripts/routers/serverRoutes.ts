import lazyWithPreload from '@/plugins/lazyWithPreload';
import ServerConsole from '@/components/server/console/ServerConsoleContainer';
import { ServerRouteDefinition } from '@/routers/types';

// The console is the landing page of a server so it is part of the server chunk. The other pages share
// one chunk that is loaded the first time any of them is visited. The editors are heavier and separate.
const FileManagerContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/files/FileManagerContainer')
);
const FileWorkspace = lazyWithPreload(
    () => import(/* webpackChunkName: "file-workspace" */ '@/components/server/files/workspace/FileWorkspace')
);
const DatabasesContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/databases/DatabasesContainer')
);
const ScheduleContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/schedules/ScheduleContainer')
);
const ScheduleEditContainer = lazyWithPreload(() => import('@/components/server/schedules/ScheduleEditContainer'));
const BackupContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/backups/BackupContainer')
);
const NetworkContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/network/NetworkContainer')
);
const StartupContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/startup/StartupContainer')
);
const SettingsContainer = lazyWithPreload(
    () => import(/* webpackChunkName: "server-pages" */ '@/components/server/settings/SettingsContainer')
);
const ServerActivityLogContainer = lazyWithPreload(
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
        preload: FileManagerContainer.preload,
        idle: true,
    },
    {
        path: '/files/:action(edit|new)',
        permission: 'file.*',
        name: undefined,
        component: FileWorkspace,
        preload: FileWorkspace.preload,
    },
    {
        path: '/databases',
        permission: 'database.*',
        name: 'Databases',
        component: DatabasesContainer,
        preload: DatabasesContainer.preload,
        idle: true,
    },
    {
        path: '/schedules',
        permission: 'schedule.*',
        name: 'Schedules',
        component: ScheduleContainer,
        preload: ScheduleContainer.preload,
        idle: true,
    },
    {
        path: '/schedules/:id',
        permission: 'schedule.*',
        name: undefined,
        component: ScheduleEditContainer,
        preload: ScheduleEditContainer.preload,
        idle: true,
    },
    {
        path: '/backups',
        permission: 'backup.*',
        name: 'Backups',
        component: BackupContainer,
        preload: BackupContainer.preload,
        idle: true,
    },
    {
        path: '/network',
        permission: 'allocation.*',
        name: 'Network',
        component: NetworkContainer,
        preload: NetworkContainer.preload,
        idle: true,
    },
    {
        path: '/startup',
        permission: 'startup.*',
        name: 'Startup',
        component: StartupContainer,
        preload: StartupContainer.preload,
        idle: true,
    },
    {
        path: '/settings',
        permission: ['settings.*', 'file.sftp'],
        name: 'Settings',
        component: SettingsContainer,
        preload: SettingsContainer.preload,
        idle: true,
    },
    {
        path: '/activity',
        permission: 'activity.*',
        name: 'Activity',
        component: ServerActivityLogContainer,
        preload: ServerActivityLogContainer.preload,
        idle: true,
    },
] as ServerRouteDefinition[];
