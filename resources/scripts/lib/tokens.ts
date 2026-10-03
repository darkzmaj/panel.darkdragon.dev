// Reads the design tokens (CSS variables from /themes/gobia/gobia.css) for code that cannot use CSS, such as charts.
// Channel variables are stored as "r g b", so a colour is built as rgba() and always matches the active theme.
const channels = (name: string): [number, number, number] => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    const [r, g, b] = raw.split(/\s+/).map(Number);

    return [r || 0, g || 0, b || 0];
};

/** e.g. tokenColor('p-400', 0.5) -> "rgba(94, 174, 255, 0.5)". */
export const tokenColor = (name: string, alpha = 1): string => {
    const [r, g, b] = channels(name);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
