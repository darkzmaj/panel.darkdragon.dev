import { LEVEL_TEXT, dotView, type DotsMode, type Level } from '@/gobia/statusLevels';

interface Reading {
    level: Level;
    /** The value in words, for the tooltip and screen readers ("42%", "256 MiB"). */
    text: string;
}

interface Props {
    mode: DotsMode;
    powerLabel: string;
    cpu: Reading;
    memory: Reading;
    disk: Reading;
    vertical?: boolean;
}

const OFF_TEXT = {
    offline: 'instance is off',
    unavailable: 'instance is unavailable',
} satisfies Partial<Record<DotsMode, string>>;

/**
 * Four dots that read at a glance: power, then CPU, memory and storage against their limits. While the instance is
 * running every dot flashes in the colour of its level (green normal, yellow high, red at the limit); starting,
 * stopping and installing flash yellow; an instance that is off or unavailable shows four steady red dots. Only
 * opacity animates, which the browser composites without repainting, and motion stops for people who ask for it.
 */
export default function StatusDots({ mode, powerLabel, cpu, memory, disk, vertical = false }: Props) {
    const off = mode === 'offline' || mode === 'unavailable' ? OFF_TEXT[mode] : undefined;
    const text = (label: string, reading: Reading, view: ReturnType<typeof dotView>) =>
        off
            ? `${label}: ${off}`
            : `${label} ${reading.text}, ${LEVEL_TEXT[view.level === 'idle' ? 'idle' : reading.level]}`;
    const dots = [
        { key: 'power', view: dotView(mode, 'ok'), label: `Power: ${powerLabel}` },
        { key: 'cpu', view: dotView(mode, cpu.level), label: '' },
        { key: 'memory', view: dotView(mode, memory.level), label: '' },
        { key: 'disk', view: dotView(mode, disk.level), label: '' },
    ].map((dot) => {
        const reading = dot.key === 'cpu' ? cpu : dot.key === 'memory' ? memory : disk;
        const name = dot.key === 'cpu' ? 'CPU' : dot.key === 'memory' ? 'Memory' : 'Storage';

        return dot.key === 'power' ? dot : { ...dot, label: text(name, reading, dot.view) };
    });

    return (
        <span
            className={'gb-dots' + (vertical ? ' gb-dots-vertical' : '')}
            role={'group'}
            aria-label={'Instance status'}
            title={dots.map((dot) => dot.label).join(' · ')}
        >
            {dots.map((dot) => (
                <span
                    key={dot.key}
                    className={`gb-sdot ${dot.view.level}${dot.view.flashing ? ' flash' : ''}`}
                    data-dot={dot.key}
                    data-level={dot.view.level}
                    role={'img'}
                    aria-label={dot.label}
                />
            ))}
        </span>
    );
}
