import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { queryClient } from '@/api/queryClient';
import { buildRouteTree } from '@/router/routeTree';
import RouteError from '@/router/RouteError';
import PageSkeleton from '@/gobia/PageSkeleton';
import { NotFound } from '@/components/elements/ScreenBlock';

export const router = createRouter({
    routeTree: buildRouteTree(),
    context: { queryClient },
    history: createBrowserHistory(),
    defaultPreload: 'intent',
    defaultPreloadDelay: 800,
    defaultPreloadStaleTime: 0,
    // The Gobia shell stays still and only the page area animates (gobia.css), so the root cross fade is off.
    defaultViewTransition: false,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    scrollRestoration: true,
    defaultPendingComponent: PageSkeleton,
    defaultNotFoundComponent: () => <NotFound />,
    defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

declare module '@tanstack/history' {
    interface HistoryState {
        // Login confirmation token for the 2FA checkpoint.
        token?: string;
        // Set when a request was redirected to /account for 2FA setup.
        twoFactorRedirect?: boolean;
    }
}
