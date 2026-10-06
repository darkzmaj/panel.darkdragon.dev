import { Button, Dialog, toast } from '@pterodactyl/sdk';
import { useState } from 'react';
import { normaliseHex, PRESETS, readableOn } from './colors';
import { useSetIconColor } from './queries';
import type { Instance } from './types';

interface Props {
    instance: Instance;
    recent: readonly string[];
    onClose: () => void;
}

function Swatch({
    color,
    selected,
    onPick,
    label,
}: {
    color: string;
    selected: boolean;
    onPick: (color: string) => void;
    label: string;
}) {
    return (
        <button
            type={'button'}
            aria-label={label}
            aria-pressed={selected}
            onClick={() => onPick(color)}
            style={{ backgroundColor: color }}
            className={
                'gb:size-8 gb:rounded-md gb:border gb:border-border gb:outline-offset-2 gb:transition-transform gb:hover:scale-110 gb:focus-visible:outline-2 gb:focus-visible:outline-ring ' +
                (selected ? 'gb:outline-2 gb:outline-primary' : '')
            }
        />
    );
}

/** Choose a colour for one instance's icon: default, presets, a custom colour and the five most recent. Nothing is saved until Apply. */
export default function IconColorDialog({ instance, recent, onClose }: Props) {
    const [color, setColor] = useState<string | null>(instance.icon_color);
    const [hex, setHex] = useState(instance.icon_color ?? '');
    const save = useSetIconColor();

    const pick = (next: string | null) => {
        setColor(next);
        setHex(next ?? '');
    };
    const typed = (value: string) => {
        setHex(value);
        const valid = normaliseHex(value.startsWith('#') ? value : `#${value}`);
        if (valid) setColor(valid);
    };

    const apply = () =>
        save.mutate(
            { uuid: instance.uuid, color },
            {
                onSuccess: onClose,
                onError: () => toast.error('Could not save the icon colour.'),
            }
        );

    return (
        <Dialog
            open
            onClose={save.isPending ? () => {} : onClose}
            title={'Icon colour'}
            description={`Only you see this colour for ${instance.name}.`}
        >
            <div className={'gb:flex gb:flex-col gb:gap-5'}>
                <div className={'gb:flex gb:items-center gb:gap-4'}>
                    <div
                        aria-hidden
                        style={color ? { backgroundColor: color, color: readableOn(color) } : undefined}
                        className={
                            'gb:grid gb:size-14 gb:place-items-center gb:rounded-xl gb:border gb:border-border gb:bg-secondary gb:text-lg gb:font-semibold gb:text-secondary-foreground'
                        }
                    >
                        {instance.name.slice(0, 1).toUpperCase()}
                    </div>
                    <Button.Text type={'button'} onClick={() => pick(null)} disabled={color === null}>
                        Use default
                    </Button.Text>
                </div>

                <section aria-label={'Presets'}>
                    <h3
                        className={
                            'gb:mb-2 gb:text-xs gb:font-medium gb:uppercase gb:tracking-wide gb:text-muted-foreground'
                        }
                    >
                        Presets
                    </h3>
                    <div className={'gb:flex gb:flex-wrap gb:gap-2'}>
                        {PRESETS.map((preset) => (
                            <Swatch
                                key={preset}
                                color={preset}
                                selected={color === preset}
                                onPick={pick}
                                label={`Colour ${preset}`}
                            />
                        ))}
                    </div>
                </section>

                {recent.length > 0 && (
                    <section aria-label={'Recent colours'}>
                        <h3
                            className={
                                'gb:mb-2 gb:text-xs gb:font-medium gb:uppercase gb:tracking-wide gb:text-muted-foreground'
                            }
                        >
                            Recent
                        </h3>
                        <div className={'gb:flex gb:flex-wrap gb:gap-2'}>
                            {recent.map((item) => (
                                <Swatch
                                    key={item}
                                    color={item}
                                    selected={color === item}
                                    onPick={pick}
                                    label={`Recent colour ${item}`}
                                />
                            ))}
                        </div>
                    </section>
                )}

                <section aria-label={'Custom colour'} className={'gb:flex gb:items-center gb:gap-3'}>
                    <input
                        type={'color'}
                        aria-label={'Pick a custom colour'}
                        value={color ?? '#4da3ff'}
                        onChange={(event) => pick(event.currentTarget.value)}
                        className={
                            'gb:size-9 gb:cursor-pointer gb:rounded-md gb:border gb:border-border gb:bg-transparent gb:p-0'
                        }
                    />
                    <input
                        type={'text'}
                        aria-label={'Hex colour'}
                        value={hex}
                        placeholder={'#4da3ff'}
                        maxLength={7}
                        spellCheck={false}
                        onChange={(event) => typed(event.currentTarget.value)}
                        className={
                            'gb:w-28 gb:rounded-md gb:border gb:border-input gb:bg-background gb:px-2 gb:py-1.5 gb:font-mono gb:text-sm'
                        }
                    />
                </section>
            </div>
            <Dialog.Footer>
                <Button.Text type={'button'} onClick={onClose} disabled={save.isPending}>
                    Cancel
                </Button.Text>
                <Button
                    type={'button'}
                    color={'primary'}
                    isLoading={save.isPending}
                    disabled={color === instance.icon_color}
                    onClick={apply}
                >
                    Apply
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
}
