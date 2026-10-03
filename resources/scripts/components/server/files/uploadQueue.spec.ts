import { planUploads } from './uploadQueue';

const file = (name: string) => new File(['x'], name);

describe('planUploads', () => {
    it('puts loose files straight into the target directory', () => {
        const plan = planUploads('/plugins', [{ file: file('a.jar'), relativePath: 'a.jar' }]);
        expect(plan.directories).toEqual([]);
        expect(plan.files.map((f) => [f.directory, f.label])).toEqual([['/plugins', 'a.jar']]);
    });

    it('creates every folder of a dropped tree, parents first', () => {
        const plan = planUploads('/', [
            { file: file('r.mca'), relativePath: 'world/region/r.mca' },
            { file: file('level.dat'), relativePath: 'world/level.dat' },
        ]);
        expect(plan.directories).toEqual(['/world', '/world/region']);
        expect(plan.files.map((f) => f.directory)).toEqual(['/world/region', '/world']);
    });

    it('keeps empty folders', () => {
        const plan = planUploads('/data', [], ['empty/nested']);
        expect(plan.directories).toEqual(['/data/empty', '/data/empty/nested']);
    });

    it('drops anything that tries to leave the target', () => {
        const plan = planUploads('/data', [
            { file: file('x'), relativePath: '../etc/x' },
            { file: file('y'), relativePath: 'ok/../y' },
            { file: file('z'), relativePath: 'good/z' },
        ]);
        expect(plan.files.map((f) => f.label)).toEqual(['good/z']);
        expect(plan.directories).toEqual(['/data/good']);
    });
});
