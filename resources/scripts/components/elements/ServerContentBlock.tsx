import type { PageContentBlockProps } from '@/components/elements/PageContentBlock';
import PageContentBlock from '@/components/elements/PageContentBlock';
import PageHeading from '@/components/elements/PageHeading';
import { useCurrentServerName } from '@/api/server/queries';

interface Props extends PageContentBlockProps {
    /** Shown after the server name in the document title; omit to leave the title alone. */
    title?: string;
    /** The heading above the page. Defaults to the title; pass false when the page draws its own header. */
    heading?: string | false;
    subtitle?: string;
}

const SUBTITLES: Record<string, string> = {
    Backups: 'Create, download and restore snapshots of this instance.',
    Databases: 'Databases that belong to this instance.',
    Network: 'Ports and addresses assigned to this instance.',
    Schedules: 'Run commands and power actions automatically.',
    'Activity Log': 'Everything that happened on this instance.',
    Settings: 'Rename, reinstall and connect over SFTP.',
    'Startup Settings': 'Startup command, Docker image and variables.',
    'File Manager': 'Browse, upload and edit the files of this instance.',
};

const ServerContentBlock = ({ title, heading, subtitle, children, ...props }: Props) => {
    const name = useCurrentServerName()!;
    const shown = heading === undefined ? title?.replace('Startup Settings', 'Startup') : heading;

    return (
        <PageContentBlock title={title ? `${name} | ${title}` : undefined} {...props}>
            {shown && <PageHeading title={shown} description={subtitle ?? (title ? SUBTITLES[title] : undefined)} />}
            {children}
        </PageContentBlock>
    );
};

export default ServerContentBlock;
