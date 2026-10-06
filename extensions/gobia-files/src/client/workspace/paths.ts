export const dirname = (path: string): string => {
    const index = path.lastIndexOf('/');
    return index <= 0 ? '/' : path.slice(0, index);
};

export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export const join = (directory: string, name: string): string =>
    directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`;

/** Files above this size are downloaded instead of edited in the browser. */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
