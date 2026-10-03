import React, { useEffect, useRef, useState } from 'react';
import { join } from 'pathe';
import { checkMove, DRAG_TYPE, DragPayload, decodeDrag, encodeDrag } from '@/components/server/files/fileOps';

// The browser hides the data of a drag until it is dropped, so the entries being dragged are also kept here. That
// lets a folder refuse to highlight as a target while something is dragged over itself or its own descendants.
let current: DragPayload | null = null;

export const beginDrag = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData(DRAG_TYPE, encodeDrag(payload));
    e.dataTransfer.setData('text/plain', payload.names.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
    current = payload;
};

export const endDrag = () => {
    current = null;
};

export const currentDrag = () => current;

export type DragKind = 'move' | 'files' | null;

export const dragKind = (e: { dataTransfer: DataTransfer | null }): DragKind => {
    const types = Array.from(e.dataTransfer?.types || []).map((t) => t.toLowerCase());
    if (types.includes(DRAG_TYPE)) return 'move';

    return types.includes('files') ? 'files' : null;
};

interface Options {
    // The directory that receives whatever is dropped here.
    directory: string;
    enabled?: boolean;
    onMove: (payload: DragPayload, directory: string) => void;
    onFiles: (data: DataTransfer, directory: string) => void;
    // Called once when something has been held over the target for a moment (used to open folders in a tree).
    onHoverOpen?: () => void;
}

/** Drag and drop props for anything that can receive files from the explorer or from the operating system. */
export const useDropTarget = ({ directory, enabled = true, onMove, onFiles, onHoverOpen }: Options) => {
    const [state, setState] = useState<'ok' | 'denied' | null>(null);
    const depth = useRef(0);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);

    const evaluate = (kind: DragKind): 'ok' | 'denied' => {
        if (kind !== 'move' || !current) return 'ok';

        return current.names.every((name) => checkMove(join(current!.directory, name), directory).ok) ? 'ok' : 'denied';
    };

    const reset = () => {
        depth.current = 0;
        clearTimeout(timer.current);
        setState(null);
    };

    return {
        state,
        props: {
            onDragEnter: (e: React.DragEvent) => {
                const kind = dragKind(e);
                if (!enabled || !kind) return;
                e.preventDefault();
                depth.current++;
                const result = evaluate(kind);
                setState(result);
                if (result === 'ok' && onHoverOpen) {
                    clearTimeout(timer.current);
                    timer.current = setTimeout(onHoverOpen, 700);
                }
            },
            onDragOver: (e: React.DragEvent) => {
                const kind = dragKind(e);
                if (!enabled || !kind) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = evaluate(kind) === 'ok' ? (kind === 'move' ? 'move' : 'copy') : 'none';
            },
            onDragLeave: (e: React.DragEvent) => {
                if (!enabled || !dragKind(e)) return;
                depth.current = Math.max(0, depth.current - 1);
                if (depth.current === 0) reset();
            },
            onDrop: (e: React.DragEvent) => {
                const kind = dragKind(e);
                if (!enabled || !kind) return;
                e.preventDefault();
                e.stopPropagation();
                const allowed = evaluate(kind) === 'ok';
                reset();
                if (!allowed) return;

                if (kind === 'move') {
                    const payload = decodeDrag(e.dataTransfer.getData(DRAG_TYPE));
                    if (payload) onMove(payload, directory);
                } else {
                    onFiles(e.dataTransfer, directory);
                }
            },
        },
    };
};
