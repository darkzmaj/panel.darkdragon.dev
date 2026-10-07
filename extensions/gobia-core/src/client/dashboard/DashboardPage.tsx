import { PageContentBlock, Pagination, toast, usePanelNavigate, type ReplacementProps } from '@pterodactyl/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FolderPlus, Palette, Pencil, Plus, Search, SquareArrowOutUpRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CategoryEditor from './CategoryEditor';
import ContextMenu, { type MenuState } from './ContextMenu';
import IconColorDialog from './IconColorDialog';
import InstanceRow from './InstanceRow';
import { keys, useInstances, useReorder, useSummary } from './queries';
import type { CategoryFilter, Instance, InstancePage, View } from './types';
import { useSortable } from './useSortable';
import CreateInstanceDialog from '../create/CreateInstanceDialog';

const VIEWS: { id: View; label: string; hint: string }[] = [
    { id: 'all', label: 'All', hint: 'Every instance you can access' },
    { id: 'you', label: 'You', hint: 'Instances you own' },
    { id: 'other', label: 'Other', hint: 'Instances shared with you by someone else' },
];

/** The "All / You / Other" chip: opens a small menu to pick which instances are listed, with true counts. */
function ViewMenu({
    view,
    counts,
    onChange,
}: {
    view: View;
    counts: Record<View, number> | undefined;
    onChange: (view: View) => void;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const current = VIEWS.find((item) => item.id === view) ?? VIEWS[0];

    useEffect(() => {
        if (!open) return;
        const away = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
        const key = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOpen(false);
            trigger.current?.focus();
        };
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
                ref={trigger}
                type={'button'}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className={'gb-chip active'}
            >
                {current?.label}
                <ChevronDown aria-hidden />
            </button>
            {open && (
                <div
                    role={'listbox'}
                    aria-label={'Instance view'}
                    className={'gb-menu gb-pop'}
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
                                trigger.current?.focus();
                            }}
                            className={'gb-menu-item'}
                            style={{ height: 'auto', padding: '8px 10px', minWidth: 260 }}
                        >
                            <span style={{ flex: 1 }}>
                                <span style={{ display: 'block', color: 'var(--gb-text-strong)', fontWeight: 600 }}>
                                    {item.label}
                                    {counts && (
                                        <span className={'gb-muted'} style={{ fontWeight: 400 }}>
                                            {' '}
                                            · {counts[item.id]}
                                        </span>
                                    )}
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
    const queryClient = useQueryClient();
    const navigate = usePanelNavigate();
    const [view, setView] = useState<View>('all');
    const [category, setCategory] = useState<CategoryFilter>(null);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [colorFor, setColorFor] = useState<Instance | null>(null);
    const [editing, setEditing] = useState<{ instance: Instance | null } | null>(null);
    const [creating, setCreating] = useState(false);
    const [menu, setMenu] = useState<MenuState | null>(null);

    // The list follows the search box a moment after typing stops.
    useEffect(() => {
        const timer = setTimeout(() => {
            setQ(search);
            setPage(1);
        }, 200);
        return () => clearTimeout(timer);
    }, [search]);

    const params = useMemo(() => ({ view, category, q, page }), [view, category, q, page]);
    const { data, isPending, isError, refetch } = useInstances(params);
    const { data: summary } = useSummary();
    const persist = useReorder();

    // A category that was deleted (here or elsewhere) must never stay selected: its list would be empty for no visible reason.
    useEffect(() => {
        if (
            category !== null &&
            category !== 'none' &&
            summary &&
            !summary.categories.some((item) => item.id === category)
        ) {
            setCategory(null);
            setPage(1);
        }
    }, [summary, category]);

    const items = useMemo(() => data?.data ?? [], [data]);
    const byUuid = useMemo(() => new Map(items.map((item) => [item.uuid, item])), [items]);

    // The new order shows at once; if it cannot be stored the previous one is restored and the user is told.
    const reorder = useCallback(
        (ids: string[]) => {
            const key = keys.list(params);
            const previous = queryClient.getQueryData<InstancePage>(key);
            if (previous) {
                const next = ids.map((id) => byUuid.get(id)).filter((item): item is Instance => item !== undefined);
                queryClient.setQueryData<InstancePage>(key, { ...previous, data: next });
            }
            persist.mutate(
                { category, servers: ids },
                {
                    onError: () => {
                        if (previous) queryClient.setQueryData(key, previous);
                        toast.error('Could not save the instance order. Your previous order is unchanged.');
                    },
                }
            );
        },
        [params, queryClient, byUuid, persist, category]
    );

    const openMenu = useCallback(
        (instance: Instance, x: number, y: number) =>
            setMenu({
                x,
                y,
                label: `Actions for ${instance.name}`,
                items: [
                    {
                        key: 'open',
                        label: 'Open',
                        icon: SquareArrowOutUpRight,
                        onSelect: () => void navigate({ to: '/server/$id', params: { id: instance.identifier } }),
                    },
                    { key: 'color', label: 'Change icon colour', icon: Palette, onSelect: () => setColorFor(instance) },
                    {
                        key: 'category',
                        label: 'Add to category',
                        icon: FolderPlus,
                        onSelect: () => setEditing({ instance }),
                    },
                ],
            }),
        [navigate]
    );

    const sortable = useSortable({
        ids: items.map((item) => item.uuid),
        onReorder: reorder,
        onMenu: (id, x, y) => {
            const instance = byUuid.get(id);
            if (instance) openMenu(instance, x, y);
        },
    });

    const choose = (next: { view?: View; category?: CategoryFilter }) => {
        if (next.view !== undefined) setView(next.view);
        if (next.category !== undefined) setCategory(next.category);
        setPage(1);
    };

    const filtering = category !== null || view !== 'all' || q.trim() !== '';

    return (
        <PageContentBlock title={'Instances'}>
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>Instances</h1>
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
                    <ViewMenu view={view} counts={data?.meta.counts} onChange={(next) => choose({ view: next })} />
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
                    <label className={'gb-filter-search'}>
                        <Search aria-hidden />
                        <input
                            type={'search'}
                            value={search}
                            onChange={(event) => setSearch(event.currentTarget.value)}
                            placeholder={'Search'}
                            aria-label={'Search instances'}
                            autoComplete={'off'}
                        />
                        {search && (
                            <button type={'button'} aria-label={'Clear search'} onClick={() => setSearch('')}>
                                <X aria-hidden />
                            </button>
                        )}
                    </label>
                    <button
                        type={'button'}
                        onClick={() => setEditing({ instance: null })}
                        title={'Edit categories'}
                        aria-label={'Edit categories'}
                        className={'gb-chip gb-chip-icon'}
                    >
                        <Pencil aria-hidden />
                        <span className={'gb-chip-label'}>Edit</span>
                    </button>
                </div>
            </div>

            {isPending ? (
                <div className={'gb-list gb-enter'}>
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
            ) : data && items.length > 0 ? (
                <Pagination data={data} onPageSelect={setPage}>
                    {() => (
                        <div className={'gb-list gb-server-list gb-enter'}>
                            <div className={'gb-list-head gb-server-head'} aria-hidden>
                                <span>Instance</span>
                                <span className={'gb-col-where'}>Node &amp; address</span>
                                <span className={'gb-col-stats'}>CPU &middot; Memory &middot; Storage</span>
                            </div>
                            <ul
                                ref={sortable.list}
                                style={{ listStyle: 'none', margin: 0, padding: 0 }}
                                aria-label={'Instances'}
                            >
                                {items.map((instance, index) => (
                                    <InstanceRow
                                        key={instance.uuid}
                                        instance={instance}
                                        index={index}
                                        sortable={sortable}
                                        onMenu={openMenu}
                                    />
                                ))}
                            </ul>
                        </div>
                    )}
                </Pagination>
            ) : (
                <p className={'gb-list gb-secondary'} style={{ textAlign: 'center', padding: '40px 16px' }}>
                    {filtering
                        ? 'No instances match this view.'
                        : 'There are no instances associated with your account.'}
                </p>
            )}

            <ContextMenu menu={menu} onClose={() => setMenu(null)} />
            {colorFor && (
                <IconColorDialog
                    instance={colorFor}
                    recent={summary?.recent_icon_colors ?? []}
                    onClose={() => setColorFor(null)}
                />
            )}
            {editing && (
                <CategoryEditor
                    categories={summary?.categories ?? []}
                    instance={editing.instance}
                    onClose={() => setEditing(null)}
                    onDeleted={(id) => {
                        if (category === id) choose({ category: null });
                    }}
                />
            )}
            {creating && <CreateInstanceDialog onClose={() => setCreating(false)} />}
        </PageContentBlock>
    );
}
