import React, { useState } from 'react';
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

interface Props {
    server: LayoutServer | null;
    onClose: () => void;
    onChanged: (layout: ServerLayout) => void;
}

// Picks the colour of one instance icon. Only the person choosing sees it.
export default ({ server, onClose, onChanged }: Props) => {
    const [error, setError] = useState<string | null>(null);

    const choose = (color: string | null) => {
        if (!server) return;
        setIconColor(server.uuid, color)
            .then((layout) => {
                onChanged(layout);
                onClose();
            })
            .catch((e) => setError(httpErrorToHuman(e)));
    };

    return (
        <Modal visible={!!server} onDismissed={onClose} dismissable closeOnEscape>
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
            <div className={'gb-swatches'} role={'group'} aria-label={'Icon colour'}>
                <button type={'button'} className={'gb-swatch default'} onClick={() => choose(null)}>
                    Default
                </button>
                {PRESETS.map(([name, hex]) => (
                    <button
                        key={hex}
                        type={'button'}
                        className={'gb-swatch' + (server?.color === hex ? ' selected' : '')}
                        style={{ background: hex }}
                        aria-label={name}
                        title={name}
                        onClick={() => choose(hex)}
                    />
                ))}
                <label className={'gb-swatch custom'} title={'Custom colour'}>
                    <input
                        type={'color'}
                        aria-label={'Custom colour'}
                        defaultValue={server?.color || '#3b82f6'}
                        onChange={(e) => choose(e.currentTarget.value)}
                    />
                </label>
            </div>
            <div className={'gb-modal-actions'}>
                <button type={'button'} className={'gb-btn'} onClick={onClose}>
                    Close
                </button>
            </div>
        </Modal>
    );
};
