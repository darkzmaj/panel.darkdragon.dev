import PageContentBlock, { PageContentBlockProps } from '@/components/elements/PageContentBlock';
import PageHeader from '@/components/elements/PageHeader';
import React from 'react';
import { ServerContext } from '@/state/server';

interface Props extends PageContentBlockProps {
    title: string;
    // The heading above the page. Defaults to the title; pass false when the page draws its own header.
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

const ServerContentBlock: React.FC<Props> = ({ title, heading, subtitle, children, ...props }) => {
    const name = ServerContext.useStoreState((state) => state.server.data!.name);
    const shown = heading === undefined ? title.replace('Startup Settings', 'Startup') : heading;

    return (
        <PageContentBlock title={`${name} | ${title}`} {...props}>
            {shown !== false && <PageHeader title={shown} subtitle={subtitle || SUBTITLES[title]} />}
            {children}
        </PageContentBlock>
    );
};

export default ServerContentBlock;
