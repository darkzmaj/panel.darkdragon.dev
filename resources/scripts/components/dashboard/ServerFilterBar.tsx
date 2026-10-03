import React, { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown, Pencil } from 'lucide-react';
import Popover from '@/components/elements/Popover';
import { LayoutCategory } from '@/api/account/layout';

export type ServerFilter = { kind: 'all' } | { kind: 'you' } | { kind: 'other' } | { kind: 'category'; id: number };

interface Props {
    filter: ServerFilter;
    categories: LayoutCategory[];
    onChange: (filter: ServerFilter) => void;
    onEdit: () => void;
    // Extra controls shown at the far right of the same row (for example the Create Instance button).
    children?: React.ReactNode;
}

const BUILT_IN = [
    { kind: 'all', label: 'All', hint: 'Every instance you can access' },
    { kind: 'you', label: 'You', hint: 'Instances you own' },
    { kind: 'other', label: 'Other', hint: 'Instances shared with you by someone else' },
] as const;

// The navigation row above the instance list. Everything lives in one flex row: the built-in views, the user's own
// categories (scrolling horizontally when there are many), the category editor and the page actions.
export default ({ filter, categories, onChange, onEdit, children }: Props) => {
    const [open, setOpen] = useState(false);
    const toggle = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);
    const current = BUILT_IN.find((b) => b.kind === filter.kind) || BUILT_IN[0];

    return (
        <div className={'gb-filterbar'} role={'toolbar'} aria-label={'Instance views'}>
            <button
                ref={toggle}
                type={'button'}
                aria-haspopup={'listbox'}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={'gb-chip' + (filter.kind !== 'category' ? ' active' : '')}
            >
                {current.label}
                <ChevronDown aria-hidden />
            </button>
            <Popover
                anchor={toggle.current}
                open={open}
                onClose={close}
                role={'listbox'}
                label={'Instance view'}
                className={'gb-menu'}
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
                        className={'gb-menu-item'}
                        style={{ height: 'auto', padding: '8px 10px', minWidth: 260 }}
                    >
                        <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', color: 'var(--gb-text-strong)', fontWeight: 600 }}>
                                {view.label}
                            </span>
                            <span className={'gb-secondary'} style={{ fontSize: 12 }}>
                                {view.hint}
                            </span>
                        </span>
                        {filter.kind === view.kind && <Check aria-hidden style={{ color: 'var(--gb-primary)' }} />}
                    </button>
                ))}
            </Popover>

            <div className={'gb-filterbar-scroll'}>
                {categories.map((category) => {
                    const on = filter.kind === 'category' && filter.id === category.id;

                    return (
                        <button
                            key={category.id}
                            type={'button'}
                            onClick={() => onChange({ kind: 'category', id: category.id })}
                            aria-pressed={on}
                            className={'gb-chip' + (on ? ' active' : '')}
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
                className={'gb-chip gb-chip-icon'}
            >
                <Pencil aria-hidden />
                <span className={'gb-chip-label'}>Edit</span>
            </button>
            {children}
        </div>
    );
};
