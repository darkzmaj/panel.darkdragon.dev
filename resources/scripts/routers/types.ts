import React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface RouteDefinition {
    path: string;
    // If undefined is passed this route is still rendered into the router itself
    // but no navigation link is displayed in the sub-navigation menu.
    name: string | undefined;
    component: React.ComponentType;
    exact?: boolean;
    icon?: LucideIcon;
    // Fetches the route's chunk ahead of time. Optional because eagerly bundled routes have nothing to fetch.
    preload?: () => void;
    // Whether the chunk may be fetched while the browser is idle (leave false for heavy routes).
    idle?: boolean;
}

export interface ServerRouteDefinition extends RouteDefinition {
    permission: string | string[] | null;
}
