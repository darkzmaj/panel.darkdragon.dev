import type { FileManagerEntry } from '@pterodactyl/sdk';
import { createContext, useContext } from 'react';
import type { PickedFile } from './uploads';

export interface WorkspaceContextValue {
    /** Open a file in a tab (or focus its tab). */
    openFile: (entry: FileManagerEntry) => void;
    /** Ask for a new file name in the current directory, create it empty and open it. */
    newFile: () => void;
    /** Queue files for upload into the current directory, or into a folder of it. */
    upload: (picked: readonly PickedFile[], folder?: string) => void;
    /** Paths of the files that have a tab, so the explorer can mark them. */
    openPaths: ReadonlySet<string>;
    /** A tab changed on disk: the explorer entry of a file that is about to be renamed or deleted. */
    forget: (paths: readonly string[]) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
    const value = useContext(WorkspaceContext);
    if (!value) throw new Error('The file explorer must be rendered inside the workspace.');
    return value;
}
