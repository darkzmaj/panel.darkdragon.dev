import { lazy } from 'react';
import { Activity, KeyRound, Palette, ShieldCheck, Terminal, User, Users } from 'lucide-react';
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
const AppearanceContainer = lazy(
    () => import(/* webpackChunkName: "account-pages" */ '@/components/dashboard/AppearanceContainer')
);

export default [
    { path: '/', name: 'Profile', icon: User, component: ProfileContainer, exact: true },
    { path: '/security', name: 'Security', icon: ShieldCheck, component: SecurityContainer },
    { path: '/access', name: 'Access', icon: Users, component: AccessContainer },
    { path: '/activity', name: 'Activity', icon: Activity, component: ActivityLogContainer },
    { path: '/api', name: 'API Credentials', icon: KeyRound, component: AccountApiContainer },
    { path: '/ssh', name: 'SSH Keys', icon: Terminal, component: AccountSSHContainer },
    { path: '/appearance', name: 'Appearance', icon: Palette, component: AppearanceContainer },
] as RouteDefinition[];
