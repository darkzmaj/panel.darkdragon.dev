import {
    Button,
    PageContentBlock,
    Spinner,
    httpErrorToHuman,
    toast,
    usePanelNavigate,
    type ScreenComponentProps,
} from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fetchDetail, fetchOptions, keys, saveTemplate, type DetailResponse } from '../api';
import { Check, NumberField, SelectField, Section, TextField } from '../editor/fields';
import FilesTab from '../editor/FilesTab';
import { applyEgg, EMPTY_FORM, formFromDetail, payloadFromForm, type TemplateForm } from '../editor/form';
import InstancesTab from '../editor/InstancesTab';
import SftpTab from '../editor/SftpTab';

type Tab =
    | 'general'
    | 'software'
    | 'resources'
    | 'placement'
    | 'variables'
    | 'lifecycle'
    | 'files'
    | 'sftp'
    | 'instances';
const FORM_TABS: readonly Tab[] = ['general', 'software', 'resources', 'placement', 'variables', 'lifecycle'];

export default function TemplateEditorScreen({ data }: ScreenComponentProps) {
    const idParam = data.params.template ?? 'new';
    const id = idParam === 'new' ? null : Number(idParam);
    const queryClient = useQueryClient();
    const navigate = usePanelNavigate();
    const [tab, setTab] = useState<Tab>('general');
    const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
    const [loadedFor, setLoadedFor] = useState<string | null>(null);

    const options = useQuery({ queryKey: keys.options, queryFn: fetchOptions, staleTime: 60_000 });
    const detail = useQuery({
        queryKey: keys.detail(id ?? 0),
        queryFn: () => fetchDetail(id ?? 0),
        enabled: id !== null,
    });

    useEffect(() => {
        if (detail.data && loadedFor !== idParam) {
            setForm(formFromDetail(detail.data.template));
            setLoadedFor(idParam);
        }
    }, [detail.data, idParam, loadedFor]);

    const save = useMutation({
        mutationFn: () => saveTemplate(id, payloadFromForm(form)),
        onSuccess: async (result: DetailResponse) => {
            await queryClient.invalidateQueries({ queryKey: ['gobia-templates'] });
            toast.success(
                id === null
                    ? 'Template created. You can add files now.'
                    : result.created_revision
                      ? `Saved as revision ${result.template.revision}. Existing servers are not changed.`
                      : 'Nothing changed, so no new revision was created.'
            );
            if (id === null)
                void navigate({
                    extension: 'gobia-templates',
                    screen: 'editor',
                    params: { template: String(result.template.id) },
                });
            else setForm(formFromDetail(result.template));
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    const egg = useMemo(
        () => options.data?.eggs.find((item) => item.id === form.egg_id) ?? null,
        [options.data, form.egg_id]
    );
    const set = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) =>
        setForm((current) => ({ ...current, [key]: value }));

    if (options.isPending || (id !== null && detail.isPending)) return <Spinner centered size={'large'} />;
    if (options.isError || (id !== null && detail.isError))
        return <p className={'gt:text-destructive'}>The template could not be loaded.</p>;
    const catalog = options.data;
    const tabs: { id: Tab; label: string; disabled: boolean }[] = [
        { id: 'general', label: 'General', disabled: false },
        { id: 'software', label: 'Software', disabled: false },
        { id: 'resources', label: 'Resources', disabled: false },
        { id: 'placement', label: 'Placement', disabled: false },
        { id: 'variables', label: 'Variables', disabled: false },
        { id: 'lifecycle', label: 'Lifecycle', disabled: false },
        { id: 'files', label: 'Files', disabled: id === null },
        { id: 'sftp', label: 'SFTP', disabled: id === null },
        { id: 'instances', label: 'Instances', disabled: id === null },
    ];
    const inForm = FORM_TABS.includes(tab);

    return (
        <PageContentBlock title={id === null ? 'New template' : form.name || 'Template'}>
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>{id === null ? 'New Template' : form.name || 'Template'}</h1>
                    <p>Define a blueprint for new servers.</p>
                </div>
            </div>
            <div role={'tablist'} aria-label={'Template sections'} className={'gb-tabbar'}>
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        type={'button'}
                        role={'tab'}
                        aria-selected={tab === item.id}
                        disabled={item.disabled}
                        onClick={() => setTab(item.id)}
                        className={'gb-tabbar-item' + (tab === item.id ? ' active' : '')}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <form
                hidden={!inForm}
                onSubmit={(event) => {
                    event.preventDefault();
                    save.mutate();
                }}
                className={'gt:flex gt:flex-col gt:gap-5'}
            >
                <Section title={'General'} active={tab === 'general'}>
                    <TextField
                        label={'Name'}
                        value={form.name}
                        onChange={(value) => set('name', value)}
                        hint={'Use %number% to number instances automatically, for example "Hub %number%".'}
                    />
                    <TextField
                        label={'Description'}
                        value={form.description}
                        onChange={(value) => set('description', value)}
                        multiline
                    />
                    <div className={'gt:flex gt:flex-wrap gt:gap-6'}>
                        <Check
                            label={'Enabled'}
                            hint={'Disabled templates cannot be used to create instances.'}
                            checked={form.enabled}
                            onChange={(value) => set('enabled', value)}
                        />
                        <Check
                            label={'Available to the API'}
                            hint={'Automation with an application key may only use templates you open to it.'}
                            checked={form.api_enabled}
                            onChange={(value) => set('api_enabled', value)}
                        />
                    </div>
                </Section>

                <Section title={'Software'} active={tab === 'software'}>
                    <SelectField
                        label={'Egg'}
                        value={form.egg_id}
                        empty={'Choose software'}
                        options={catalog.eggs.map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value) => setForm((current) => applyEgg(current, value, catalog))}
                    />
                    {egg && (
                        <>
                            <SelectField
                                label={'Docker image'}
                                value={form.docker_image}
                                options={egg.images.map((image) => ({ value: image, label: image }))}
                                onChange={(value) => set('docker_image', value)}
                            />
                            <TextField
                                label={'Startup command'}
                                value={form.startup}
                                placeholder={egg.startup ?? ''}
                                onChange={(value) => set('startup', value)}
                                hint={'Leave empty to use the egg startup command.'}
                                multiline
                            />
                        </>
                    )}
                </Section>

                <Section title={'Resources'} active={tab === 'resources'}>
                    <div className={'gt:grid gt:gap-4 gt:sm:grid-cols-3'}>
                        <NumberField
                            label={'Memory (MiB)'}
                            value={form.memory}
                            onChange={(value) => set('memory', value)}
                        />
                        <NumberField
                            label={'Swap (MiB)'}
                            hint={'-1 for unlimited'}
                            value={form.swap}
                            onChange={(value) => set('swap', value)}
                        />
                        <NumberField label={'Disk (MiB)'} value={form.disk} onChange={(value) => set('disk', value)} />
                        <NumberField
                            label={'CPU (%)'}
                            hint={'0 for unlimited'}
                            value={form.cpu}
                            onChange={(value) => set('cpu', value)}
                        />
                        <NumberField
                            label={'Block IO'}
                            hint={'10 to 1000'}
                            value={form.io}
                            onChange={(value) => set('io', value)}
                        />
                        <NumberField
                            label={'Databases'}
                            value={form.database_limit}
                            onChange={(value) => set('database_limit', value)}
                        />
                        <NumberField
                            label={'Backups'}
                            value={form.backup_limit}
                            onChange={(value) => set('backup_limit', value)}
                        />
                        <NumberField
                            label={'Allocations'}
                            value={form.allocation_limit}
                            onChange={(value) => set('allocation_limit', value)}
                        />
                    </div>
                    <Check
                        label={'Disable the out of memory killer'}
                        checked={form.oom_disabled}
                        onChange={(value) => set('oom_disabled', value)}
                    />
                </Section>

                <Section title={'Placement'} active={tab === 'placement'}>
                    <SelectField
                        label={'Where instances run'}
                        value={form.placement_mode}
                        options={[
                            { value: 'any', label: 'Any compatible node' },
                            { value: 'fixed_node', label: 'One fixed node' },
                            { value: 'allowed_nodes', label: 'Selected nodes' },
                        ]}
                        onChange={(value) => set('placement_mode', value)}
                    />
                    {form.placement_mode === 'fixed_node' && (
                        <SelectField
                            label={'Node'}
                            value={form.node_id}
                            empty={'Choose a node'}
                            options={catalog.nodes.map((node) => ({ value: node.id, label: node.name }))}
                            onChange={(value) => set('node_id', value)}
                        />
                    )}
                    {form.placement_mode === 'allowed_nodes' && (
                        <fieldset className={'gt:flex gt:flex-col gt:gap-1'}>
                            <legend className={'gt:mb-1 gt:text-sm gt:font-medium'}>Allowed nodes</legend>
                            {catalog.nodes.map((node) => (
                                <Check
                                    key={node.id}
                                    label={node.name}
                                    checked={form.allowed_nodes.includes(node.id)}
                                    onChange={(checked) =>
                                        set(
                                            'allowed_nodes',
                                            checked
                                                ? [...form.allowed_nodes, node.id]
                                                : form.allowed_nodes.filter((item) => item !== node.id)
                                        )
                                    }
                                />
                            ))}
                        </fieldset>
                    )}
                    <SelectField
                        label={'Location'}
                        hint={'Limits any compatible node placement to one location.'}
                        value={form.location_id}
                        empty={'Any location'}
                        options={catalog.locations.map((location) => ({
                            value: location.id,
                            label: location.short,
                        }))}
                        onChange={(value) => set('location_id', value)}
                    />
                    <div className={'gt:grid gt:gap-4 gt:sm:grid-cols-3'}>
                        <TextField
                            label={'Preferred ports'}
                            hint={'For example 25565,25570-25580'}
                            value={form.preferred_ports}
                            onChange={(value) => set('preferred_ports', value)}
                        />
                        <NumberField
                            label={'Extra allocations'}
                            value={form.additional_allocations}
                            onChange={(value) => set('additional_allocations', value)}
                        />
                        <NumberField
                            label={'Maximum instances'}
                            hint={'Empty for no limit'}
                            value={form.max_instances}
                            onChange={(value) => set('max_instances', value)}
                        />
                    </div>
                </Section>

                {egg && egg.variables.length > 0 && (
                    <Section title={'Variables'} active={tab === 'variables'}>
                        <p className={'gt:text-xs gt:text-muted-foreground'}>
                            Values are fixed by the template unless you allow an instance request to override them.
                        </p>
                        {egg.variables.map((variable) => {
                            const current = form.variables[variable.env] ?? { value: null, overridable: false };
                            return (
                                <div key={variable.env} className={'gt:grid gt:gap-3 gt:sm:grid-cols-[1fr_auto]'}>
                                    <TextField
                                        label={`${variable.name} (${variable.env})`}
                                        value={current.value ?? ''}
                                        placeholder={variable.default ?? ''}
                                        onChange={(value) =>
                                            set('variables', {
                                                ...form.variables,
                                                [variable.env]: { ...current, value: value === '' ? null : value },
                                            })
                                        }
                                    />
                                    <div className={'gt:self-end gt:pb-2'}>
                                        <Check
                                            label={'Overridable'}
                                            checked={current.overridable}
                                            onChange={(checked) =>
                                                set('variables', {
                                                    ...form.variables,
                                                    [variable.env]: { ...current, overridable: checked },
                                                })
                                            }
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </Section>
                )}

                <Section title={'Lifecycle'} active={tab === 'lifecycle'}>
                    <Check
                        label={'Start automatically'}
                        hint={'The server starts once its files are deployed.'}
                        checked={form.start_automatically}
                        onChange={(value) => set('start_automatically', value)}
                    />
                    <Check
                        label={'Temporary'}
                        hint={'Instances are deleted after the time to live.'}
                        checked={form.temporary}
                        onChange={(value) => set('temporary', value)}
                    />
                    {form.temporary && (
                        <NumberField
                            label={'Time to live (minutes)'}
                            value={form.ttl_minutes}
                            onChange={(value) => set('ttl_minutes', value)}
                        />
                    )}
                    <Check
                        label={'Allow deleting instances through the API'}
                        checked={form.allow_instance_delete}
                        onChange={(value) => set('allow_instance_delete', value)}
                    />
                </Section>

                <div className={'gt:flex gt:gap-3'}>
                    <Button
                        type={'submit'}
                        color={'primary'}
                        isLoading={save.isPending}
                        disabled={!form.name.trim() || form.egg_id === null}
                    >
                        {id === null ? 'Create template' : 'Save changes'}
                    </Button>
                    {id !== null && detail.data && (
                        <span className={'gt:self-center gt:text-sm gt:text-muted-foreground'}>
                            Revision {detail.data.template.revision}
                        </span>
                    )}
                </div>
            </form>
            {tab === 'files' && id !== null && <FilesTab id={id} />}
            {tab === 'sftp' && id !== null && <SftpTab id={id} />}
            {tab === 'instances' && id !== null && detail.data && <InstancesTab id={id} detail={detail.data} />}
        </PageContentBlock>
    );
}
