/** Pure helpers for reordering a list of ids by drag or keyboard. */

/** Moves the item at `from` so it ends up at index `to`. Out of range indexes are clamped; the input is not mutated. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
    if (from < 0 || from >= items.length) return [...items];
    const target = Math.max(0, Math.min(items.length - 1, to));
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(target, 0, item);
    return next;
}

/**
 * The index a dragged row should take, given the vertical centres of the rows in their current order and the pointer
 * position: the first row whose centre is below the pointer, or the end of the list.
 */
export function indexForPointer(centers: readonly number[], pointerY: number): number {
    const index = centers.findIndex((center) => pointerY < center);
    return index === -1 ? Math.max(0, centers.length - 1) : index;
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
