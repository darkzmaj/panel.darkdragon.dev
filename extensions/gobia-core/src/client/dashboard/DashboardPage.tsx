import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
    PageContentBlock,
    Pagination,
    PanelLink,
    Spinner,
    type ReplacementProps,
} from '@pterodactyl/sdk';
import { Search, Settings2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { AddToCategoryDialog, ManageCategoriesDialog } from './CategoryDialogs';
import IconColorDialog from './IconColorDialog';
import InstanceRow from './InstanceRow';
import { useInstances, useReorder, useSummary } from './queries';
import type { CategoryFilter, Instance, View } from './types';
import { useDragReorder } from './useDragReorder';

const VIEWS: { id: View; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'you', label: 'You' },
    { id: 'other', label: 'Other' },
];

function Pill({
    active,
    onClick,
    children,
    count,
}: {
    active: boolean;
    onClick: () => void;
    children: string;
    count?: number;
}) {
    return (
        <button
            type={'button'}
            aria-pressed={active}
            onClick={onClick}
            className={
                'gb:inline-flex gb:items-center gb:gap-2 gb:rounded-full gb:border gb:px-3 gb:py-1 gb:text-sm gb:transition-colors gb:focus-visible:outline-2 gb:focus-visible:outline-ring ' +
                (active
                    ? 'gb:border-primary gb:bg-primary gb:text-primary-foreground'
                    : 'gb:border-border gb:bg-card gb:text-muted-foreground gb:hover:text-foreground')
            }
        >
            {children}
            {count !== undefined && <span className={'gb:text-xs gb:opacity-75'}>{count}</span>}
        </button>
    );
}

export default function DashboardPage({ model }: ReplacementProps<'dashboard.page'>) {
    const [view, setView] = useState<View>('all');
    const [category, setCategory] = useState<CategoryFilter>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [colorFor, setColorFor] = useState<Instance | null>(null);
    const [categoriesFor, setCategoriesFor] = useState<Instance | null>(null);
    const [managing, setManaging] = useState(false);
    const q = useDeferredValue(search);

    const params = useMemo(() => ({ view, category, q, page }), [view, category, q, page]);
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
            <div className={'gb:mb-4 gb:flex gb:flex-wrap gb:items-center gb:justify-between gb:gap-3'}>
                <h1 className={'gb:font-header gb:text-2xl gb:font-medium gb:text-foreground'}>Instances</h1>
                <div className={'gb:flex gb:items-center gb:gap-2'}>
                    <label className={'gb:relative gb:block'}>
                        <span className={'gb:sr-only'}>Search instances</span>
                        <Search
                            size={16}
                            aria-hidden
                            className={
                                'gb:pointer-events-none gb:absolute gb:left-3 gb:top-1/2 gb:-translate-y-1/2 gb:text-muted-foreground'
                            }
                        />
                        <input
                            type={'search'}
                            value={search}
                            placeholder={'Search'}
                            onChange={(event) => {
                                setSearch(event.currentTarget.value);
                                setPage(1);
                            }}
                            className={
                                'gb:w-56 gb:rounded-md gb:border gb:border-input gb:bg-background gb:py-2 gb:pl-9 gb:pr-3 gb:text-sm gb:text-foreground'
                            }
                        />
                    </label>
                    {model.rootAdmin && (
                        <PanelLink
                            destination={{ to: '/panel/servers/new' }}
                            className={
                                'gb:rounded-md gb:bg-primary gb:px-3 gb:py-2 gb:text-sm gb:font-medium gb:text-primary-foreground gb:no-underline'
                            }
                        >
                            Create instance
                        </PanelLink>
                    )}
                </div>
            </div>

            <div
                className={'gb:mb-3 gb:flex gb:flex-wrap gb:items-center gb:gap-2'}
                role={'group'}
                aria-label={'Filter instances'}
            >
                {VIEWS.map((item) => (
                    <Pill
                        key={item.id}
                        active={view === item.id}
                        count={summary?.counts[item.id]}
                        onClick={() => choose({ view: item.id })}
                    >
                        {item.label}
                    </Pill>
                ))}
                <span className={'gb:mx-1 gb:h-5 gb:w-px gb:bg-border'} aria-hidden />
                <Pill active={category === null} onClick={() => choose({ category: null })}>
                    Every category
                </Pill>
                {summary?.categories.map((item) => (
                    <Pill
                        key={item.id}
                        active={category === item.id}
                        count={item.count}
                        onClick={() => choose({ category: item.id })}
                    >
                        {item.name}
                    </Pill>
                ))}
                {summary && summary.categories.length > 0 && (
                    <Pill
                        active={category === 'none'}
                        count={summary.uncategorized}
                        onClick={() => choose({ category: 'none' })}
                    >
                        Uncategorized
                    </Pill>
                )}
                <button
                    type={'button'}
                    onClick={() => setManaging(true)}
                    className={
                        'gb:ml-auto gb:inline-flex gb:items-center gb:gap-2 gb:rounded-md gb:px-2 gb:py-1 gb:text-sm gb:text-muted-foreground gb:hover:text-foreground'
                    }
                >
                    <Settings2 size={16} aria-hidden /> Categories
                </button>
            </div>

            <div aria-live={'polite'} className={'gb:sr-only'}>
                {drag.announcement}
            </div>

            {isPending ? (
                <Spinner centered size={'large'} />
            ) : isError ? (
                <Empty className={'gb:border gb:bg-card'}>
                    <EmptyHeader>
                        <EmptyTitle>Instances could not be loaded</EmptyTitle>
                        <EmptyDescription>Check your connection and try again.</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        <button
                            type={'button'}
                            onClick={() => refetch()}
                            className={'gb:rounded-md gb:border gb:border-border gb:px-3 gb:py-1.5 gb:text-sm'}
                        >
                            Retry
                        </button>
                    </EmptyContent>
                </Empty>
            ) : data && ordered.length > 0 ? (
                <Pagination data={data} onPageSelect={setPage}>
                    {() => (
                        <ul className={'gb:flex gb:flex-col gb:gap-2'} aria-label={'Instances'}>
                            {ordered.map((instance) => (
                                <li key={instance.uuid}>
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
                    )}
                </Pagination>
            ) : (
                <Empty className={'gb:border gb:bg-card'}>
                    <EmptyHeader>
                        <EmptyTitle>
                            {q || category !== null || view !== 'all' ? 'No instances match' : 'No instances yet'}
                        </EmptyTitle>
                        <EmptyDescription>
                            {q || category !== null || view !== 'all'
                                ? 'Try a different filter or search.'
                                : 'Instances you own or are invited to appear here.'}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
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
                    className={
                        'gb:rounded-lg gb:border gb:border-primary gb:bg-card gb:px-3 gb:py-2 gb:text-sm gb:font-medium gb:shadow-lg'
                    }
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
            {managing && (
                <ManageCategoriesDialog categories={summary?.categories ?? []} onClose={() => setManaging(false)} />
            )}
        </PageContentBlock>
    );
}
