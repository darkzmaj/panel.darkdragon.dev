import { useQuery } from '@tanstack/react-query';
import { fetchRevisions, keys } from '../api';
import { formatBytes } from './format';

const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown date';

/** Every published revision: who made it, what it contains, what changed and which servers were created from it. */
export default function RevisionsTab({ id }: { id: number }) {
    const revisions = useQuery({ queryKey: keys.revisions(id), queryFn: () => fetchRevisions(id) });

    if (revisions.isPending) {
        return (
            <div className={'gb-list'} role={'progressbar'} aria-label={'Loading revisions'}>
                {[0, 1, 2].map((row) => (
                    <div key={row} className={'gb-skeleton'} style={{ height: 78, borderRadius: 0 }} />
                ))}
            </div>
        );
    }
    if (revisions.isError) return <p role={'alert'}>The revisions could not be loaded.</p>;

    return (
        <section aria-label={'Revisions'}>
            <p className={'gb-secondary'} style={{ marginBottom: 12, fontSize: 13 }}>
                Published revisions never change. A server keeps the revision it was created from, whatever you edit
                afterwards.
            </p>
            <ul className={'gb-list'} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {revisions.data.map((revision, index) => (
                    <li
                        key={revision.revision}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                            gap: '6px 16px',
                            padding: '14px 18px',
                            borderTop: index === 0 ? 0 : '1px solid var(--gb-border-muted)',
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <strong style={{ color: 'var(--gb-text-strong)' }}>Revision {revision.revision}</strong>
                                {revision.current && <span className={'gb-badge gb-badge-success'}>Current</span>}
                            </div>
                            <p className={'gb-secondary'} style={{ margin: '2px 0 6px', fontSize: 12 }}>
                                {formatDate(revision.created_at)}
                                {' · '}
                                {revision.created_by
                                    ? (revision.created_by.username ?? `User ${revision.created_by.id}`)
                                    : 'System or imported'}
                            </p>
                            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                                {revision.changes.map((change) => (
                                    <li key={change}>{change}</li>
                                ))}
                            </ul>
                        </div>
                        <dl
                            style={{
                                margin: 0,
                                display: 'grid',
                                gridTemplateColumns: 'auto auto',
                                gap: '2px 14px',
                                alignContent: 'start',
                                fontSize: 12,
                                textAlign: 'right',
                            }}
                        >
                            <dt className={'gb-muted'}>Servers</dt>
                            <dd style={{ margin: 0 }}>{revision.instances}</dd>
                            <dt className={'gb-muted'}>Files</dt>
                            <dd style={{ margin: 0 }}>
                                {revision.summary.files} · {formatBytes(revision.summary.bytes)}
                            </dd>
                            <dt className={'gb-muted'}>Memory</dt>
                            <dd style={{ margin: 0 }}>{revision.summary.memory ?? '-'} MiB</dd>
                            <dt className={'gb-muted'}>Variables</dt>
                            <dd style={{ margin: 0 }}>{revision.summary.variables}</dd>
                        </dl>
                    </li>
                ))}
            </ul>
        </section>
    );
}
