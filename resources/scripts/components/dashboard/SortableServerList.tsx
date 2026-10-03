import React, { useState } from 'react';
import tw from 'twin.macro';
import { Server } from '@/api/server/getServer';
import ServerRow from '@/components/dashboard/ServerRow';

interface Props {
    servers: Server[];
    // When omitted the list is read-only (for example the administrator "other servers" view).
    onReorder?: (servers: Server[]) => void;
}

const reorder = (list: Server[], from: number, to: number) => {
    if (from === to || to < 0 || to >= list.length) return list;
    const copy = [...list];
    copy.splice(to, 0, copy.splice(from, 1)[0]);

    return copy;
};

// Server rows the user can rearrange by dragging, or with the arrow buttons for keyboard and touch use.
export default ({ servers, onReorder }: Props) => {
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);

    if (!onReorder) {
        return (
            <>
                {servers.map((server, index) => (
                    <ServerRow key={server.uuid} server={server} css={index > 0 ? tw`mt-2` : undefined} />
                ))}
            </>
        );
    }

    const drop = (target: string) => {
        const from = servers.findIndex((s) => s.uuid === dragging);
        const to = servers.findIndex((s) => s.uuid === target);
        setDragging(null);
        setOver(null);
        if (from >= 0 && to >= 0 && from !== to) onReorder(reorder(servers, from, to));
    };

    return (
        <>
            {servers.map((server, index) => (
                <div
                    key={server.uuid}
                    draggable
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
                        drop(server.uuid);
                    }}
                    onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                    }}
                    css={[
                        tw`flex items-stretch`,
                        index > 0 && tw`mt-2`,
                        dragging === server.uuid && tw`opacity-40`,
                        over === server.uuid && dragging !== server.uuid && tw`ring-2 ring-cyan-600 rounded`,
                    ]}
                >
                    <div css={tw`flex flex-col justify-center mr-1 text-neutral-500`}>
                        <button
                            type={'button'}
                            aria-label={`Move ${server.name} up`}
                            disabled={index === 0}
                            onClick={() => onReorder(reorder(servers, index, index - 1))}
                            css={tw`px-1 leading-none hover:text-neutral-100 disabled:opacity-20 focus:outline-none focus:text-cyan-400`}
                        >
                            &#9650;
                        </button>
                        <button
                            type={'button'}
                            aria-label={`Move ${server.name} down`}
                            disabled={index === servers.length - 1}
                            onClick={() => onReorder(reorder(servers, index, index + 1))}
                            css={tw`px-1 leading-none hover:text-neutral-100 disabled:opacity-20 focus:outline-none focus:text-cyan-400`}
                        >
                            &#9660;
                        </button>
                    </div>
                    <ServerRow server={server} css={tw`flex-1 min-w-0`} />
                </div>
            ))}
        </>
    );
};
