import {
    Button,
    ContentBox,
    Dialog,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
    PageContentBlock,
    PanelLink,
    Spinner,
    httpErrorToHuman,
    toast,
    usePanelNavigate,
} from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { deleteTemplate, duplicateTemplate, fetchList, keys, toggleTemplate, type TemplateSummary } from '../api';

const PLACEMENT = { any: 'Any compatible node', fixed_node: 'Fixed node', allowed_nodes: 'Selected nodes' } as const;

export default function TemplatesScreen() {
    const queryClient = useQueryClient();
    const navigate = usePanelNavigate();
    const { data, isPending, isError, refetch } = useQuery({ queryKey: keys.list, queryFn: fetchList });
    const [removing, setRemoving] = useState<TemplateSummary | null>(null);
    const done = () => queryClient.invalidateQueries({ queryKey: keys.list });
    const fail = (error: Error) => toast.error(httpErrorToHuman(error));

    const toggle = useMutation({ mutationFn: (id: number) => toggleTemplate(id), onSuccess: done, onError: fail });
    const copy = useMutation({
        mutationFn: (id: number) => duplicateTemplate(id),
        onSuccess: (result) => {
            toast.success('Template duplicated. The copy is disabled until you enable it.');
            void navigate({
                extension: 'gobia-templates',
                screen: 'editor',
                params: { template: String(result.template.id) },
            });
        },
        onError: fail,
    });
    const remove = useMutation({
        mutationFn: (id: number) => deleteTemplate(id),
        onSuccess: async () => {
            setRemoving(null);
            await done();
            toast.success('Template deleted.');
        },
        onError: fail,
    });

    return (
        <PageContentBlock title={'Templates'}>
            <ContentBox title={'Server templates'}>
                <div className={'gt:mb-4 gt:flex gt:items-center gt:justify-between gt:gap-3'}>
                    <p className={'gt:text-sm gt:text-muted-foreground'}>
                        A template is a ready to deploy instance: software, resources, placement, variables and files.
                        Servers keep the revision they were created from.
                    </p>
                    <PanelLink
                        destination={{ extension: 'gobia-templates', screen: 'editor', params: { template: 'new' } }}
                        className={
                            'gt:rounded-md gt:bg-primary gt:px-3 gt:py-2 gt:text-sm gt:font-medium gt:text-primary-foreground gt:no-underline'
                        }
                    >
                        New template
                    </PanelLink>
                </div>
                {isPending ? (
                    <Spinner centered />
                ) : isError ? (
                    <Button type={'button'} onClick={() => refetch()}>
                        Retry
                    </Button>
                ) : data.length === 0 ? (
                    <Empty>
                        <EmptyHeader>
                            <EmptyTitle>No templates yet</EmptyTitle>
                            <EmptyDescription>Create one to start deploying instances in seconds.</EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <div className={'gt:overflow-x-auto'}>
                        <table className={'gt:w-full gt:text-left gt:text-sm'}>
                            <caption className={'gt:sr-only'}>Templates</caption>
                            <thead className={'gt:text-xs gt:uppercase gt:text-muted-foreground'}>
                                <tr>
                                    {['Name', 'Software', 'Resources', 'Placement', 'Revision', 'Instances', ''].map(
                                        (heading, index) => (
                                            <th key={index} scope={'col'} className={'gt:py-2 gt:pr-3 gt:font-medium'}>
                                                {heading}
                                            </th>
                                        )
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {data.map((template) => (
                                    <tr key={template.id} className={'gt:border-t gt:border-border'}>
                                        <th scope={'row'} className={'gt:py-2 gt:pr-3 gt:font-medium'}>
                                            <PanelLink
                                                destination={{
                                                    extension: 'gobia-templates',
                                                    screen: 'editor',
                                                    params: { template: String(template.id) },
                                                }}
                                            >
                                                {template.name}
                                            </PanelLink>
                                            {!template.enabled && (
                                                <span className={'gt:ml-2 gt:text-xs gt:font-normal gt:text-warning'}>
                                                    Disabled
                                                </span>
                                            )}
                                            {template.api_enabled && (
                                                <span
                                                    className={
                                                        'gt:ml-2 gt:text-xs gt:font-normal gt:text-muted-foreground'
                                                    }
                                                >
                                                    API
                                                </span>
                                            )}
                                        </th>
                                        <td className={'gt:py-2 gt:pr-3'}>{template.egg?.name ?? '-'}</td>
                                        <td className={'gt:py-2 gt:pr-3 gt:tabular-nums'}>
                                            {template.memory} MiB · {template.disk} MiB ·{' '}
                                            {template.cpu === 0 ? 'unlimited CPU' : `${template.cpu}% CPU`}
                                        </td>
                                        <td className={'gt:py-2 gt:pr-3'}>{PLACEMENT[template.placement_mode]}</td>
                                        <td className={'gt:py-2 gt:pr-3 gt:tabular-nums'}>{template.revision}</td>
                                        <td className={'gt:py-2 gt:pr-3 gt:tabular-nums'}>{template.instances}</td>
                                        <td className={'gt:py-2 gt:text-right'}>
                                            <div className={'gt:flex gt:justify-end gt:gap-2'}>
                                                <Button.Text type={'button'} onClick={() => toggle.mutate(template.id)}>
                                                    {template.enabled ? 'Disable' : 'Enable'}
                                                </Button.Text>
                                                <Button.Text type={'button'} onClick={() => copy.mutate(template.id)}>
                                                    Duplicate
                                                </Button.Text>
                                                <Button.Danger type={'button'} onClick={() => setRemoving(template)}>
                                                    Delete
                                                </Button.Danger>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </ContentBox>
            {removing && (
                <Dialog.Confirm
                    open
                    onClose={() => setRemoving(null)}
                    title={`Delete ${removing.name}?`}
                    confirm={'Delete template'}
                    pending={remove.isPending}
                    onConfirmed={() => remove.mutate(removing.id)}
                >
                    Templates that created servers cannot be deleted; disable them instead. Their files are removed.
                </Dialog.Confirm>
            )}
        </PageContentBlock>
    );
}
