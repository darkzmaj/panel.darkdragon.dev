import React, { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Server } from '@/api/server/getServer';
import ServerRow from '@/components/dashboard/ServerRow';

interface Props {
    servers: Server[];
    colors?: Record<string, string | null>;
    onReorder: (servers: Server[]) => void;
    onMenu?: (server: Server, x: number, y: number) => void;
}

const move = (list: Server[], from: number, to: number) => {
    if (from === to || to < 0 || to >= list.length) return list;
    const copy = [...list];
    copy.splice(to, 0, copy.splice(from, 1)[0]);

    return copy;
};

// Instance rows that can be rearranged. A row is dragged by its slim grip, which is also a focusable control
// (arrow keys move the row) and, on touch screens where dragging is unavailable, is joined by move buttons.
export default ({ servers, colors, onReorder, onMenu }: Props) => {
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const [armed, setArmed] = useState<string | null>(null);
    const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

    const finish = () => {
        setDragging(null);
        setOver(null);
        setArmed(null);
    };

    return (
        <div className={'gb-list gb-server-list'}>
            <div className={'gb-list-head gb-server-head'} aria-hidden>
                <span>Instance</span>
                <span className={'gb-col-where'}>Node &amp; address</span>
                <span className={'gb-col-stats'}>CPU &middot; Memory &middot; Storage</span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {servers.map((server, index) => (
                    <li
                        key={server.uuid}
                        className={
                            'gb-server-item' +
                            (dragging === server.uuid ? ' dragging' : '') +
                            (over === server.uuid && dragging !== server.uuid ? ' drop-target' : '')
                        }
                        draggable={armed === server.uuid}
                        onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', server.uuid);
                            setDragging(server.uuid);
                        }}
                        onDragOver={(e) => {
                            if (!dragging) return;
                            e.preventDefault();
                            setOver(server.uuid);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            const from = servers.findIndex((s) => s.uuid === dragging);
                            finish();
                            if (from >= 0 && from !== index) onReorder(move(servers, from, index));
                        }}
                        onDragEnd={finish}
                        onContextMenu={(e) => {
                            if (!onMenu) return;
                            e.preventDefault();
                            onMenu(server, e.clientX, e.clientY);
                        }}
                    >
                        <div className={'gb-grip'}>
                            <button
                                type={'button'}
                                aria-label={`Reorder ${server.name}. Use the up and down arrow keys, or drag.`}
                                title={'Drag to reorder'}
                                onMouseDown={() => setArmed(server.uuid)}
                                onMouseUp={() => setArmed(null)}
                                onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        onReorder(move(servers, index, index + (e.key === 'ArrowUp' ? -1 : 1)));
                                    }
                                }}
                                style={{ cursor: 'grab' }}
                            >
                                <GripVertical aria-hidden />
                            </button>
                            {touch && (
                                <>
                                    <button
                                        type={'button'}
                                        aria-label={`Move ${server.name} up`}
                                        disabled={index === 0}
                                        onClick={() => onReorder(move(servers, index, index - 1))}
                                    >
                                        <ArrowUp aria-hidden />
                                    </button>
                                    <button
                                        type={'button'}
                                        aria-label={`Move ${server.name} down`}
                                        disabled={index === servers.length - 1}
                                        onClick={() => onReorder(move(servers, index, index + 1))}
                                    >
                                        <ArrowDown aria-hidden />
                                    </button>
                                </>
                            )}
                        </div>
                        <ServerRow server={server} color={colors?.[server.uuid]} />
                    </li>
                ))}
            </ul>
        </div>
    );
};
