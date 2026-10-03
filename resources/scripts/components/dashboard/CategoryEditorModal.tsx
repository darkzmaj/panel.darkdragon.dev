import React, { useEffect, useState } from 'react';
import tw from 'twin.macro';
import Modal from '@/components/elements/Modal';
import Input from '@/components/elements/Input';
import Label from '@/components/elements/Label';
import { Button } from '@/components/elements/button/index';
import { httpErrorToHuman } from '@/api/http';
import { createCategory, deleteCategory, LayoutCategory, ServerLayout, updateCategory } from '@/api/account/layout';

interface Props {
    visible: boolean;
    layout: ServerLayout | undefined;
    onClose: () => void;
    // Called with the fresh layout after anything was saved or deleted.
    onChanged: (layout: ServerLayout | null) => void;
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

    const categories = layout?.categories || [];
    const servers = layout?.servers || [];
    const nameOf = (uuid: string) => servers.find((s) => s.uuid === uuid)?.name || uuid;

    const select = (category: LayoutCategory | null) => {
        setSelected(category?.id || NEW);
        setName(category?.name || '');
        setMembers(category?.servers || []);
        setError(null);
    };

    useEffect(() => {
        if (visible) select(null);
    }, [visible]);

    const run = (action: Promise<ServerLayout | void>, after?: () => void) => {
        setBusy(true);
        setError(null);

        action
            .then((fresh) => {
                onChanged(fresh || null);
                after?.();
            })
            .catch((e) => setError(httpErrorToHuman(e)))
            .then(() => setBusy(false));
    };

    const save = () =>
        run(
            selected === NEW ? createCategory(name.trim(), members) : updateCategory(selected, name.trim(), members),
            () => {
                if (selected === NEW) select(null);
            }
        );

    return (
        <Modal visible={visible} onDismissed={onClose} dismissable closeOnEscape showSpinnerOverlay={busy}>
            <h2 css={tw`text-2xl text-neutral-100 mb-1`}>Your server categories</h2>
            <p css={tw`text-sm text-neutral-400 mb-4`}>
                Categories are only visible to you. Pick the servers each one contains and put them in your preferred
                order.
            </p>
            {error && <p css={tw`text-sm text-red-400 mb-3`}>{error}</p>}
            <div css={tw`flex flex-col sm:flex-row`}>
                <div css={tw`sm:w-44 flex-none sm:mr-4 mb-4 sm:mb-0`}>
                    <ul css={tw`flex sm:block overflow-x-auto`}>
                        {categories.map((category) => (
                            <li key={category.id} css={tw`flex-none`}>
                                <button
                                    type={'button'}
                                    onClick={() => select(category)}
                                    aria-pressed={selected === category.id}
                                    css={[
                                        tw`block w-full text-left px-3 py-2 text-sm rounded truncate hover:bg-neutral-700`,
                                        selected === category.id
                                            ? tw`bg-neutral-600 text-neutral-50`
                                            : tw`text-neutral-300`,
                                    ]}
                                >
                                    {category.name}
                                </button>
                            </li>
                        ))}
                        <li css={tw`flex-none`}>
                            <button
                                type={'button'}
                                onClick={() => select(null)}
                                aria-pressed={selected === NEW}
                                css={[
                                    tw`block w-full text-left px-3 py-2 text-sm rounded hover:bg-neutral-700`,
                                    selected === NEW ? tw`bg-neutral-600 text-neutral-50` : tw`text-cyan-300`,
                                ]}
                            >
                                + New category
                            </button>
                        </li>
                    </ul>
                </div>
                <div css={tw`flex-1 min-w-0`}>
                    <Label htmlFor={'category-name'}>Category name</Label>
                    <Input
                        id={'category-name'}
                        value={name}
                        maxLength={32}
                        onChange={(e) => setName(e.currentTarget.value)}
                        placeholder={'Hubs'}
                    />
                    <h3 css={tw`text-sm uppercase text-neutral-300 mt-4 mb-2`}>Servers in this category</h3>
                    <ol css={tw`bg-neutral-800 rounded p-2 mb-3 max-h-40 overflow-y-auto`}>
                        {members.length === 0 && (
                            <li css={tw`text-sm text-neutral-400 p-1`}>No servers yet. Tick some below.</li>
                        )}
                        {members.map((uuid, index) => (
                            <li key={uuid} css={tw`flex items-center text-sm py-0.5`}>
                                <span css={tw`flex-1 truncate`}>{nameOf(uuid)}</span>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${nameOf(uuid)} up`}
                                    disabled={index === 0}
                                    onClick={() => setMembers((m) => move(m, index, -1))}
                                    css={tw`px-2 text-neutral-400 hover:text-neutral-100 disabled:opacity-30`}
                                >
                                    &uarr;
                                </button>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${nameOf(uuid)} down`}
                                    disabled={index === members.length - 1}
                                    onClick={() => setMembers((m) => move(m, index, 1))}
                                    css={tw`px-2 text-neutral-400 hover:text-neutral-100 disabled:opacity-30`}
                                >
                                    &darr;
                                </button>
                            </li>
                        ))}
                    </ol>
                    <div css={tw`bg-neutral-800 rounded p-2 max-h-40 overflow-y-auto`}>
                        {servers.map((server) => (
                            <label key={server.uuid} css={tw`flex items-center py-0.5 cursor-pointer text-sm`}>
                                <Input
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
                                <span css={tw`ml-3`}>{server.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
            <div css={tw`flex items-center mt-6`}>
                {selected !== NEW && (
                    <Button.Danger
                        type={'button'}
                        disabled={busy}
                        onClick={() =>
                            run(
                                deleteCategory(selected).then(() => undefined),
                                () => {
                                    select(null);
                                    onChanged(null);
                                }
                            )
                        }
                    >
                        Delete category
                    </Button.Danger>
                )}
                <div css={tw`flex-1`} />
                <Button.Text type={'button'} onClick={onClose} css={tw`mr-2`}>
                    Close
                </Button.Text>
                <Button type={'button'} disabled={busy || name.trim().length === 0} onClick={save}>
                    {selected === NEW ? 'Create category' : 'Save category'}
                </Button>
            </div>
        </Modal>
    );
};
