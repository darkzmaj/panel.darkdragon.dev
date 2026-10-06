import { Button, Dialog, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { move } from './order';
import { useCategoryActions } from './queries';
import type { Category, Instance } from './types';

const inputClass =
    'gb:rounded-md gb:border gb:border-input gb:bg-background gb:px-3 gb:py-2 gb:text-sm gb:text-foreground gb:placeholder:text-muted-foreground';

function NewCategory({ onCreated }: { onCreated?: (category: Category) => void }) {
    const { create } = useCategoryActions();
    const [name, setName] = useState('');
    const submit = (event: FormEvent) => {
        event.preventDefault();
        create.mutate(name, {
            onSuccess: (category) => {
                setName('');
                onCreated?.(category);
            },
            onError: (error: Error) => toast.error(httpErrorToHuman(error)),
        });
    };

    return (
        <form onSubmit={submit} className={'gb:flex gb:gap-2'}>
            <input
                aria-label={'New category name'}
                value={name}
                maxLength={32}
                placeholder={'New category'}
                onChange={(event) => setName(event.currentTarget.value)}
                className={`${inputClass} gb:flex-1`}
            />
            <Button type={'submit'} color={'primary'} isLoading={create.isPending} disabled={!name.trim()}>
                Add
            </Button>
        </form>
    );
}

/** Create, rename, reorder and delete the user's personal categories. */
export function ManageCategoriesDialog({
    categories,
    onClose,
}: {
    categories: readonly Category[];
    onClose: () => void;
}) {
    const actions = useCategoryActions();
    const [drafts, setDrafts] = useState<Record<number, string>>({});
    const fail = (error: Error) => toast.error(httpErrorToHuman(error));
    const ids = categories.map((category) => category.id);

    return (
        <Dialog
            open
            onClose={onClose}
            title={'Categories'}
            description={'Your own groups of instances. Deleting a category never deletes an instance.'}
        >
            <div className={'gb:flex gb:flex-col gb:gap-4'}>
                <ul className={'gb:flex gb:flex-col gb:gap-2'}>
                    {categories.map((category, index) => {
                        const draft = drafts[category.id] ?? category.name;
                        return (
                            <li key={category.id} className={'gb:flex gb:items-center gb:gap-2'}>
                                <input
                                    aria-label={`Name of ${category.name}`}
                                    value={draft}
                                    maxLength={32}
                                    onChange={(event) =>
                                        setDrafts({ ...drafts, [category.id]: event.currentTarget.value })
                                    }
                                    onBlur={() => {
                                        const next = draft.trim();
                                        if (next && next !== category.name)
                                            actions.rename.mutate({ id: category.id, name: next }, { onError: fail });
                                        setDrafts(({ [category.id]: _discarded, ...rest }) => rest);
                                    }}
                                    onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                                    className={`${inputClass} gb:min-w-0 gb:flex-1`}
                                />
                                <span className={'gb:w-8 gb:text-right gb:text-xs gb:text-muted-foreground'}>
                                    {category.count}
                                </span>
                                <Button.Text
                                    type={'button'}
                                    aria-label={`Move ${category.name} up`}
                                    disabled={index === 0}
                                    onClick={() =>
                                        actions.reorder.mutate(move(ids, index, index - 1), { onError: fail })
                                    }
                                >
                                    <ArrowUp size={16} />
                                </Button.Text>
                                <Button.Text
                                    type={'button'}
                                    aria-label={`Move ${category.name} down`}
                                    disabled={index === categories.length - 1}
                                    onClick={() =>
                                        actions.reorder.mutate(move(ids, index, index + 1), { onError: fail })
                                    }
                                >
                                    <ArrowDown size={16} />
                                </Button.Text>
                                <Button.Danger
                                    type={'button'}
                                    aria-label={`Delete ${category.name}`}
                                    onClick={() => actions.remove.mutate(category.id, { onError: fail })}
                                >
                                    <Trash2 size={16} />
                                </Button.Danger>
                            </li>
                        );
                    })}
                    {categories.length === 0 && (
                        <li className={'gb:text-sm gb:text-muted-foreground'}>No categories yet.</li>
                    )}
                </ul>
                <NewCategory />
            </div>
            <Dialog.Footer>
                <Button type={'button'} color={'primary'} onClick={onClose}>
                    Done
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
}

/** Tick the categories one instance belongs to. Each tick is saved at once; the dialog only closes. */
export function AddToCategoryDialog({
    instance,
    categories,
    onClose,
}: {
    instance: Instance;
    categories: readonly Category[];
    onClose: () => void;
}) {
    const { membership } = useCategoryActions();
    const [checked, setChecked] = useState<ReadonlySet<number>>(new Set(instance.categories));
    const toggle = (category: Category, member: boolean) => {
        setChecked((current) => {
            const next = new Set(current);
            if (member) next.add(category.id);
            else next.delete(category.id);
            return next;
        });
        membership.mutate(
            { id: category.id, uuid: instance.uuid, member },
            {
                onError: (error: Error) => {
                    toast.error(httpErrorToHuman(error));
                    setChecked((current) => {
                        const next = new Set(current);
                        if (member) next.delete(category.id);
                        else next.add(category.id);
                        return next;
                    });
                },
            }
        );
    };

    return (
        <Dialog open onClose={onClose} title={'Add to category'} description={`Choose where ${instance.name} appears.`}>
            <div className={'gb:flex gb:flex-col gb:gap-4'}>
                <ul className={'gb:flex gb:flex-col gb:gap-1'}>
                    {categories.map((category) => (
                        <li key={category.id}>
                            <label
                                className={
                                    'gb:flex gb:cursor-pointer gb:items-center gb:gap-3 gb:rounded-md gb:px-2 gb:py-2 gb:text-sm gb:hover:bg-secondary'
                                }
                            >
                                <input
                                    type={'checkbox'}
                                    checked={checked.has(category.id)}
                                    onChange={(event) => toggle(category, event.currentTarget.checked)}
                                    className={'gb:size-4 gb:accent-primary'}
                                />
                                {category.name}
                            </label>
                        </li>
                    ))}
                    {categories.length === 0 && (
                        <li className={'gb:text-sm gb:text-muted-foreground'}>Create your first category below.</li>
                    )}
                </ul>
                <NewCategory onCreated={(category) => toggle(category, true)} />
            </div>
            <Dialog.Footer>
                <Button type={'button'} color={'primary'} onClick={onClose}>
                    Done
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
}
