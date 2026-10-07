import AdminContentBlock from '@/components/admin/AdminContentBlock';
import Slot from '@/extensions/Slot';

/** The administration landing page. Statistics come from the gobia-core overview panel through the slot below. */
export default function OverviewContainer() {
    return (
        <AdminContentBlock title={'Admin Overview'} heading={'Overview'} description={'Infrastructure at a glance.'}>
            <Slot name={'panel.overview.before'} />
            <Slot name={'panel.overview.after'} />
        </AdminContentBlock>
    );
}
