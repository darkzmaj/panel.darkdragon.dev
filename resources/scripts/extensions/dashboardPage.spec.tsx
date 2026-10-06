/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReplacementProps } from './componentTypes';
import type * as Registry from './registry';

// Gobia patch coverage: the replaceable `dashboard.page` must keep the native page (and its queries) from mounting.
let registry: typeof Registry;
beforeEach(async () => {
    vi.resetModules();
    registry = await import('./registry');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

async function page() {
    const { default: View } = await import('./ComponentView');
    const { ComponentReplacementSession: Session } = await import('./componentSession');
    const native = vi.fn(() => <span>Native dashboard</span>);
    const Default = () => native();
    function Dashboard() {
        return (
            <Session>
                <View
                    name='dashboard.page'
                    resetKey='dashboard'
                    props={{ model: { rootAdmin: false }, Default, parts: {} }}
                    loading={<span>Loading dashboard</span>}
                />
            </Session>
        );
    }
    return { Dashboard, native };
}

it('shows the native dashboard when no extension replaces the page', async () => {
    const { Dashboard, native } = await page();
    render(<Dashboard />);
    expect(screen.getByText('Native dashboard')).toBeVisible();
    expect(native).toHaveBeenCalled();
});

it('mounts only the replacement when an extension declares and registers dashboard.page', async () => {
    registry.prepareExtensions([{ id: 'gobia-like', entry: '/client.js', components: ['dashboard.page'] }]);
    const batch = registry.createExtensionRegistryBatch();
    function Replacement({ model }: ReplacementProps<'dashboard.page'>) {
        return <span>Replacement for {model.rootAdmin ? 'admin' : 'user'}</span>;
    }
    registry.registerComponentReplacement('gobia-like', 'dashboard.page', Replacement, batch);
    registry.commitExtensionRegistryBatch('gobia-like', batch);

    const { Dashboard, native } = await page();
    render(<Dashboard />);
    expect(await screen.findByText('Replacement for user')).toBeVisible();
    expect(screen.queryByText('Native dashboard')).toBeNull();
    expect(native).not.toHaveBeenCalled();
});

it('falls back to the native dashboard when the replacement throws', async () => {
    registry.prepareExtensions([{ id: 'gobia-like', entry: '/client.js', components: ['dashboard.page'] }]);
    const batch = registry.createExtensionRegistryBatch();
    function Broken(): never {
        throw new Error('replacement failed');
    }
    registry.registerComponentReplacement('gobia-like', 'dashboard.page', Broken, batch);
    registry.commitExtensionRegistryBatch('gobia-like', batch);

    const { Dashboard } = await page();
    render(<Dashboard />);
    expect(await screen.findByText('Native dashboard')).toBeVisible();
});
