import { useCurrentServer, type ReplacementProps } from '@pterodactyl/sdk';
import { Menu } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mark } from './timing';
import { usePane } from './usePane';
import type { TreeSource } from './useTree';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 520;
const SIDEBAR_KEY = 'gobia-files:sidebar';

const readStored = (key: string, fallback: number) => {
    try {
        const value = Number(window.localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
        return fallback;
    }
};

export default function Workspace({ model }: ReplacementProps<'server.files.manager'>) {
    const uuid = useCurrentServer((server) => server.attributes.uuid) ?? '';
    // The Panel has usually listed the root already; the explorer takes that listing instead of asking again.
    const [waited, setWaited] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setWaited(true), 1500);
        return () => window.clearTimeout(timer);
    }, []);
    const treeSource = useMemo<TreeSource>(() => {
        if (model.directory !== '/' || model.truncated) return 'fetch';
        if (model.loading) return waited ? 'fetch' : 'wait';
        if (model.entries.length === 0 || model.entries.some((entry) => entry.kind === 'symlink')) return 'fetch';
        return model.entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            directory: entry.kind === 'directory',
            size: entry.size,
            mimetype: entry.mimetype,
            modifiedAt: entry.modifiedAt,
        }));
    }, [model.directory, model.truncated, model.loading, model.entries, waited]);

    const [drawer, setDrawer] = useState(false);
    const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
    const [sidebar, setSidebar] = useState(() => readStored(SIDEBAR_KEY, 288));
    useEffect(() => {
        const query = window.matchMedia('(max-width: 767px)');
        const change = () => setMobile(query.matches);
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, []);

    const pane = usePane({
        uuid,
        paneId: 'a',
        permissions: model.permissions,
        treeSource,
        mobile,
        onNavigate: () => setDrawer(false),
    });

    // The browser's own Save Page shortcut belongs to the workspace while it is open. Monaco handles it itself while it
    // has focus; everywhere else (explorer, tab strip, empty page) this listener does, and always cancels the default.
    const saving = useRef(pane);
    saving.current = pane;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
            event.preventDefault();
            mark('save-key');
            if ((event.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
            const current = saving.current;
            if (event.shiftKey) void current.saveAll();
            else if (current.active) void current.save(current.active.path);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, []);

    const startResize = (event: React.PointerEvent) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = sidebar;
        const move = (next: PointerEvent) =>
            setSidebar(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + next.clientX - startX)));
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setSidebar((width) => {
                try {
                    window.localStorage.setItem(SIDEBAR_KEY, String(width));
                } catch {
                    // The width simply is not remembered.
                }
                return width;
            });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    return (
        <div className={'gb-page'}>
            <div className={'gb-workspace-head'}>
                <button
                    type={'button'}
                    aria-label={mobile ? (drawer ? 'Hide file explorer' : 'Show file explorer') : 'Files'}
                    aria-expanded={drawer}
                    onClick={() => setDrawer((open) => !open)}
                    className={'gb-icon-btn gb-icon-btn-sm'}
                    style={mobile ? undefined : { display: 'none' }}
                    tabIndex={mobile ? 0 : -1}
                >
                    <Menu aria-hidden />
                </button>
                <p className={'gb-workspace-path'} title={pane.state.active ?? ''}>
                    {pane.state.active ?? 'File editor'}
                </p>
            </div>

            <div className={'gb-workspace'} style={{ height: 'calc(100dvh - 11rem)', minHeight: 420 }}>
                {!mobile && (
                    <>
                        <aside className={'gb-explorer'} style={{ width: sidebar }} aria-label={'File explorer'}>
                            {pane.explorer}
                        </aside>
                        <div
                            role={'separator'}
                            aria-orientation={'vertical'}
                            aria-valuenow={sidebar}
                            aria-valuemin={MIN_SIDEBAR}
                            aria-valuemax={MAX_SIDEBAR}
                            aria-label={'Resize file explorer'}
                            tabIndex={0}
                            onPointerDown={startResize}
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowLeft') setSidebar((width) => Math.max(MIN_SIDEBAR, width - 16));
                                if (event.key === 'ArrowRight')
                                    setSidebar((width) => Math.min(MAX_SIDEBAR, width + 16));
                            }}
                            className={'gb-resizer'}
                        />
                    </>
                )}

                <section
                    aria-label={'Editor'}
                    style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
                >
                    {pane.editor}
                </section>

                {mobile && drawer && (
                    <>
                        <div className={'gb-drawer-mask'} onClick={() => setDrawer(false)} aria-hidden />
                        <aside className={'gb-drawer'} aria-label={'File explorer'}>
                            {pane.explorer}
                        </aside>
                    </>
                )}
            </div>

            {pane.overlays}
        </div>
    );
}
