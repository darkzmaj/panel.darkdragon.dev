export interface Compatibility {
    gobia_version: string;
    pterodactyl_base: { version: string; commit: string | null };
    php: string;
    database: { driver: string; version: string | null };
    extensions: {
        id: string;
        name: string;
        version: string;
        enabled: boolean;
        compatible: boolean;
        reason: string | null;
    }[];
    migrations: { pending: number; ran: number };
    health: { database: boolean; cache: boolean; queue: string };
    release: { min_upgrade_from: string | null; security_update: boolean };
}

export interface UpdateCheck {
    contract_version: number;
    current: { gobia: string; pterodactyl_base: string };
    latest_approved: {
        gobia: string;
        pterodactyl_base: string;
        published_at: string;
        security: boolean;
        release_notes_markdown: string;
    } | null;
    update_available: boolean;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface Preflight {
    ready: boolean;
    checks: { id: string; required: boolean; status: CheckStatus; message: string }[];
    extensions: { id: string; current: string; required: string; compatible: boolean; reason: string | null }[];
    migrations: { pending: number; destructive: boolean; rollback: 'file-only' | 'requires-db-restore' };
}

export type UpdateState =
    | 'queued'
    | 'preflight'
    | 'backup'
    | 'staging'
    | 'migrating'
    | 'switching'
    | 'health_check'
    | 'completed'
    | 'failed'
    | 'rolling_back'
    | 'rolled_back';

export interface UpdateProgress {
    update_id: string;
    state: UpdateState;
    percent: number;
    step: string;
    log: { at: string; level: string; message: string }[];
    failure: string | null;
    rollback: { performed: boolean; database_restored: boolean };
}

export interface HistoryEntry {
    update_id: string;
    from: string;
    to: string;
    started_at: string;
    finished_at: string | null;
    result: 'completed' | 'failed' | 'rolled_back';
    database_restored: boolean;
}

export interface RollbackEligibility {
    eligible: boolean;
    mode: 'file-only' | 'requires-db-restore';
    reason: string | null;
}
