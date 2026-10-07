import { ContentBox, PageContentBlock, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { applyScheme, SCHEMES, storeScheme, type Scheme } from '../appearance';
import { fetchProfile, profileQueryKey, saveAppearance } from '../api';

const OPTIONS = {
    system: { label: 'System', text: 'Match your device. Switches automatically at night.', icon: Monitor },
    dark: { label: 'Dark', text: 'Easy on the eyes in low light.', icon: Moon },
    light: { label: 'Light', text: 'Bright and crisp for well-lit rooms.', icon: Sun },
} satisfies Record<Scheme, { label: string; text: string; icon: LucideIcon }>;

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
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>Appearance</h1>
                    <p>Choose how the Panel looks. Your choice follows you to every device.</p>
                </div>
            </div>
            <ContentBox title={'Theme'} description={'System follows your operating system setting.'}>
                <div
                    role={'radiogroup'}
                    aria-label={'Theme'}
                    style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}
                >
                    {SCHEMES.map((scheme) => {
                        const { label, text, icon: Icon } = OPTIONS[scheme];

                        return (
                            <button
                                key={scheme}
                                type={'button'}
                                role={'radio'}
                                aria-checked={selected === scheme}
                                disabled={mutation.isPending}
                                className={'gb-option' + (selected === scheme ? ' selected' : '')}
                                style={{ alignItems: 'flex-start', marginTop: 0 }}
                                onClick={() => mutation.mutate(scheme)}
                            >
                                <span className={'gb-file-icon'}>
                                    <Icon aria-hidden />
                                </span>
                                <span>
                                    <strong>{label}</strong>
                                    <span>{text}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </ContentBox>
        </PageContentBlock>
    );
}
