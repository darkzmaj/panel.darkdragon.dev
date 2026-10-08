import { Link } from '@tanstack/react-router';
import { useAdminActivityLogs } from '@/api/admin/activity/queries';
import { httpErrorToHuman } from '@/api/http';
import ActivityLogEntry from '@/components/elements/activity/ActivityLogEntry';

const SHOWN = 8;

/** The newest admin activity, loaded on its own so the rest of the overview never waits for it. */
export default function RecentActivity() {
    const { data, error, isPending, refetch } = useAdminActivityLogs(
        { page: 1, sorts: { timestamp: -1 } },
        { refetchOnWindowFocus: false }
    );

    return (
        <section aria-label={'Recent Activity'}>
            <div className={'gb-section-title'} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Recent Activity</span>
                <Link
                    to={'/panel/activity'}
                    className={'text-primary hover:underline'}
                    style={{ textTransform: 'none', fontSize: 13 }}
                >
                    View all
                </Link>
            </div>
            {isPending && !error ? (
                <div role={'status'} aria-label={'Loading activity'}>
                    {Array.from({ length: 4 }, (_, index) => (
                        <div
                            key={index}
                            className={'gb-skeleton'}
                            style={{ height: 52, borderRadius: 10, marginBottom: 8 }}
                        />
                    ))}
                </div>
            ) : error ? (
                <p className={'gb-secondary'}>
                    {httpErrorToHuman(error)}{' '}
                    <button type={'button'} className={'text-primary hover:underline'} onClick={() => refetch()}>
                        Retry
                    </button>
                </p>
            ) : !data?.data.length ? (
                <p className={'gb-muted'}>Actions taken through the admin panel will appear here.</p>
            ) : (
                <div className={'bg-card'}>
                    {data.data.slice(0, SHOWN).map((activity) => (
                        <ActivityLogEntry key={activity.attributes.id} activity={activity} />
                    ))}
                </div>
            )}
        </section>
    );
}
