import { ContentBox, PageContentBlock, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyScheme, SCHEMES, storeScheme, type Scheme } from '../appearance';
import { fetchProfile, profileQueryKey, saveAppearance } from '../api';

const LABELS = {
    system: { title: 'System', description: 'Follow your device setting.' },
    light: { title: 'Light', description: 'Always use the light palette.' },
    dark: { title: 'Dark', description: 'Always use the dark palette.' },
} satisfies Record<Scheme, { title: string; description: string }>;

export default function AppearanceScreen() {
    const queryClient = useQueryClient();
    const { data } = useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile, staleTime: Infinity });
    const selected = data?.theme ?? 'system';
    const mutation = useMutation({
        mutationFn: saveAppearance,
        onSuccess: (profile) => {
            queryClient.setQueryData(profileQueryKey, profile);
            storeScheme(profile.theme);
            applyScheme(profile.theme);
        },
        onError: () => toast.error('Could not save your appearance.'),
    });

    return (
        <PageContentBlock title={'Appearance'}>
            <ContentBox title={'Colour scheme'}>
                <div role={'radiogroup'} aria-label={'Colour scheme'} className={'gb:grid gb:gap-3 gb:sm:grid-cols-3'}>
                    {SCHEMES.map((scheme) => (
                        <button
                            key={scheme}
                            type={'button'}
                            role={'radio'}
                            aria-checked={selected === scheme}
                            disabled={mutation.isPending}
                            onClick={() => mutation.mutate(scheme)}
                            className={
                                'gb:flex gb:flex-col gb:items-start gb:gap-1 gb:rounded-lg gb:border gb:border-border gb:bg-background gb:p-4 gb:text-left gb:transition-colors ' +
                                'gb:hover:bg-secondary gb:focus-visible:outline-2 gb:focus-visible:outline-ring gb:aria-checked:border-primary gb:aria-checked:bg-secondary gb:disabled:opacity-60'
                            }
                        >
                            <span className={'gb:text-sm gb:font-semibold gb:text-foreground'}>
                                {LABELS[scheme].title}
                            </span>
                            <span className={'gb:text-xs gb:text-muted-foreground'}>{LABELS[scheme].description}</span>
                        </button>
                    ))}
                </div>
            </ContentBox>
        </PageContentBlock>
    );
}
