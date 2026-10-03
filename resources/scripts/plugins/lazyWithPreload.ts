import { ComponentType, lazy, LazyExoticComponent } from 'react';

export type PreloadableComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
    preload: () => Promise<unknown>;
};

// React.lazy with a preload() handle, so a route's chunk can be fetched when the user is about to navigate to it
// (hover, focus, touch) or while the browser is idle, instead of only after they click.
export default function lazyWithPreload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>
): PreloadableComponent<T> {
    const component = lazy(factory) as PreloadableComponent<T>;
    component.preload = factory;

    return component;
}
