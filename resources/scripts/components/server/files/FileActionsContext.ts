import React from 'react';
import { DragPayload } from '@/components/server/files/fileOps';

export interface FileActions {
    // Moves dragged entries into a directory (asks about conflicts, refuses recursive moves).
    moveInto: (payload: DragPayload, directory: string) => void;
    // Uploads files or folders dropped from the operating system into a directory.
    dropFiles: (data: DataTransfer, directory: string) => void;
    canMove: boolean;
}

export default React.createContext<FileActions>({
    moveInto: () => undefined,
    dropFiles: () => undefined,
    canMove: false,
});
