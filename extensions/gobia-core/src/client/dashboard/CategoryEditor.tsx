import { Dialog, http, httpErrorToHuman } from '@pterodactyl/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { moveItem } from './useSortable';
import { invalidateInstances } from './queries';
import type { Category, Instance, InstancePage } from './types';

const BASE = '/api/client/extensions/gobia-core';
const NEW = 0;

interface Named {
    uuid: string;
    name: string;
}

/** Every server the user can open (the editor needs the whole set), fetched page by page. */
async function fetchAll(category?: number): Promise<Named[]> {
    const found: Named[] = [];
    for (let page = 1; ; page++) {
        const result = (
            await http.get<InstancePage>(`${BASE}/servers`, {
                params: { view: 'all', per_page: 50, page, category },
            })
        ).data;
        found.push(...result.data.map(({ uuid, name }) => ({ uuid, name })));
        if (page >= result.meta.pagination.total_pages) return found;
    }
}

interface Props {
    categories: readonly Category[];
    /** The instance whose "Add to category" opened the editor; it starts ticked in a new category. */
    instance?: Instance | null;
    onClose: () => void;
    /** A category that was deleted, so the page can leave it. */
    onDeleted: (id: number) => void;
}

/**
 * The 1.x category editor: categories on the left, the selected one on the right with its name, the instances it
 * contains in order and the full list to tick from. Categories are private to the user.
 */
export default function CategoryEditor({ categories, instance, onClose, onDeleted }: Props) {
    const queryClient = useQueryClient();
    const everything = useQuery({ queryKey: ['gobia-core', 'editor', 'all'], queryFn: () => fetchAll(), staleTime: 0 });
    const [selected, setSelected] = useState<number>(NEW);
    const [name, setName] = useState('');
    const [members, setMembers] = useState<string[]>(instance ? [instance.uuid] : []);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const servers = everything.data ?? [];
    const nameOf = (uuid: string) => servers.find((server) => server.uuid === uuid)?.name ?? uuid;

    const select = async (category: Category | null) => {
        setSelected(category?.id ?? NEW);
        setName(category?.name ?? '');
        setError(null);
        setSaved(false);
        if (!category) {
            setMembers([]);
            return;
        }
        setBusy(true);
        try {
            setMembers((await fetchAll(category.id)).map((server) => server.uuid));
        } catch (failure) {
            setError(httpErrorToHuman(failure as Error));
        } finally {
            setBusy(false);
        }
    };

    // A category that disappears elsewhere must not stay selected: saving to a stale id would fail.
    useEffect(() => {
        if (selected !== NEW && !categories.some((category) => category.id === selected)) void select(null);
    }, [categories, selected]);

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            await work();
            await invalidateInstances(queryClient);
        } catch (failure) {
            setError(httpErrorToHuman(failure as Error));
        } finally {
            setBusy(false);
        }
    };

    const save = () =>
        run(async () => {
            if (selected === NEW) {
                const created = (await http.post<Category>(`${BASE}/categories`, { name: name.trim() })).data;
                if (members.length > 0)
                    await http.put(`${BASE}/categories/${created.id}/servers`, { servers: members });
                setSelected(NEW);
                setName('');
                setMembers([]);
            } else {
                const current = categories.find((category) => category.id === selected);
                if (current && current.name !== name.trim())
                    await http.put(`${BASE}/categories/${selected}`, { name: name.trim() });
                await http.put(`${BASE}/categories/${selected}/servers`, { servers: members });
                setSaved(true);
            }
        });

    const remove = () =>
        run(async () => {
            const id = selected;
            await http.delete(`${BASE}/categories/${id}`);
            onDeleted(id);
            setSelected(NEW);
            setName('');
            setMembers([]);
        });

    const moveCategory = (index: number, by: number) =>
        run(async () => {
            const ids = moveItem(
                categories.map((category) => category.id),
                index,
                index + by
            );
            await http.put(`${BASE}/categories/order`, { categories: ids });
        });

    return (
        <Dialog
            open
            onClose={onClose}
            title={'Your categories'}
            description={
                'Categories are only visible to you. Pick the instances each one contains and put them in your preferred order.'
            }
        >
            {error && (
                <p
                    role={'alert'}
                    className={'gb-badge gb-badge-danger'}
                    style={{ height: 'auto', padding: '8px 12px', marginBottom: 12 }}
                >
                    {error}
                </p>
            )}
            <div className={'gb-cat-editor'}>
                <div className={'gb-cat-list'}>
                    {categories.map((category, index) => (
                        <div key={category.id} className={'gb-cat-item' + (selected === category.id ? ' active' : '')}>
                            <button
                                type={'button'}
                                onClick={() => void select(category)}
                                aria-pressed={selected === category.id}
                                className={'gb-cat-name'}
                            >
                                {category.name}
                            </button>
                            <button
                                type={'button'}
                                aria-label={`Move ${category.name} earlier`}
                                title={'Move earlier'}
                                disabled={busy || index === 0}
                                onClick={() => void moveCategory(index, -1)}
                            >
                                <ArrowUp aria-hidden />
                            </button>
                            <button
                                type={'button'}
                                aria-label={`Move ${category.name} later`}
                                title={'Move later'}
                                disabled={busy || index === categories.length - 1}
                                onClick={() => void moveCategory(index, 1)}
                            >
                                <ArrowDown aria-hidden />
                            </button>
                        </div>
                    ))}
                    <button
                        type={'button'}
                        onClick={() => void select(null)}
                        aria-pressed={selected === NEW}
                        className={'gb-cat-new' + (selected === NEW ? ' active' : '')}
                    >
                        <Plus aria-hidden /> New category
                    </button>
                </div>
                <div style={{ minWidth: 0 }}>
                    <label className={'gb-label'} htmlFor={'category-name'}>
                        Category name
                    </label>
                    <input
                        id={'category-name'}
                        className={'gb-input'}
                        value={name}
                        maxLength={32}
                        onChange={(event) => setName(event.currentTarget.value)}
                        placeholder={'Hubs'}
                    />
                    <div className={'gb-eyebrow'} style={{ margin: '18px 0 8px' }}>
                        In this category ({members.length})
                    </div>
                    <ol
                        className={'gb-subcard'}
                        style={{ listStyle: 'none', margin: 0, padding: 6, maxHeight: 160, overflowY: 'auto' }}
                    >
                        {members.length === 0 && (
                            <li className={'gb-muted'} style={{ padding: 8, fontSize: 13 }}>
                                No instances yet. Tick some below.
                            </li>
                        )}
                        {members.map((uuid, index) => (
                            <li key={uuid} className={'gb-member'}>
                                <span>{nameOf(uuid)}</span>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${nameOf(uuid)} up`}
                                    disabled={index === 0}
                                    onClick={() => setMembers((current) => moveItem(current, index, index - 1))}
                                >
                                    <ArrowUp aria-hidden />
                                </button>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${nameOf(uuid)} down`}
                                    disabled={index === members.length - 1}
                                    onClick={() => setMembers((current) => moveItem(current, index, index + 1))}
                                >
                                    <ArrowDown aria-hidden />
                                </button>
                                <button
                                    type={'button'}
                                    aria-label={`Remove ${nameOf(uuid)} from this category`}
                                    onClick={() => setMembers((current) => current.filter((other) => other !== uuid))}
                                >
                                    <X aria-hidden />
                                </button>
                            </li>
                        ))}
                    </ol>
                    <div className={'gb-eyebrow'} style={{ margin: '18px 0 8px' }}>
                        All instances
                    </div>
                    <div className={'gb-subcard'} style={{ padding: 6, maxHeight: 180, overflowY: 'auto' }}>
                        {everything.isPending && <div className={'gb-skeleton'} style={{ height: 36, margin: 6 }} />}
                        {servers.map((server) => (
                            <label key={server.uuid} className={'gb-check-row'}>
                                <input
                                    type={'checkbox'}
                                    checked={members.includes(server.uuid)}
                                    onChange={(event) => {
                                        const checked = event.currentTarget.checked;
                                        setMembers((current) =>
                                            checked
                                                ? current.includes(server.uuid)
                                                    ? current
                                                    : [...current, server.uuid]
                                                : current.filter((other) => other !== server.uuid)
                                        );
                                    }}
                                />
                                <span>{server.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
                {selected !== NEW && (
                    <button
                        type={'button'}
                        className={'gb-btn gb-btn-danger'}
                        disabled={busy}
                        onClick={() => void remove()}
                    >
                        Delete category
                    </button>
                )}
                <span style={{ flex: 1 }} />
                {saved && (
                    <span role={'status'} className={'gb-secondary'} style={{ fontSize: 13 }}>
                        Saved
                    </span>
                )}
                <button type={'button'} className={'gb-btn'} onClick={onClose}>
                    Close
                </button>
                <button
                    type={'button'}
                    className={'gb-btn gb-btn-primary'}
                    disabled={busy || name.trim().length === 0}
                    onClick={() => void save()}
                >
                    {selected === NEW ? 'Create category' : 'Save category'}
                </button>
            </div>
        </Dialog>
    );
}
