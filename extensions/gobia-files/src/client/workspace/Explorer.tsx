import {
    Button,
    ContextDropdownMenu,
    Dialog,
    DropdownMenu,
    DropdownMenuItem,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
    Spinner,
    toast,
    type ComponentPartProps,
    type FileManagerEntry,
} from '@pterodactyl/sdk';
import {
    ArrowUp,
    Copy,
    CopyPlus,
    Download,
    File as FileIcon,
    Folder,
    MoreVertical,
    Pencil,
    Trash2,
} from 'lucide-react';
import { useState, type DragEvent, type FormEvent } from 'react';
import { useWorkspace } from './context';
import { dirname, join } from './paths';
import { pickedFromDrop } from './uploads';

const MOVE_TYPE = 'application/x-gobia-file';
const input =
    'gf:w-full gf:rounded-md gf:border gf:border-input gf:bg-background gf:px-3 gf:py-2 gf:text-sm gf:text-foreground';

type Pending = { kind: 'rename'; entry: FileManagerEntry } | { kind: 'delete'; names: readonly string[] } | null;

function RenameDialog({
    entry,
    onSubmit,
    onClose,
}: {
    entry: FileManagerEntry;
    onSubmit: (to: string) => void;
    onClose: () => void;
}) {
    const [name, setName] = useState(entry.name);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (name.trim() !== '' && name !== entry.name) onSubmit(name.trim());
        onClose();
    };
    return (
        <Dialog
            open
            onClose={onClose}
            title={'Rename or move'}
            description={'Use a path such as plugins/old.jar to move.'}
        >
            <form onSubmit={submit} className={'gf:flex gf:flex-col gf:gap-4'}>
                <label className={'gf:flex gf:flex-col gf:gap-1 gf:text-sm'}>
                    New name
                    <input
                        autoFocus
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                        className={input}
                    />
                </label>
                <Dialog.Footer>
                    <Button.Text type={'button'} onClick={onClose}>
                        Cancel
                    </Button.Text>
                    <Button type={'submit'} color={'primary'}>
                        Rename
                    </Button>
                </Dialog.Footer>
            </form>
        </Dialog>
    );
}

export default function ExplorerList({ model }: ComponentPartProps<'server.files.manager'>) {
    const workspace = useWorkspace();
    const { actions, permissions } = model;
    const [pending, setPending] = useState<Pending>(null);
    const [over, setOver] = useState<string | null>(null);

    const fail = (error: Error) => {
        // Core shows its own toast for a rejected request; this only covers the browser-side failures.
        if (error.message !== '') console.error(error);
    };

    const copyPath = async (entry: FileManagerEntry) => {
        try {
            await navigator.clipboard.writeText(entry.path);
            toast.success('Path copied.');
        } catch {
            toast.error('The path could not be copied.');
        }
    };

    const drop = async (event: DragEvent, folder?: FileManagerEntry) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(null);
        const moved = event.dataTransfer.getData(MOVE_TYPE);
        if (moved && folder && permissions.update && moved !== folder.name) {
            workspace.forget([join(model.directory, moved)]);
            await actions.rename([{ from: moved, to: `${folder.name}/${moved}` }]).catch(fail);
            return;
        }
        if (!permissions.update || event.dataTransfer.types.includes(MOVE_TYPE)) return;
        workspace.upload(await pickedFromDrop(event.dataTransfer), folder?.name);
    };

    const remove = async (names: readonly string[]) => {
        workspace.forget(names.map((name) => join(model.directory, name)));
        await actions.remove(names).catch(fail);
    };

    return (
        <div
            className={'gf:flex gf:flex-col gf:gap-2'}
            onDragOver={(event) => {
                if (permissions.update) event.preventDefault();
            }}
            onDrop={(event) => void drop(event)}
        >
            {model.truncated && (
                <p
                    className={
                        'gf:rounded-md gf:bg-warning gf:p-2 gf:text-center gf:text-xs gf:text-warning-foreground'
                    }
                >
                    This folder is large; only the first 250 entries are listed.
                </p>
            )}

            {model.loading ? (
                <Spinner size={'large'} centered />
            ) : (
                <ul aria-label={'Files'} className={'gf:flex gf:flex-col'}>
                    {model.directory !== '/' && (
                        <li>
                            <button
                                type={'button'}
                                onClick={() => void actions.navigate(dirname(model.directory)).catch(fail)}
                                className={
                                    'gf:flex gf:w-full gf:items-center gf:gap-2 gf:rounded-md gf:px-2 gf:py-1.5 gf:text-left gf:text-sm gf:text-muted-foreground gf:hover:bg-secondary'
                                }
                            >
                                <ArrowUp size={16} aria-hidden /> Parent folder
                            </button>
                        </li>
                    )}
                    {model.entries.length === 0 && (
                        <li>
                            <Empty className={'gf:border'}>
                                <EmptyHeader>
                                    <EmptyTitle>This folder is empty</EmptyTitle>
                                    <EmptyDescription>Drop files or folders here to upload them.</EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        </li>
                    )}
                    {model.entries.map((entry) => {
                        const directory = entry.kind === 'directory';
                        const selected = model.selection.includes(entry.name);
                        const open = workspace.openPaths.has(entry.path);
                        const activate = () => {
                            if (directory) void actions.open(entry.name).catch(fail);
                            else if (entry.openable) workspace.openFile(entry);
                            else void actions.download(entry.name).catch(fail);
                        };
                        const items = (
                            <>
                                <DropdownMenuItem icon={directory ? Folder : FileIcon} onClick={activate}>
                                    {directory ? 'Open folder' : entry.openable ? 'Open in editor' : 'Download'}
                                </DropdownMenuItem>
                                {permissions.update && (
                                    <DropdownMenuItem
                                        icon={Pencil}
                                        onClick={() => setPending({ kind: 'rename', entry })}
                                    >
                                        Rename or move
                                    </DropdownMenuItem>
                                )}
                                {permissions.create && !directory && (
                                    <DropdownMenuItem
                                        icon={CopyPlus}
                                        onClick={() => void actions.copy(entry.name).catch(fail)}
                                    >
                                        Duplicate
                                    </DropdownMenuItem>
                                )}
                                {!directory && (
                                    <DropdownMenuItem
                                        icon={Download}
                                        onClick={() => void actions.download(entry.name).catch(fail)}
                                    >
                                        Download
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem icon={Copy} onClick={() => void copyPath(entry)}>
                                    Copy path
                                </DropdownMenuItem>
                                {permissions.delete && (
                                    <DropdownMenuItem
                                        icon={Trash2}
                                        onClick={() => setPending({ kind: 'delete', names: [entry.name] })}
                                    >
                                        Delete
                                    </DropdownMenuItem>
                                )}
                            </>
                        );
                        return (
                            <li key={entry.name}>
                                <ContextDropdownMenu items={items}>
                                    <div
                                        draggable={permissions.update}
                                        onDragStart={(event) => event.dataTransfer.setData(MOVE_TYPE, entry.name)}
                                        onDragOver={(event) => {
                                            if (directory && permissions.update) {
                                                event.preventDefault();
                                                setOver(entry.name);
                                            }
                                        }}
                                        onDragLeave={() =>
                                            setOver((current) => (current === entry.name ? null : current))
                                        }
                                        onDrop={(event) => void drop(event, directory ? entry : undefined)}
                                        className={
                                            'gf:flex gf:items-center gf:gap-1 gf:rounded-md gf:px-1 gf:hover:bg-secondary ' +
                                            (over === entry.name ? 'gf:bg-primary/15 ' : '') +
                                            (open ? 'gf:bg-secondary/60' : '')
                                        }
                                    >
                                        <input
                                            type={'checkbox'}
                                            checked={selected}
                                            aria-label={`Select ${entry.name}`}
                                            onChange={() =>
                                                actions.select(
                                                    selected
                                                        ? model.selection.filter((name) => name !== entry.name)
                                                        : [...model.selection, entry.name]
                                                )
                                            }
                                            className={'gf:size-4 gf:shrink-0'}
                                        />
                                        <button
                                            type={'button'}
                                            onClick={activate}
                                            className={
                                                'gf:flex gf:min-w-0 gf:flex-1 gf:items-center gf:gap-2 gf:py-1.5 gf:text-left gf:text-sm gf:focus-visible:outline-2 gf:focus-visible:outline-ring'
                                            }
                                        >
                                            {directory ? (
                                                <Folder
                                                    size={16}
                                                    aria-hidden
                                                    className={'gf:shrink-0 gf:text-primary'}
                                                />
                                            ) : (
                                                <FileIcon
                                                    size={16}
                                                    aria-hidden
                                                    className={'gf:shrink-0 gf:text-muted-foreground'}
                                                />
                                            )}
                                            <span className={'gf:truncate'}>{entry.name}</span>
                                        </button>
                                        <DropdownMenu
                                            triggerContent={
                                                <MoreVertical size={16} aria-label={`Actions for ${entry.name}`} />
                                            }
                                            triggerClassName={
                                                'gf:grid gf:size-8 gf:shrink-0 gf:place-items-center gf:rounded-md gf:text-muted-foreground gf:hover:text-foreground'
                                            }
                                        >
                                            {items}
                                        </DropdownMenu>
                                    </div>
                                </ContextDropdownMenu>
                            </li>
                        );
                    })}
                </ul>
            )}

            {pending?.kind === 'rename' && (
                <RenameDialog
                    entry={pending.entry}
                    onClose={() => setPending(null)}
                    onSubmit={(to) => {
                        workspace.forget([pending.entry.path]);
                        void actions.rename([{ from: pending.entry.name, to }]).catch(fail);
                    }}
                />
            )}
            {pending?.kind === 'delete' && (
                <Dialog
                    open
                    onClose={() => setPending(null)}
                    title={`Delete ${pending.names.length === 1 ? pending.names[0] : `${pending.names.length} items`}?`}
                    description={'This cannot be undone.'}
                >
                    <Dialog.Footer>
                        <Button.Text type={'button'} onClick={() => setPending(null)}>
                            Cancel
                        </Button.Text>
                        <Button.Danger
                            type={'button'}
                            onClick={() => {
                                void remove(pending.names);
                                setPending(null);
                            }}
                        >
                            Delete
                        </Button.Danger>
                    </Dialog.Footer>
                </Dialog>
            )}
        </div>
    );
}
