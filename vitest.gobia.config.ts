import { defineConfig } from 'vitest/config';

// Gobia extension tests, kept out of the upstream vitest.config.ts so core files stay untouched.
// Run with: npm run gobia:test   (node scripts/gobia/run.mjs test)
export default defineConfig({
    test: {
        projects: ['extensions/gobia-*/vitest.config.ts'],
    },
});
