import { describe, expect, it } from 'vitest';
import { foldersToCreate, uploadReducer, type PickedFile, type UploadItem } from './uploads';

const file = (name: string) => new File(['x'], name);
const picked = (folder: string, name = 'f.txt'): PickedFile => ({ file: file(name), folder });
const item = (id: number, status: UploadItem['status']): UploadItem => ({
    id,
    file: file(`${id}.txt`),
    directory: '/',
    loaded: 0,
    status,
    error: null,
});

describe('foldersToCreate', () => {
    it('lists every folder once, parents before children', () => {
        const folders = foldersToCreate([picked('a/b/c'), picked('a/d'), picked('a/b/c', 'g.txt'), picked('')]);
        expect(folders).toEqual(['a', 'a/b', 'a/d', 'a/b/c']);
    });

    it('needs nothing for files at the top level', () => {
        expect(foldersToCreate([picked('')])).toEqual([]);
    });
});

describe('uploadReducer', () => {
    it('updates one item and clears only finished ones', () => {
        let state = uploadReducer([], { type: 'add', items: [item(1, 'queued'), item(2, 'done'), item(3, 'failed')] });
        state = uploadReducer(state, { type: 'update', id: 1, change: { status: 'uploading', loaded: 1 } });
        expect(state[0]).toMatchObject({ status: 'uploading', loaded: 1 });
        expect(uploadReducer(state, { type: 'clearFinished' }).map((entry) => entry.id)).toEqual([1]);
        expect(uploadReducer(state, { type: 'remove', id: 2 }).map((entry) => entry.id)).toEqual([1, 3]);
    });
});
