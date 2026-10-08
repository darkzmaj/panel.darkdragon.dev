import { lazy, Suspense } from 'react';
import AdminContentBlock from '@/components/admin/AdminContentBlock';
import Slot from '@/extensions/Slot';

const RecentActivity = lazy(() => import('@/components/admin/overview/RecentActivity'));

/** The administration landing page. Statistics come from the gobia-core overview panel through the slot below. */
export default function OverviewContainer() {
    return (
        <AdminContentBlock title={'Admin Overview'} heading={'Overview'} description={'Infrastructure at a glance.'}>
            <Slot name={'panel.overview.before'} />
            <Suspense fallback={null}>
                <RecentActivity />
            </Suspense>
            <Slot name={'panel.overview.after'} />
        </AdminContentBlock>
    );
}
