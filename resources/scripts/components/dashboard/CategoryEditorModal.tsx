import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import Modal from '@/components/elements/Modal';
import { httpErrorToHuman } from '@/api/http';
import {
    saveCategoryButtons,
    createCategory,
    deleteCategory,
    LayoutCategory,
    ServerLayout,
    updateCategory,
} from '@/api/account/layout';

interface Props {
    visible: boolean;
    layout: ServerLayout | undefined;
    onClose: () => void;
    // Called with the fresh layout after anything was saved or deleted. `deleted` is the id of a removed category,
    // so the page can leave that category before anything is refetched for it.
    onChanged: (layout: ServerLayout | null, deleted?: number) => void;
}

const NEW = 0;

const move = (list: string[], index: number, by: number) => {
    const target = index + by;
    if (target < 0 || target >= list.length) return list;
    const copy = [...list];
    [copy[index], copy[target]] = [copy[target], copy[index]];

    return copy;
};

export default ({ visible, layout, onClose, onChanged }: Props) => {
    const [selected, setSelected] = useState<number>(NEW);
    const [name, setName] = useState('');
    const [members, setMembers] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const categories = layout?.categories || [];
    const servers = layout?.servers || [];
    const nameOf = (uuid: string) => servers.find((s) => s.uuid === uuid)?.name || uuid;

    const select = (category: LayoutCategory | null) => {
        setSelected(category?.id || NEW);
        setName(category?.name || '');
        // Only servers that still exist and are accessible can be members.
        setMembers((category?.servers || []).filter((uuid) => servers.some((s) => s.uuid === uuid)));
        setError(null);
        setSaved(false);
    };

    useEffect(() => {
        if (visible) select(null);
    }, [visible]);

    // If the category being edited disappears (deleted elsewhere), fall back to the empty form instead of saving to a stale id.
    useEffect(() => {
        if (selected !== NEW && layout && !layout.categories.some((c) => c.id === selected)) select(null);
    }, [layout]);

    const run = (action: Promise<ServerLayout | void>, after?: (fresh: ServerLayout | null) => void) => {
        setBusy(true);
        setError(null);
        setSaved(false);

        action
            .then((fresh) => {
                after?.(fresh || null);
            })
            .catch((e) => setError(httpErrorToHuman(e)))
            .then(() => setBusy(false));
    };

    const moveCategory = (index: number, by: number) => {
        const ids = categories.map((c) => c.id);
        ids.splice(index + by, 0, ids.splice(index, 1)[0]);
        run(saveCategoryButtons(ids), (fresh) => onChanged(fresh));
    };

    const save = () =>
        run(
            selected === NEW ? createCategory(name.trim(), members) : updateCategory(selected, name.trim(), members),
            (fresh) => {
                onChanged(fresh);
                if (selected === NEW) {
                    select(null);
                } else {
                    setSaved(true);
                }
            }
        );

    const remove = () => {
        const id = selected;
        run(deleteCategory(id), () => {
            select(null);
            onChanged(null, id);
        });
    };

    return (
        <Modal visible={visible} onDismissed={onClose} dismissable closeOnEscape showSpinnerOverlay={busy}>
            <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                Your categories
            </h3>
            <p className={'gb-card-sub'} style={{ marginBottom: 16 }}>
                Categories are only visible to you. Pick the instances each one contains and put them in your preferred
                order.
            </p>
            {error && (
                <p
                    role={'alert'}
                    className={'gb-badge gb-badge-danger'}
                    style={{
                        height: 'auto',
                        padding: '8px 12px',
                        textTransform: 'none',
                        letterSpacing: 0,
                        marginBottom: 12,
                        whiteSpace: 'normal',
                    }}
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
                                onClick={() => select(category)}
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
                                onClick={() => moveCategory(index, -1)}
                            >
                                <ArrowUp aria-hidden />
                            </button>
                            <button
                                type={'button'}
                                aria-label={`Move ${category.name} later`}
                                title={'Move later'}
                                disabled={busy || index === categories.length - 1}
                                onClick={() => moveCategory(index, 1)}
                            >
                                <ArrowDown aria-hidden />
                            </button>
                        </div>
                    ))}
                    <button
                        type={'button'}
                        onClick={() => select(null)}
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
                        onChange={(e) => setName(e.currentTarget.value)}
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
                                    onClick={() => setMembers((m) => move(m, index, -1))}
                                >
                                    <ArrowUp aria-hidden />
                                </button>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${nameOf(uuid)} down`}
                                    disabled={index === members.length - 1}
                                    onClick={() => setMembers((m) => move(m, index, 1))}
                                >
                                    <ArrowDown aria-hidden />
                                </button>
                                <button
                                    type={'button'}
                                    aria-label={`Remove ${nameOf(uuid)} from this category`}
                                    onClick={() => setMembers((m) => m.filter((u) => u !== uuid))}
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
                        {servers.map((server) => (
                            <label key={server.uuid} className={'gb-check-row'}>
                                <input
                                    type={'checkbox'}
                                    checked={members.includes(server.uuid)}
                                    onChange={(e) =>
                                        setMembers((m) =>
                                            e.currentTarget.checked
                                                ? [...m, server.uuid]
                                                : m.filter((u) => u !== server.uuid)
                                        )
                                    }
                                />
                                <span>{server.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
                {selected !== NEW && (
                    <button type={'button'} className={'gb-btn gb-btn-danger'} disabled={busy} onClick={remove}>
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
                    onClick={save}
                >
                    {selected === NEW ? 'Create category' : 'Save category'}
                </button>
            </div>
        </Modal>
    );
};
