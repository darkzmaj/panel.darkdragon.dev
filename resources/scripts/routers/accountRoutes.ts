import { lazy } from 'react';
import { RouteDefinition } from '@/routers/types';

// Only the dashboard router imports these. They share one chunk that loads when an account page is first visited.
const ProfileContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/ProfileContainer')
);
const SecurityContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/SecurityContainer')
);
const AccessContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/access/AccessContainer')
);
const ActivityLogContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/activity/ActivityLogContainer')
);
const AccountApiContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/AccountApiContainer')
);
const AccountSSHContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/ssh/AccountSSHContainer')
);

export default [
    { path: '/', name: 'Profile', component: ProfileContainer, exact: true },
    { path: '/security', name: 'Security', component: SecurityContainer },
    { path: '/access', name: 'Access', component: AccessContainer },
    { path: '/activity', name: 'Activity', component: ActivityLogContainer },
    { path: '/api', name: 'API Credentials', component: AccountApiContainer },
    { path: '/ssh', name: 'SSH Keys', component: AccountSSHContainer },
] as RouteDefinition[];
