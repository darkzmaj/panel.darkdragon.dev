import React from 'react';

export interface RouteDefinition {
    path: string;
    // If undefined is passed this route is still rendered into the router itself
    // but no navigation link is displayed in the sub-navigation menu.
    name: string | undefined;
    component: React.ComponentType;
    exact?: boolean;
}

export interface ServerRouteDefinition extends RouteDefinition {
    permission: string | string[] | null;
}
