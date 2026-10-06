import { Button, Dialog, type ComponentPartProps } from '@pterodactyl/sdk';
import { FilePlus, FolderPlus, FolderUp, Upload } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useWorkspace } from './context';
import { pickedFromInput } from './uploads';

const control =
    'gf:inline-flex gf:items-center gf:gap-1.5 gf:rounded-md gf:border gf:border-border gf:bg-card gf:px-2.5 gf:py-1.5 gf:text-xs gf:font-medium gf:text-foreground gf:hover:bg-secondary gf:focus-visible:outline-2 gf:focus-visible:outline-ring';

function Tool({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button type={'button'} onClick={onClick} className={control}>
            {children}
        </button>
    );
}

function Breadcrumbs({ directory, onNavigate }: { directory: string; onNavigate: (path: string) => void }) {
    const parts = directory.split('/').filter((part) => part !== '');
    return (
        <nav aria-label={'Current folder'} className={'gf:flex gf:min-w-0 gf:flex-wrap gf:items-center gf:text-sm'}>
            <button
                type={'button'}
                onClick={() => onNavigate('/')}
                className={'gf:rounded gf:px-1 gf:hover:bg-secondary'}
            >
                home
            </button>
            {parts.map((part, index) => {
                const path = `/${parts.slice(0, index + 1).join('/')}`;
                const last = index === parts.length - 1;
                return (
                    <span key={path} className={'gf:flex gf:items-center'}>
                        <span aria-hidden className={'gf:text-muted-foreground'}>
                            /
                        </span>
                        <button
                            type={'button'}
                            aria-current={last ? 'page' : undefined}
                            onClick={() => onNavigate(path)}
                            className={'gf:rounded gf:px-1 gf:hover:bg-secondary ' + (last ? 'gf:font-medium' : '')}
                        >
                            {part}
                        </button>
                    </span>
                );
            })}
        </nav>
    );
}

export default function ExplorerToolbar({ model }: ComponentPartProps<'server.files.manager'>) {
    const workspace = useWorkspace();
    const { permissions, actions } = model;
    const files = useRef<HTMLInputElement>(null);
    const folder = useRef<HTMLInputElement>(null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');

    const createFolder = (event: FormEvent) => {
        event.preventDefault();
        if (name.trim() !== '') void actions.createDirectory(name.trim()).catch(() => undefined);
        setNaming(false);
        setName('');
    };

    return (
        <div className={'gf:mb-2 gf:flex gf:flex-col gf:gap-2'}>
            <Breadcrumbs
                directory={model.directory}
                onNavigate={(path) => void actions.navigate(path).catch(() => undefined)}
            />
            <div className={'gf:flex gf:flex-wrap gf:items-center gf:gap-1.5'}>
                {permissions.create && (
                    <Tool onClick={workspace.newFile}>
                        <FilePlus size={14} aria-hidden /> New file
                    </Tool>
                )}
                {permissions.create && (
                    <Tool onClick={() => setNaming(true)}>
                        <FolderPlus size={14} aria-hidden /> New folder
                    </Tool>
                )}
                {permissions.update && (
                    <>
                        <Tool onClick={() => files.current?.click()}>
                            <Upload size={14} aria-hidden /> Upload
                        </Tool>
                        <Tool onClick={() => folder.current?.click()}>
                            <FolderUp size={14} aria-hidden /> Folder
                        </Tool>
                        <input
                            ref={files}
                            type={'file'}
                            multiple
                            tabIndex={-1}
                            className={'gf:sr-only'}
                            aria-label={'Choose files to upload'}
                            onChange={(event) => {
                                if (event.currentTarget.files)
                                    workspace.upload(pickedFromInput(event.currentTarget.files));
                                event.currentTarget.value = '';
                            }}
                        />
                        <input
                            ref={folder}
                            type={'file'}
                            multiple
                            tabIndex={-1}
                            className={'gf:sr-only'}
                            aria-label={'Choose a folder to upload'}
                            {...{ webkitdirectory: '' }}
                            onChange={(event) => {
                                if (event.currentTarget.files)
                                    workspace.upload(pickedFromInput(event.currentTarget.files));
                                event.currentTarget.value = '';
                            }}
                        />
                    </>
                )}
            </div>
            {naming && (
                <Dialog
                    open
                    onClose={() => setNaming(false)}
                    title={'New folder'}
                    description={`Created in ${model.directory}`}
                >
                    <form onSubmit={createFolder} className={'gf:flex gf:flex-col gf:gap-4'}>
                        <label className={'gf:flex gf:flex-col gf:gap-1 gf:text-sm'}>
                            Folder name
                            <input
                                autoFocus
                                value={name}
                                onChange={(event) => setName(event.currentTarget.value)}
                                className={
                                    'gf:w-full gf:rounded-md gf:border gf:border-input gf:bg-background gf:px-3 gf:py-2 gf:text-sm gf:text-foreground'
                                }
                            />
                        </label>
                        <Dialog.Footer>
                            <Button.Text type={'button'} onClick={() => setNaming(false)}>
                                Cancel
                            </Button.Text>
                            <Button type={'submit'} color={'primary'} disabled={name.trim() === ''}>
                                Create
                            </Button>
                        </Dialog.Footer>
                    </form>
                </Dialog>
            )}
        </div>
    );
}
