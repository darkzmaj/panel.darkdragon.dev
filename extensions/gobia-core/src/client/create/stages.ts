export const STAGES = [
    { id: 'queued', label: 'Queued' },
    { id: 'allocating', label: 'Choosing a node' },
    { id: 'creating', label: 'Creating the server' },
    { id: 'installing', label: 'Installing' },
    { id: 'deploying_files', label: 'Deploying files' },
    { id: 'starting', label: 'Starting' },
    { id: 'ready', label: 'Ready' },
] as const;

export type StageId = (typeof STAGES)[number]['id'];

export type StageStatus = 'done' | 'active' | 'pending' | 'failed';

/** Where each stage stands for an instance in `state`, given the stage a failure happened in. */
export function stageStatuses(
    state: string,
    failedStage: string | null
): { id: StageId; label: string; status: StageStatus }[] {
    const failed = state === 'failed';
    const at = failed
        ? STAGES.findIndex((stage) => stage.id === failedStage)
        : STAGES.findIndex((stage) => stage.id === state);
    return STAGES.map((stage, index) => {
        let status: StageStatus = 'pending';
        if (at === -1) status = failed ? 'pending' : 'pending';
        else if (index < at) status = 'done';
        else if (index === at) status = failed ? 'failed' : state === 'ready' ? 'done' : 'active';
        return { id: stage.id, label: stage.label, status };
    });
}

/** Rough share of the work done, for a progress bar; every stage counts the same. */
export function progressPercent(state: string): number {
    const index = STAGES.findIndex((stage) => stage.id === state);
    if (index === -1) return 0;
    return Math.round((index / (STAGES.length - 1)) * 100);
}
