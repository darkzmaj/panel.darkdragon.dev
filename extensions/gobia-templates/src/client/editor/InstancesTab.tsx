import { Button, httpErrorToHuman, http, toast } from '@pterodactyl/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keys, type DetailResponse } from '../api';

const ADMIN = '/api/admin/extensions/gobia-templates';

export default function InstancesTab({ id, detail }: { id: number; detail: DetailResponse }) {
    const queryClient = useQueryClient();
    const retry = useMutation({
        mutationFn: (instance: string) => http.post(`${ADMIN}/templates/${id}/instances/${instance}/retry`),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: keys.detail(id) });
            toast.success('The instance was queued again.');
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    return (
        <div className={'gt:grid gt:gap-6 gt:lg:grid-cols-[2fr_1fr]'}>
            <section aria-label={'Instances'}>
                <h2 className={'gt:mb-2 gt:text-sm gt:font-semibold gt:uppercase gt:text-muted-foreground'}>
                    Latest instances
                </h2>
                <ul className={'gt:flex gt:flex-col gt:gap-2'}>
                    {detail.instances.map((instance) => (
                        <li
                            key={instance.id}
                            className={
                                'gt:flex gt:flex-wrap gt:items-center gt:justify-between gt:gap-3 gt:rounded-lg gt:border gt:border-border gt:p-3 gt:text-sm'
                            }
                        >
                            <div>
                                <p className={'gt:font-medium'}>{instance.name}</p>
                                <p className={'gt:text-xs gt:text-muted-foreground'}>
                                    {instance.state.replace('_', ' ')}
                                    {instance.failed_stage && ` at ${instance.failed_stage.replace('_', ' ')}`}
                                    {instance.error && `: ${instance.error}`}
                                </p>
                            </div>
                            {instance.state === 'failed' && (
                                <Button
                                    type={'button'}
                                    isLoading={retry.isPending && retry.variables === instance.id}
                                    onClick={() => retry.mutate(instance.id)}
                                >
                                    Retry
                                </Button>
                            )}
                        </li>
                    ))}
                    {detail.instances.length === 0 && (
                        <li className={'gt:text-sm gt:text-muted-foreground'}>
                            No instances yet. Create one from the dashboard with Create instance.
                        </li>
                    )}
                </ul>
            </section>
            <section aria-label={'Revisions'}>
                <h2 className={'gt:mb-2 gt:text-sm gt:font-semibold gt:uppercase gt:text-muted-foreground'}>
                    Revisions
                </h2>
                <ul className={'gt:flex gt:flex-col gt:gap-1 gt:text-sm'}>
                    {detail.revisions.map((revision) => (
                        <li key={revision.revision} className={'gt:flex gt:justify-between'}>
                            <span>Revision {revision.revision}</span>
                            <span className={'gt:text-xs gt:text-muted-foreground'}>
                                {revision.created_at?.slice(0, 16).replace('T', ' ')}
                            </span>
                        </li>
                    ))}
                </ul>
                <p className={'gt:mt-3 gt:text-xs gt:text-muted-foreground'}>
                    Published revisions never change. Servers keep the revision they were created from.
                </p>
            </section>
        </div>
    );
}
