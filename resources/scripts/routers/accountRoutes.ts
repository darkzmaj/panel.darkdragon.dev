import { lazy } from 'react';
import { RouteDefinition } from '@/routers/types';

// Only the dashboard router imports these. They share one chunk that loads when an account page is first visited.
const AccountOverviewContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/AccountOverviewContainer')
);
const AccountApiContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/AccountApiContainer')
);
const AccountSSHContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/ssh/AccountSSHContainer')
);
const ActivityLogContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/activity/ActivityLogContainer')
);

export default [
    {
        path: '/',
        name: 'Account',
        component: AccountOverviewContainer,
        exact: true,
    },
    {
        path: '/api',
        name: 'API Credentials',
        component: AccountApiContainer,
    },
    {
        path: '/ssh',
        name: 'SSH Keys',
        component: AccountSSHContainer,
    },
    {
        path: '/activity',
        name: 'Activity',
        component: ActivityLogContainer,
    },
] as RouteDefinition[];
