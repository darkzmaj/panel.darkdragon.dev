import React, { useEffect, useRef, useState } from 'react';
import tw from 'twin.macro';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAngleDown, faPencilAlt } from '@fortawesome/free-solid-svg-icons';
import classNames from 'classnames';
import Tooltip from '@/components/elements/tooltip/Tooltip';
import { LayoutCategory } from '@/api/account/layout';

export type ServerFilter = { kind: 'all' } | { kind: 'you' } | { kind: 'category'; id: number };

interface Props {
    filter: ServerFilter;
    categories: LayoutCategory[];
    onChange: (filter: ServerFilter) => void;
    onEdit: () => void;
}

const pill =
    'px-3 py-1.5 text-sm rounded no-underline whitespace-nowrap transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-600';

// The row above the server list: the built-in "All / You" selector, the user's own categories, and the editor button.
export default ({ filter, categories, onChange, onEdit }: Props) => {
    const [open, setOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const builtIn = filter.kind === 'you' ? 'You' : 'All';

    useEffect(() => {
        if (!open) return;

        const away = (e: MouseEvent) => !container.current?.contains(e.target as Node) && setOpen(false);
        const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', escape);

        return () => {
            document.removeEventListener('mousedown', away);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);

    const active = (on: boolean) => (on ? 'bg-neutral-600 text-neutral-50' : 'text-neutral-300 hover:bg-neutral-700');

    return (
        <div css={tw`flex items-center overflow-x-auto pb-1 mb-3`} role={'toolbar'} aria-label={'Server filters'}>
            <div ref={container} css={tw`relative flex-none`}>
                <button
                    type={'button'}
                    aria-haspopup={'listbox'}
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                    className={classNames(pill, active(filter.kind !== 'category'))}
                >
                    {builtIn} <FontAwesomeIcon icon={faAngleDown} css={tw`ml-1 text-xs`} />
                </button>
                {open && (
                    <ul
                        role={'listbox'}
                        css={tw`absolute left-0 top-full mt-1 w-40 py-1 rounded bg-neutral-800 border border-neutral-700 shadow-lg z-20`}
                    >
                        {(
                            [
                                ['All', 'every server you can access', { kind: 'all' }],
                                ['You', 'only servers you own', { kind: 'you' }],
                            ] as const
                        ).map(([label, hint, value]) => (
                            <li key={label} role={'option'} aria-selected={filter.kind === value.kind}>
                                <button
                                    type={'button'}
                                    title={hint}
                                    onClick={() => {
                                        onChange(value);
                                        setOpen(false);
                                    }}
                                    css={tw`block w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700 focus:outline-none focus:bg-neutral-700`}
                                >
                                    {label}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {categories.map((category) => (
                <button
                    key={category.id}
                    type={'button'}
                    onClick={() => onChange({ kind: 'category', id: category.id })}
                    aria-pressed={filter.kind === 'category' && filter.id === category.id}
                    className={classNames(
                        pill,
                        'ml-1 flex-none',
                        active(filter.kind === 'category' && filter.id === category.id)
                    )}
                >
                    {category.name}
                </button>
            ))}
            <Tooltip placement={'bottom'} content={'Edit categories'}>
                <button
                    type={'button'}
                    onClick={onEdit}
                    aria-label={'Edit categories'}
                    className={classNames(
                        pill,
                        'ml-1 flex-none text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700'
                    )}
                >
                    <FontAwesomeIcon icon={faPencilAlt} />
                </button>
            </Tooltip>
        </div>
    );
};
