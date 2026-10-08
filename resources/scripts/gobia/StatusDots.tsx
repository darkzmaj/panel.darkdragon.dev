import { LEVEL_TEXT, type Level } from '@/gobia/statusLevels';

interface Reading {
    level: Level;
    /** The value in words, for the tooltip and screen readers ("42%", "256 MiB"). */
    text: string;
}

interface Props {
    power: { level: Level; flashing: boolean };
    /** The instance is being installed: yellow instead of the red of an unavailable one. */
    installing?: boolean;
    powerLabel: string;
    cpu: Reading;
    memory: Reading;
    disk: Reading;
    vertical?: boolean;
}

/**
 * Four dots that read at a glance: power (flashes while it is on), then CPU, memory and storage against their limits
 * (green normal, yellow flashing when high, red at the limit, grey when not measured). Motion stops for people who
 * ask for reduced motion; the colours and the labels stay.
 */
export default function StatusDots({
    power,
    installing = false,
    powerLabel,
    cpu,
    memory,
    disk,
    vertical = false,
}: Props) {
    const level = installing ? 'high' : power.level;
    const dots: Array<{ key: string; level: Level; flashing: boolean; label: string }> = [
        { key: 'power', level, flashing: power.flashing || installing, label: `Power: ${powerLabel}` },
        {
            key: 'cpu',
            level: cpu.level,
            flashing: cpu.level === 'high',
            label: `CPU ${cpu.text}, ${LEVEL_TEXT[cpu.level]}`,
        },
        {
            key: 'memory',
            level: memory.level,
            flashing: memory.level === 'high',
            label: `Memory ${memory.text}, ${LEVEL_TEXT[memory.level]}`,
        },
        {
            key: 'disk',
            level: disk.level,
            flashing: disk.level === 'high',
            label: `Storage ${disk.text}, ${LEVEL_TEXT[disk.level]}`,
        },
    ];
    const summary = dots.map((dot) => dot.label).join(' · ');

    return (
        <span
            className={'gb-dots' + (vertical ? ' gb-dots-vertical' : '')}
            role={'group'}
            aria-label={'Instance status'}
            title={summary}
        >
            {dots.map((dot) => (
                <span
                    key={dot.key}
                    className={`gb-sdot ${dot.level}${dot.flashing ? ' flash' : ''}`}
                    data-dot={dot.key}
                    data-level={dot.level}
                    role={'img'}
                    aria-label={dot.label}
                />
            ))}
        </span>
    );
}
