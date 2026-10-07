/**
 * Named points of the file workspace's load path, in milliseconds since navigation start, readable in the console as
 * `window.__gobiaFiles` and as User Timing marks (`gobia-files:<name>`). `once` keeps the first reading of a point.
 */
const readings = new Map<string, number>();

export function mark(name: string, once = false) {
    if (once && readings.has(name)) return;
    readings.set(name, Math.round(performance.now()));
    try {
        performance.mark(`gobia-files:${name}`);
    } catch {
        // User Timing is optional.
    }
    Object.assign(window, { __gobiaFiles: Object.fromEntries(readings) });
}
