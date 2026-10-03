import React, { useState } from 'react';
import tw from 'twin.macro';
import { Server } from '@/api/server/getServer';
import ServerRow from '@/components/dashboard/ServerRow';

interface Props {
    servers: Server[];
    onReorder: (servers: Server[]) => void;
}

const move = (list: Server[], from: number, to: number) => {
    if (from === to || to < 0 || to >= list.length) return list;
    const copy = [...list];
    copy.splice(to, 0, copy.splice(from, 1)[0]);

    return copy;
};

// Server rows that can be rearranged. On desktop a row is dragged by its slim grip; the grip is also a focusable
// control (arrow keys move the row) and, on touch screens where dragging is unavailable, shows move buttons.
export default ({ servers, onReorder }: Props) => {
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
        <ul css={tw`list-none m-0 p-0`}>
            {servers.map((server, index) => (
                <li
                    key={server.uuid}
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
                    css={[
                        tw`flex items-stretch relative`,
                        index > 0 && tw`mt-2`,
                        dragging === server.uuid && tw`opacity-40`,
                    ]}
                >
                    {over === server.uuid && dragging !== server.uuid && (
                        <span aria-hidden css={tw`absolute left-0 right-0 h-0.5 bg-cyan-500 -top-1.5 rounded`} />
                    )}
                    <div css={tw`flex flex-col items-center justify-center w-5 flex-none text-neutral-600`}>
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
                            css={tw`leading-none hover:text-neutral-300 focus:text-cyan-400 focus:outline-none`}
                        >
                            &#8942;
                        </button>
                        {touch && (
                            <>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${server.name} up`}
                                    disabled={index === 0}
                                    onClick={() => onReorder(move(servers, index, index - 1))}
                                    css={tw`text-xs leading-none disabled:opacity-20`}
                                >
                                    &#9650;
                                </button>
                                <button
                                    type={'button'}
                                    aria-label={`Move ${server.name} down`}
                                    disabled={index === servers.length - 1}
                                    onClick={() => onReorder(move(servers, index, index + 1))}
                                    css={tw`text-xs leading-none disabled:opacity-20`}
                                >
                                    &#9660;
                                </button>
                            </>
                        )}
                    </div>
                    <ServerRow server={server} css={tw`flex-1 min-w-0`} />
                </li>
            ))}
        </ul>
    );
};
