const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig');

/** @type {import('ts-jest').InitialOptionsTsJest} */
module.exports = {
    preset: 'ts-jest',
    globals: {
        'ts-jest': {
            isolatedModules: true,
        },
    },
    moduleFileExtensions: ['js', 'ts', 'tsx', 'd.ts', 'json', 'node'],
    moduleNameMapper: {
        '\\.(jpe?g|png|gif|svg)$': '<rootDir>/resources/scripts/__mocks__/file.ts',
        '\\.(s?css|less)$': 'identity-obj-proxy',
        // jsdom resolves these to their browser ESM builds, which Jest cannot load; use the CommonJS builds.
        '^yaml$': '<rootDir>/node_modules/yaml/dist/index.js',
        '^smol-toml$': '<rootDir>/node_modules/smol-toml/dist/index.cjs',
        ...pathsToModuleNameMapper(compilerOptions.paths, {
            prefix: '<rootDir>/',
        }),
    },
    setupFilesAfterEnv: [
        '<rootDir>/resources/scripts/setup-tests.ts',
    ],
    transform: {
        '.*\\.[t|j]sx$': 'babel-jest',
        '.*\\.ts$': 'ts-jest',
    },
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/services/'],
};
