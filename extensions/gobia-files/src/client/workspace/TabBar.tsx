import { X } from 'lucide-react';
import { isDirty, type Tab } from './tabs';

interface TabBarProps {
    tabs: readonly Tab[];
    active: string | null;
    onActivate: (path: string) => void;
    onClose: (path: string) => void;
}

export default function TabBar({ tabs, active, onActivate, onClose }: TabBarProps) {
    return (
        <div
            role={'tablist'}
            aria-label={'Open files'}
            className={'gf:flex gf:overflow-x-auto gf:border-b gf:border-border gf:[scrollbar-width:thin]'}
        >
            {tabs.map((tab) => {
                const selected = tab.path === active;
                const dirty = isDirty(tab);
                return (
                    <div
                        key={tab.path}
                        className={
                            'gf:flex gf:shrink-0 gf:items-center gf:border-r gf:border-border ' +
                            (selected ? 'gf:bg-card gf:text-foreground' : 'gf:text-muted-foreground')
                        }
                    >
                        <button
                            type={'button'}
                            role={'tab'}
                            aria-selected={selected}
                            title={tab.path}
                            onClick={() => onActivate(tab.path)}
                            onAuxClick={(event) => {
                                if (event.button === 1) onClose(tab.path);
                            }}
                            className={
                                'gf:max-w-48 gf:truncate gf:py-2 gf:pl-3 gf:pr-1 gf:text-sm gf:focus-visible:outline-2 gf:focus-visible:outline-ring'
                            }
                        >
                            {tab.name}
                            {dirty && (
                                <span aria-hidden className={'gf:ml-1 gf:text-primary'}>
                                    ●
                                </span>
                            )}
                            {dirty && <span className={'gf:sr-only'}> (unsaved changes)</span>}
                        </button>
                        <button
                            type={'button'}
                            aria-label={`Close ${tab.name}`}
                            onClick={() => onClose(tab.path)}
                            className={
                                'gf:grid gf:size-6 gf:place-items-center gf:rounded gf:mr-1 gf:hover:bg-secondary gf:focus-visible:outline-2 gf:focus-visible:outline-ring'
                            }
                        >
                            <X size={14} aria-hidden />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
