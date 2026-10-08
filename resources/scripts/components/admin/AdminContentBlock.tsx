import { useLocation } from '@tanstack/react-router';
import AdminTabs, { tabGroupFor } from '@/components/admin/AdminTabs';
import type { PageContentBlockProps } from '@/components/elements/PageContentBlock';
import PageContentBlock from '@/components/elements/PageContentBlock';
import PageHeading from '@/components/elements/PageHeading';

interface Props extends PageContentBlockProps {
    heading: string;
    description?: string;
}

const AdminContentBlock = ({ heading, description, children, ...props }: Props) => {
    const path = useLocation({ select: (location) => location.pathname });
    const group = tabGroupFor(path);

    return (
        <PageContentBlock {...props}>
            <PageHeading title={group?.heading ?? heading} description={description} />
            <AdminTabs />
            {children}
        </PageContentBlock>
    );
};

export default AdminContentBlock;
