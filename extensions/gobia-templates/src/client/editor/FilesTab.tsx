import { Button, Dialog, Spinner, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
    deleteFile,
    downloadUrl,
    fetchFiles,
    keys,
    makeFolder,
    moveFile,
    publishTemplate,
    readFile,
    uploadFile,
    writeFile,
    type FileEntry,
} from '../api';
import { formatBytes } from './format';

const control = 'gt:rounded-md gt:border gt:border-input gt:bg-background gt:px-3 gt:py-2 gt:text-sm';

function Editor({ id, entry, onClose }: { id: number; entry: FileEntry; onClose: () => void }) {
    const queryClient = useQueryClient();
    const file = useQuery({
        queryKey: ['gobia-templates', 'file', id, entry.path],
        queryFn: () => readFile(id, entry.path),
    });
    const [content, setContent] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: () => writeFile(id, entry.path, content ?? file.data?.content ?? ''),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: keys.files(id) });
            await queryClient.invalidateQueries({ queryKey: ['gobia-templates', 'file', id, entry.path] });
            toast.success('Saved to the working files. Publish to make a revision.');
            onClose();
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });
    const text = content ?? file.data?.content ?? '';

    return (
        <Dialog
            open
            onClose={save.isPending ? () => {} : onClose}
            title={entry.path}
            description={formatBytes(entry.size)}
        >
            {file.isPending ? (
                <Spinner centered />
            ) : file.isError ? (
                <p className={'gt:text-sm gt:text-destructive'}>{httpErrorToHuman(file.error)}</p>
            ) : file.data.binary ? (
                <p className={'gt:text-sm gt:text-muted-foreground'}>
                    This is a binary file. Download or replace it instead.
                </p>
            ) : (
                <textarea
                    aria-label={`Contents of ${entry.path}`}
                    value={text}
                    spellCheck={false}
                    onChange={(event) => setContent(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                            event.preventDefault();
                            save.mutate();
                        }
                    }}
                    className={`${control} gt:h-[50vh] gt:w-full gt:font-mono gt:text-xs`}
                />
            )}
            <Dialog.Footer>
                <Button.Text type={'button'} onClick={onClose} disabled={save.isPending}>
                    Close
                </Button.Text>
                {file.data && !file.data.binary && (
                    <Button
                        type={'button'}
                        color={'primary'}
                        isLoading={save.isPending}
                        disabled={content === null}
                        onClick={() => save.mutate()}
                    >
                        Save
                    </Button>
                )}
            </Dialog.Footer>
        </Dialog>
    );
}

export default function FilesTab({ id }: { id: number }) {
    const queryClient = useQueryClient();
    const files = useQuery({ queryKey: keys.files(id), queryFn: () => fetchFiles(id) });
    const [editing, setEditing] = useState<FileEntry | null>(null);
    const [progress, setProgress] = useState<Record<string, number>>({});
    const [prefix, setPrefix] = useState('');
    const input = useRef<HTMLInputElement>(null);
    const refresh = () => queryClient.invalidateQueries({ queryKey: keys.files(id) });
    const fail = (error: Error) => toast.error(httpErrorToHuman(error));

    const folder = useMutation({
        mutationFn: (name: string) => makeFolder(id, name),
        onSuccess: refresh,
        onError: fail,
    });
    const remove = useMutation({
        mutationFn: (path: string) => deleteFile(id, path),
        onSuccess: refresh,
        onError: fail,
    });
    const move = useMutation({
        mutationFn: ({ from, to }: { from: string; to: string }) => moveFile(id, from, to),
        onSuccess: refresh,
        onError: fail,
    });
    const publish = useMutation({
        mutationFn: () => publishTemplate(id),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['gobia-templates'] });
            toast.success(
                result.created_revision
                    ? `Published as revision ${result.revision}.`
                    : 'Nothing changed since the last revision.'
            );
        },
        onError: fail,
    });

    const upload = async (list: FileList | File[]) => {
        for (const file of Array.from(list)) {
            const path = `${prefix}${file.name}`;
            setProgress((current) => ({ ...current, [path]: 0 }));
            try {
                await uploadFile(id, path, file, (fraction) =>
                    setProgress((current) => ({ ...current, [path]: fraction }))
                );
            } catch (error) {
                toast.error(`${path}: ${httpErrorToHuman(error as Error)}`);
            }
            setProgress(({ [path]: _done, ...rest }) => rest);
        }
        await refresh();
    };

    if (files.isPending) return <Spinner centered />;
    if (files.isError) return <p className={'gt:text-destructive'}>The files could not be loaded.</p>;
    const { data, status, limits } = files.data;
    const total = data.reduce((sum, entry) => sum + (entry.type === 'file' ? entry.size : 0), 0);

    return (
        <div
            className={'gt:flex gt:flex-col gt:gap-4'}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                if (event.dataTransfer.files.length) void upload(event.dataTransfer.files);
            }}
        >
            <div
                className={
                    'gt:flex gt:flex-wrap gt:items-center gt:justify-between gt:gap-3 gt:rounded-lg gt:border gt:border-border gt:bg-card gt:p-3 gt:text-sm'
                }
            >
                <span>
                    {data.filter((entry) => entry.type === 'file').length} files · {formatBytes(total)} of{' '}
                    {formatBytes(limits.max_total_bytes)} · revision {status.revision}
                    {status.dirty
                        ? ` · ${status.added} added, ${status.modified} changed, ${status.deleted} removed since publishing`
                        : ' · published'}
                </span>
                <Button
                    type={'button'}
                    color={'primary'}
                    isLoading={publish.isPending}
                    disabled={!status.dirty}
                    onClick={() => publish.mutate()}
                >
                    Publish revision
                </Button>
            </div>

            <div className={'gt:flex gt:flex-wrap gt:items-center gt:gap-2'}>
                <input
                    aria-label={'Target folder for new items'}
                    value={prefix}
                    placeholder={'Target folder, for example plugins/'}
                    onChange={(event) => setPrefix(event.currentTarget.value)}
                    className={`${control} gt:w-64`}
                />
                <Button type={'button'} onClick={() => input.current?.click()}>
                    Upload files
                </Button>
                <input
                    ref={input}
                    type={'file'}
                    multiple
                    className={'gt:sr-only'}
                    aria-label={'Choose files to upload'}
                    onChange={(event) => {
                        if (event.currentTarget.files) void upload(event.currentTarget.files);
                        event.currentTarget.value = '';
                    }}
                />
                <Button
                    type={'button'}
                    onClick={() => {
                        const name = window.prompt('Folder name');
                        if (name) folder.mutate(`${prefix}${name}`);
                    }}
                >
                    New folder
                </Button>
                <Button
                    type={'button'}
                    onClick={() => {
                        const name = window.prompt('New file name');
                        if (name) writeFile(id, `${prefix}${name}`, '').then(refresh, fail);
                    }}
                >
                    New file
                </Button>
            </div>

            {Object.keys(progress).length > 0 && (
                <ul aria-label={'Uploads'} className={'gt:flex gt:flex-col gt:gap-1 gt:text-xs'}>
                    {Object.entries(progress).map(([path, fraction]) => (
                        <li key={path} className={'gt:flex gt:items-center gt:gap-2'}>
                            <span className={'gt:w-64 gt:truncate'}>{path}</span>
                            <progress
                                max={1}
                                value={fraction}
                                className={'gt:flex-1'}
                                aria-label={`Uploading ${path}`}
                            />
                        </li>
                    ))}
                </ul>
            )}

            <div className={'gt:overflow-x-auto gt:rounded-lg gt:border gt:border-border gt:bg-card'}>
                <table className={'gt:w-full gt:text-left gt:text-sm'}>
                    <caption className={'gt:sr-only'}>Working files. Drop files anywhere here to upload.</caption>
                    <tbody>
                        {data.length === 0 && (
                            <tr>
                                <td className={'gt:p-6 gt:text-center gt:text-muted-foreground'}>
                                    No files yet. Upload files or drop them here.
                                </td>
                            </tr>
                        )}
                        {data.map((entry) => (
                            <tr key={entry.path} className={'gt:border-t gt:border-border first:gt:border-0'}>
                                <th
                                    scope={'row'}
                                    className={'gt:px-3 gt:py-2 gt:font-normal'}
                                    style={{ paddingLeft: `${0.75 + entry.path.split('/').length * 0.75 - 0.75}rem` }}
                                >
                                    <span aria-hidden>{entry.type === 'directory' ? '▸ ' : ''}</span>
                                    {entry.path.split('/').pop()}
                                </th>
                                <td
                                    className={'gt:px-3 gt:py-2 gt:text-right gt:tabular-nums gt:text-muted-foreground'}
                                >
                                    {entry.type === 'file' ? formatBytes(entry.size) : ''}
                                </td>
                                <td className={'gt:px-3 gt:py-2'}>
                                    <div className={'gt:flex gt:justify-end gt:gap-1'}>
                                        {entry.type === 'file' && (
                                            <>
                                                {entry.size <= limits.max_edit_bytes && (
                                                    <Button.Text type={'button'} onClick={() => setEditing(entry)}>
                                                        Edit
                                                    </Button.Text>
                                                )}
                                                <a
                                                    href={downloadUrl(id, entry.path)}
                                                    className={'gt:px-2 gt:py-1 gt:text-sm'}
                                                    download
                                                >
                                                    Download
                                                </a>
                                            </>
                                        )}
                                        <Button.Text
                                            type={'button'}
                                            onClick={() => {
                                                const to = window.prompt('Move or rename to', entry.path);
                                                if (to && to !== entry.path) move.mutate({ from: entry.path, to });
                                            }}
                                        >
                                            Rename
                                        </Button.Text>
                                        <Button.Danger
                                            type={'button'}
                                            onClick={() => {
                                                if (window.confirm(`Delete ${entry.path}?`)) remove.mutate(entry.path);
                                            }}
                                        >
                                            Delete
                                        </Button.Danger>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {editing && <Editor id={id} entry={editing} onClose={() => setEditing(null)} />}
        </div>
    );
}
