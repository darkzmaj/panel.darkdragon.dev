import React, { useEffect, useState } from 'react';
import Modal from '@/components/elements/Modal';
import { httpErrorToHuman } from '@/api/http';
import { LayoutServer, ServerLayout, setIconColor } from '@/api/account/layout';

export const PRESETS: Array<[string, string]> = [
    ['Blue', '#3b82f6'],
    ['Cyan', '#06b6d4'],
    ['Purple', '#a855f7'],
    ['Green', '#22c55e'],
    ['Orange', '#f97316'],
    ['Red', '#ef4444'],
    ['Gray', '#94a3b8'],
];

const HEX = /^#[0-9a-f]{6}$/i;

interface Props {
    server: LayoutServer | null;
    recent: string[];
    onClose: () => void;
    onChanged: (layout: ServerLayout) => void;
}

// Picks the colour of one instance icon. Choosing only selects: nothing is saved, and the dialog stays open, until Apply.
// The dialog does not close when the backdrop is clicked, because the native colour picker and a stray click while
// choosing would otherwise throw the choice away.
export default ({ server, recent, onClose, onChanged }: Props) => {
    const [selected, setSelected] = useState<string | null>(null);
    const [custom, setCustom] = useState('#3b82f6');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Start from the colour the server has now, every time the dialog opens for a server.
    const uuid = server?.uuid;
    useEffect(() => {
        setSelected(server?.color ?? null);
        setCustom(server?.color ?? '#3b82f6');
        setError(null);
        setSaving(false);
    }, [uuid]);

    const apply = () => {
        if (!server || saving) return;
        setSaving(true);
        setError(null);
        setIconColor(server.uuid, selected)
            .then((layout) => {
                onChanged(layout);
                onClose();
            })
            .catch((e) => {
                setError(httpErrorToHuman(e));
                setSaving(false);
            });
    };

    const isSelected = (hex: string | null) => (selected || '').toLowerCase() === (hex || '').toLowerCase();
    const unchanged = (selected || null) === (server?.color || null);
    const swatch = (hex: string, name: string) => (
        <button
            key={hex + name}
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
        <Modal visible={!!server} onDismissed={onClose} dismissable={false} closeOnEscape closeOnBackground={false}>
            <h3 className={'gb-card-title'} style={{ fontSize: 22 }}>
                Icon colour
            </h3>
            <p className={'gb-card-sub'} style={{ marginBottom: 16 }}>
                Choose a colour for {server?.name}. Only you see it.
            </p>
            {error && (
                <p role={'alert'} className={'gb-badge gb-badge-danger'} style={{ marginBottom: 12 }}>
                    {error}
                </p>
            )}

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
            <div className={'gb-custom-colour'}>
                <input
                    type={'color'}
                    aria-label={'Pick a custom colour'}
                    value={HEX.test(custom) ? custom : '#3b82f6'}
                    onChange={(e) => {
                        setCustom(e.currentTarget.value);
                        setSelected(e.currentTarget.value);
                    }}
                />
                <input
                    className={'gb-input'}
                    aria-label={'Hex colour'}
                    maxLength={7}
                    value={custom}
                    placeholder={'#3b82f6'}
                    onChange={(e) => {
                        const value = e.currentTarget.value;
                        setCustom(value);
                        if (HEX.test(value)) setSelected(value.toLowerCase());
                    }}
                />
            </div>

            {recent.length > 0 && (
                <>
                    <div className={'gb-eyebrow'} style={{ margin: '16px 0 8px' }}>
                        Recently used
                    </div>
                    <div className={'gb-swatches'} role={'group'} aria-label={'Recently used'}>
                        {recent.map((hex) => swatch(hex, hex))}
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
                    disabled={saving || unchanged || (selected !== null && !HEX.test(selected))}
                    onClick={apply}
                >
                    {saving ? 'Applying…' : 'Apply'}
                </button>
            </div>
        </Modal>
    );
};
