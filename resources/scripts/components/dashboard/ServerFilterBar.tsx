import React, { useCallback, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAngleDown, faCheck, faPencilAlt } from '@fortawesome/free-solid-svg-icons';
import classNames from 'classnames';
import Popover from '@/components/elements/Popover';
import { LayoutCategory } from '@/api/account/layout';

export type ServerFilter = { kind: 'all' } | { kind: 'you' } | { kind: 'other' } | { kind: 'category'; id: number };

interface Props {
    filter: ServerFilter;
    categories: LayoutCategory[];
    onChange: (filter: ServerFilter) => void;
    onEdit: () => void;
}

const BUILT_IN = [
    { kind: 'all', label: 'All', hint: 'Every server you can access' },
    { kind: 'you', label: 'You', hint: 'Servers you own' },
    { kind: 'other', label: 'Other', hint: 'Servers shared with you by someone else' },
] as const;

const pill =
    'h-8 px-3 inline-flex items-center flex-none text-sm leading-none rounded no-underline whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-cyan-600';
const state = (on: boolean) =>
    on ? 'bg-neutral-600 text-neutral-50' : 'text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100';

// The navigation row above the server list. Everything lives in one flex row: the built-in views, the user's own
// categories (scrolling horizontally when there are many) and the category editor button.
export default ({ filter, categories, onChange, onEdit }: Props) => {
    const [open, setOpen] = useState(false);
    const toggle = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);
    const current = BUILT_IN.find((b) => b.kind === filter.kind) || BUILT_IN[0];

    return (
        <div className={'flex items-center min-w-0'} role={'toolbar'} aria-label={'Server views'}>
            <button
                ref={toggle}
                type={'button'}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={classNames(pill, state(filter.kind !== 'category'))}
            >
                {current.label}
                <FontAwesomeIcon icon={faAngleDown} className={'ml-2 text-xs'} />
            </button>
            <Popover
                anchor={toggle.current}
                open={open}
                onClose={close}
                role={'listbox'}
                label={'Server view'}
                className={'w-56 py-1 rounded bg-neutral-800 border border-neutral-700 shadow-lg'}
            >
                {BUILT_IN.map((view) => (
                    <button
                        key={view.kind}
                        type={'button'}
                        role={'option'}
                        aria-selected={filter.kind === view.kind}
                        onClick={() => {
                            onChange({ kind: view.kind });
                            close();
                        }}
                        className={
                            'flex items-center w-full text-left px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none'
                        }
                    >
                        <span className={'flex-1'}>
                            {view.label}
                            <span className={'block text-xs text-neutral-500'}>{view.hint}</span>
                        </span>
                        {filter.kind === view.kind && (
                            <FontAwesomeIcon icon={faCheck} className={'ml-3 text-cyan-400'} />
                        )}
                    </button>
                ))}
            </Popover>

            <div className={'flex-1 min-w-0 flex items-center overflow-x-auto ml-1'} style={{ scrollbarWidth: 'thin' }}>
                {categories.map((category) => {
                    const on = filter.kind === 'category' && filter.id === category.id;

                    return (
                        <button
                            key={category.id}
                            type={'button'}
                            onClick={() => onChange({ kind: 'category', id: category.id })}
                            aria-pressed={on}
                            className={classNames(pill, 'mr-1', state(on))}
                        >
                            {category.name}
                        </button>
                    );
                })}
            </div>

            <button
                type={'button'}
                onClick={onEdit}
                title={'Edit categories'}
                aria-label={'Edit categories'}
                className={classNames(pill, 'ml-1 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700')}
            >
                <FontAwesomeIcon icon={faPencilAlt} />
            </button>
        </div>
    );
};
