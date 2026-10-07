import {
    Button,
    Dialog,
    PageContentBlock,
    PanelLink,
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
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>Templates</h1>
                    <p>
                        A template is a ready to deploy instance: software, resources, placement, variables and files.
                        Servers keep the revision they were created from.
                    </p>
                </div>
                <div className={'gb-page-actions'}>
                    <PanelLink
                        destination={{ extension: 'gobia-templates', screen: 'editor', params: { template: 'new' } }}
                        className={'gb-btn gb-btn-primary'}
                    >
                        New template
                    </PanelLink>
                </div>
            </div>
            {isPending ? (
                <div className={'gb-list'}>
                    {[0, 1, 2].map((row) => (
                        <div key={row} className={'gb-skeleton'} style={{ height: 56, borderRadius: 0 }} />
                    ))}
                </div>
            ) : isError ? (
                <div className={'gb-list'} role={'alert'} style={{ padding: '40px 16px', textAlign: 'center' }}>
                    <p className={'gb-secondary'} style={{ marginBottom: 12 }}>
                        Templates could not be loaded.
                    </p>
                    <Button type={'button'} onClick={() => refetch()}>
                        Retry
                    </Button>
                </div>
            ) : data.length === 0 ? (
                <div className={'gb-list'} style={{ padding: '40px 16px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--gb-text-strong)', fontWeight: 600 }}>No templates yet</p>
                    <p className={'gb-secondary'}>Create one to start deploying instances in seconds.</p>
                </div>
            ) : (
                <div className={'gb-list'} style={{ overflowX: 'auto' }}>
                    <table className={'gb-table'}>
                        <caption className={'sr-only'}>Templates</caption>
                        <thead>
                            <tr>
                                {['Name', 'Software', 'Resources', 'Placement', 'Revision', 'Instances', ''].map(
                                    (heading, index) => (
                                        <th key={index} scope={'col'}>
                                            {heading}
                                        </th>
                                    )
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((template) => (
                                <tr key={template.id}>
                                    <th scope={'row'}>
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
                                            <span className={'gb-badge gb-badge-warning'} style={{ marginLeft: 8 }}>
                                                Disabled
                                            </span>
                                        )}
                                        {template.api_enabled && (
                                            <span className={'gb-badge'} style={{ marginLeft: 8 }}>
                                                API
                                            </span>
                                        )}
                                    </th>
                                    <td>{template.egg?.name ?? '-'}</td>
                                    <td style={{ whiteSpace: 'nowrap' }}>
                                        {template.memory} MiB · {template.disk} MiB ·{' '}
                                        {template.cpu === 0 ? 'unlimited CPU' : `${template.cpu}% CPU`}
                                    </td>
                                    <td>{PLACEMENT[template.placement_mode]}</td>
                                    <td>{template.revision}</td>
                                    <td>{template.instances}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
