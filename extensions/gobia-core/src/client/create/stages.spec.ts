import { describe, expect, it } from 'vitest';
import { progressPercent, stageStatuses } from './stages';

describe('stages', () => {
    it('marks earlier stages done and the current one active', () => {
        const stages = stageStatuses('installing', null);
        expect(stages.map((stage) => stage.status)).toEqual([
            'done',
            'done',
            'done',
            'active',
            'pending',
            'pending',
            'pending',
        ]);
    });

    it('marks everything done when ready', () => {
        expect(stageStatuses('ready', null).every((stage) => stage.status === 'done')).toBe(true);
    });

    it('marks the stage a failure happened in', () => {
        const stages = stageStatuses('failed', 'allocating');
        expect(stages.map((stage) => stage.status)).toEqual([
            'done',
            'failed',
            'pending',
            'pending',
            'pending',
            'pending',
            'pending',
        ]);
    });

    it('handles unknown states without crashing', () => {
        expect(stageStatuses('mystery', null).every((stage) => stage.status === 'pending')).toBe(true);
        expect(stageStatuses('failed', null).every((stage) => stage.status === 'pending')).toBe(true);
    });

    it('computes progress', () => {
        expect(progressPercent('queued')).toBe(0);
        expect(progressPercent('ready')).toBe(100);
        expect(progressPercent('installing')).toBe(50);
        expect(progressPercent('mystery')).toBe(0);
    });
});
