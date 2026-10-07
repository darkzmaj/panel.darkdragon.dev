import { Dialog, toast } from '@pterodactyl/sdk';
import { useState } from 'react';
import { normaliseHex } from './colors';
import { useSetIconColor } from './queries';
import type { Instance } from './types';

// The 1.x presets, in the order of the old dialog.
const PRESETS: ReadonlyArray<readonly [string, string]> = [
    ['Blue', '#3b82f6'],
    ['Cyan', '#06b6d4'],
    ['Purple', '#a855f7'],
    ['Green', '#22c55e'],
    ['Orange', '#f97316'],
    ['Red', '#ef4444'],
    ['Gray', '#94a3b8'],
];
const FALLBACK = '#3b82f6';

interface Props {
    instance: Instance;
    recent: readonly string[];
    onClose: () => void;
}

/**
 * Picks the colour of one instance icon. Choosing only selects: nothing is saved, and the dialog stays open, until
 * Apply. A click outside never closes it, because a stray click while using the native colour picker would otherwise
 * throw the choice away.
 */
export default function IconColorDialog({ instance, recent, onClose }: Props) {
    const [selected, setSelected] = useState<string | null>(instance.icon_color);
    const [custom, setCustom] = useState(instance.icon_color ?? FALLBACK);
    const save = useSetIconColor();

    const isSelected = (hex: string | null) => (selected ?? '').toLowerCase() === (hex ?? '').toLowerCase();
    const unchanged = (selected ?? null) === (instance.icon_color ?? null);
    const typed = (value: string) => {
        setCustom(value);
        const valid = normaliseHex(value.startsWith('#') ? value : `#${value}`);
        if (valid) setSelected(valid);
    };

    const apply = () =>
        save.mutate(
            { uuid: instance.uuid, color: selected },
            { onSuccess: onClose, onError: () => toast.error('Could not save the icon colour.') }
        );

    const swatch = (hex: string, name: string) => (
        <button
            key={`${hex}-${name}`}
            type={'button'}
            className={'gb-swatch' + (isSelected(hex) ? ' selected' : '')}
            style={{ background: hex }}
            aria-label={name}
            aria-pressed={isSelected(hex)}
            title={name}
            onClick={() => setSelected(hex)}
        />
    );

    return (
        <Dialog
            open
            onClose={onClose}
            preventExternalClose
            title={'Icon colour'}
            description={`Choose a colour for ${instance.name}. Only you see it.`}
        >
            <div className={'gb-eyebrow'} style={{ marginBottom: 8 }}>
                Colours
            </div>
            <div className={'gb-swatches'} role={'group'} aria-label={'Colours'}>
                <button
                    type={'button'}
                    className={'gb-swatch default' + (selected === null ? ' selected' : '')}
                    aria-pressed={selected === null}
                    onClick={() => setSelected(null)}
                >
                    Default
                </button>
                {PRESETS.map(([name, hex]) => swatch(hex, name))}
            </div>

            <div className={'gb-eyebrow'} style={{ margin: '16px 0 8px' }}>
                Custom
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                    type={'color'}
                    aria-label={'Pick a custom colour'}
                    value={normaliseHex(custom) ?? FALLBACK}
                    onChange={(event) => {
                        setCustom(event.currentTarget.value);
                        setSelected(event.currentTarget.value);
                    }}
                    style={{
                        width: 44,
                        height: 40,
                        padding: 2,
                        border: 0,
                        background: 'transparent',
                        cursor: 'pointer',
                    }}
                />
                <input
                    className={'gb-input'}
                    aria-label={'Hex colour'}
                    maxLength={7}
                    value={custom}
                    placeholder={FALLBACK}
                    onChange={(event) => typed(event.currentTarget.value)}
                />
            </div>

            {recent.length > 0 && (
                <>
                    <div className={'gb-eyebrow'} style={{ margin: '16px 0 8px' }}>
                        Recently used
                    </div>
                    <div className={'gb-swatches'} role={'group'} aria-label={'Recently used'}>
                        {recent.slice(0, 5).map((hex) => swatch(hex, hex))}
                    </div>
                </>
            )}

            <div className={'gb-modal-actions'}>
                <button type={'button'} className={'gb-btn'} onClick={onClose}>
                    Cancel
                </button>
                <button
                    type={'button'}
                    className={'gb-btn gb-btn-primary'}
                    disabled={save.isPending || unchanged || (selected !== null && !normaliseHex(selected))}
                    onClick={apply}
                >
                    {save.isPending ? 'Applying…' : 'Apply'}
                </button>
            </div>
        </Dialog>
    );
}
