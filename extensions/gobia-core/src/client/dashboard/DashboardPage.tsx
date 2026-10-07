import { PageContentBlock, Pagination, type ReplacementProps } from '@pterodactyl/sdk';
import { Check, ChevronDown, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import CreateInstanceDialog from '../create/CreateInstanceDialog';
import { AddToCategoryDialog, ManageCategoriesDialog } from './CategoryDialogs';
import IconColorDialog from './IconColorDialog';
import InstanceRow from './InstanceRow';
import { useInstances, useReorder, useSummary } from './queries';
import type { CategoryFilter, Instance, View } from './types';
import { useDragReorder } from './useDragReorder';

const VIEWS: { id: View; label: string; hint: string }[] = [
    { id: 'all', label: 'All', hint: 'Every instance you can access' },
    { id: 'you', label: 'You', hint: 'Instances you own' },
    { id: 'other', label: 'Other', hint: 'Instances shared with you by someone else' },
];

/** The "All / You / Other" chip: opens a small menu to pick which instances are listed. */
function ViewMenu({ view, onChange }: { view: View; onChange: (view: View) => void }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const current = VIEWS.find((item) => item.id === view) ?? VIEWS[0];

    useEffect(() => {
        if (!open) return;
        const away = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
        const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', key);
        return () => {
            document.removeEventListener('mousedown', away);
            document.removeEventListener('keydown', key);
        };
    }, [open]);

    return (
        <div ref={root} style={{ position: 'relative', flex: 'none' }}>
            <button
                type={'button'}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className={'gb-chip active'}
            >
                {current.label}
                <ChevronDown aria-hidden />
            </button>
            {open && (
                <div
                    role={'listbox'}
                    aria-label={'Instance view'}
                    className={'gb-menu'}
                    style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 30 }}
                >
                    {VIEWS.map((item) => (
                        <button
                            key={item.id}
                            type={'button'}
                            role={'option'}
                            aria-selected={view === item.id}
                            onClick={() => {
                                onChange(item.id);
                                setOpen(false);
                            }}
                            className={'gb-menu-item'}
                            style={{ height: 'auto', padding: '8px 10px', minWidth: 260 }}
                        >
                            <span style={{ flex: 1 }}>
                                <span style={{ display: 'block', color: 'var(--gb-text-strong)', fontWeight: 600 }}>
                                    {item.label}
                                </span>
                                <span className={'gb-secondary'} style={{ fontSize: 12 }}>
                                    {item.hint}
                                </span>
                            </span>
                            {view === item.id && <Check aria-hidden style={{ color: 'var(--gb-primary)' }} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function DashboardPage({ model }: ReplacementProps<'dashboard.page'>) {
    const [view, setView] = useState<View>('all');
    const [category, setCategory] = useState<CategoryFilter>(null);
    const [page, setPage] = useState(1);
    const [colorFor, setColorFor] = useState<Instance | null>(null);
    const [categoriesFor, setCategoriesFor] = useState<Instance | null>(null);
    const [managing, setManaging] = useState(false);
    const [creating, setCreating] = useState(false);

    const params = useMemo(() => ({ view, category, q: '', page }), [view, category, page]);
    const { data, isPending, isError, refetch } = useInstances(params);
    const { data: summary } = useSummary();
    const reorder = useReorder();

    const items = useMemo(() => data?.data ?? [], [data]);
    const byUuid = useMemo(() => new Map(items.map((item) => [item.uuid, item])), [items]);
    const drag = useDragReorder({
        ids: items.map((item) => item.uuid),
        label: (id) => byUuid.get(id)?.name ?? 'Instance',
        onCommit: (servers) => reorder.mutate({ category, servers }),
    });
    const ordered = drag.order.map((id) => byUuid.get(id)).filter((item): item is Instance => item !== undefined);
    const dragged = drag.draggingId ? byUuid.get(drag.draggingId) : undefined;

    const choose = (next: { view?: View; category?: CategoryFilter }) => {
        if (next.view !== undefined) setView(next.view);
        if (next.category !== undefined) setCategory(next.category);
        setPage(1);
    };

    return (
        <PageContentBlock title={'Instances'}>
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h2>Instances</h2>
                    <p>Everything you own or have been given access to.</p>
                </div>
                {model.rootAdmin && (
                    <div className={'gb-page-actions'}>
                        <button type={'button'} className={'gb-btn gb-btn-primary'} onClick={() => setCreating(true)}>
                            <Plus aria-hidden /> Create Instance
                        </button>
                    </div>
                )}
            </div>

            <div style={{ marginBottom: 16 }}>
                <div className={'gb-filterbar'} role={'toolbar'} aria-label={'Instance views'}>
                    <ViewMenu view={view} onChange={(next) => choose({ view: next })} />
                    <div className={'gb-filterbar-scroll'}>
                        {summary?.categories.map((item) => (
                            <button
                                key={item.id}
                                type={'button'}
                                aria-pressed={category === item.id}
                                onClick={() => choose({ category: category === item.id ? null : item.id })}
                                className={'gb-chip' + (category === item.id ? ' active' : '')}
                            >
                                {item.name}
                            </button>
                        ))}
                        {summary && summary.categories.length > 0 && summary.uncategorized > 0 && (
                            <button
                                type={'button'}
                                aria-pressed={category === 'none'}
                                onClick={() => choose({ category: category === 'none' ? null : 'none' })}
                                className={'gb-chip' + (category === 'none' ? ' active' : '')}
                            >
                                Uncategorized
                            </button>
                        )}
                    </div>
                    <button
                        type={'button'}
                        onClick={() => setManaging(true)}
                        title={'Edit categories'}
                        aria-label={'Edit categories'}
                        className={'gb-chip gb-chip-icon'}
                    >
                        <Pencil aria-hidden />
                        <span className={'gb-chip-label'}>Edit</span>
                    </button>
                </div>
            </div>

            <div aria-live={'polite'} className={'sr-only'}>
                {drag.announcement}
            </div>

            {isPending ? (
                <div className={'gb-list'}>
                    {[0, 1, 2, 3].map((row) => (
                        <div
                            key={row}
                            className={'gb-skeleton'}
                            style={{
                                height: 66,
                                borderRadius: 0,
                                borderTop: row ? '1px solid var(--gb-border-muted)' : 0,
                            }}
                        />
                    ))}
                </div>
            ) : isError ? (
                <div className={'gb-list'} role={'alert'} style={{ padding: '40px 16px', textAlign: 'center' }}>
                    <p className={'gb-secondary'} style={{ marginBottom: 12 }}>
                        Instances could not be loaded. Check your connection and try again.
                    </p>
                    <button type={'button'} className={'gb-btn gb-btn-sm'} onClick={() => refetch()}>
                        Retry
                    </button>
                </div>
            ) : data && ordered.length > 0 ? (
                <Pagination data={data} onPageSelect={setPage}>
                    {() => (
                        <div className={'gb-list gb-server-list'}>
                            <div className={'gb-list-head gb-server-head'} aria-hidden>
                                <span>Instance</span>
                                <span className={'gb-col-where'}>Node &amp; address</span>
                                <span className={'gb-col-stats'}>CPU &middot; Memory &middot; Storage</span>
                            </div>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={'Instances'}>
                                {ordered.map((instance) => (
                                    <li key={instance.uuid} style={{ display: 'contents' }}>
                                        <InstanceRow
                                            instance={instance}
                                            dragging={drag.draggingId === instance.uuid}
                                            drag={drag}
                                            onColor={setColorFor}
                                            onCategories={setCategoriesFor}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Pagination>
            ) : (
                <p className={'gb-list gb-secondary'} style={{ textAlign: 'center', padding: '40px 16px' }}>
                    {category !== null || view !== 'all'
                        ? 'No instances match this view.'
                        : 'There are no instances associated with your account.'}
                </p>
            )}

            {dragged && drag.pointer && (
                <div
                    aria-hidden
                    style={{
                        position: 'fixed',
                        left: drag.pointer.x + 12,
                        top: drag.pointer.y - 18,
                        pointerEvents: 'none',
                        zIndex: 60,
                    }}
                    className={'gb-card'}
                >
                    {dragged.name}
                </div>
            )}

            {colorFor && (
                <IconColorDialog
                    instance={colorFor}
                    recent={summary?.recent_icon_colors ?? []}
                    onClose={() => setColorFor(null)}
                />
            )}
            {categoriesFor && (
                <AddToCategoryDialog
                    instance={categoriesFor}
                    categories={summary?.categories ?? []}
                    onClose={() => setCategoriesFor(null)}
                />
            )}
            {creating && <CreateInstanceDialog onClose={() => setCreating(false)} />}
            {managing && (
                <ManageCategoriesDialog categories={summary?.categories ?? []} onClose={() => setManaging(false)} />
            )}
        </PageContentBlock>
    );
}
