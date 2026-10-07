import { Button, ContentBox, Input, Label, PageContentBlock, httpErrorToHuman, toast } from '@pterodactyl/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import AvatarCropper from '../AvatarCropper';
import { changeUsername, fetchProfile, profileQueryKey, removeAvatar, uploadAvatar, type GobiaProfile } from '../api';

export default function ProfileScreen() {
    const queryClient = useQueryClient();
    const { data: profile } = useQuery({ queryKey: profileQueryKey, queryFn: fetchProfile, staleTime: Infinity });
    const fileInput = useRef<HTMLInputElement>(null);
    const [picked, setPicked] = useState<File | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const store = (next: GobiaProfile) => queryClient.setQueryData(profileQueryKey, next);

    const upload = useMutation({
        mutationFn: uploadAvatar,
        onSuccess: (next) => {
            store(next);
            setPicked(null);
            toast.success('Avatar updated.');
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });
    const remove = useMutation({
        mutationFn: removeAvatar,
        onSuccess: (next) => {
            store(next);
            toast.success('Avatar removed.');
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });
    const rename = useMutation({
        mutationFn: () => changeUsername(username.trim(), password),
        onSuccess: (next) => {
            store(next);
            setUsername('');
            setPassword('');
            toast.success('Username updated.');
        },
        onError: (error: Error) => toast.error(httpErrorToHuman(error)),
    });

    const submitRename = (event: FormEvent) => {
        event.preventDefault();
        rename.mutate();
    };

    return (
        <PageContentBlock title={'Profile'}>
            <div className={'gb-page-head'}>
                <div style={{ minWidth: 0 }}>
                    <h1>Profile</h1>
                    <p>Update the identity shown across the Panel.</p>
                </div>
            </div>
            <div className={'grid grid-cols-1 gap-4 xl:grid-cols-2'}>
                <ContentBox
                    title={'Profile Picture'}
                    description={'Any image works. You crop it to a square before saving.'}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                        <div
                            aria-hidden
                            className={
                                'grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-2xl font-semibold text-muted-foreground'
                            }
                        >
                            {profile?.avatar_url ? (
                                <img src={profile.avatar_url} alt={''} className={'size-full object-cover'} />
                            ) : (
                                <span>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</span>
                            )}
                        </div>
                        <div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                <Button type={'button'} onClick={() => fileInput.current?.click()}>
                                    {profile?.avatar_url ? 'Replace Picture' : 'Upload Picture'}
                                </Button>
                                {profile?.avatar_url && (
                                    <Button.Text
                                        type={'button'}
                                        isLoading={remove.isPending}
                                        onClick={() => remove.mutate()}
                                    >
                                        Remove
                                    </Button.Text>
                                )}
                            </div>
                            <input
                                ref={fileInput}
                                type={'file'}
                                accept={'image/*'}
                                className={'sr-only'}
                                aria-label={'Choose an avatar picture'}
                                onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    if (file) setPicked(file);
                                }}
                            />
                            <p className={'gb-hint'} style={{ marginTop: 8 }}>
                                Stored as a 256 pixel PNG.
                            </p>
                        </div>
                    </div>
                </ContentBox>

                <ContentBox
                    title={'Username'}
                    description={'Used to sign in and shown to people you share instances with.'}
                >
                    <form onSubmit={submitRename}>
                        <Label htmlFor={'gobia-username'}>Username</Label>
                        <Input
                            id={'gobia-username'}
                            value={username}
                            placeholder={profile?.username}
                            autoComplete={'off'}
                            onChange={(event) => setUsername(event.currentTarget.value)}
                        />
                        <p className={'gb-hint'}>Usernames are stored in lowercase and must be unique.</p>
                        <div style={{ marginTop: 16 }}>
                            <Label htmlFor={'gobia-username-password'}>Confirm Password</Label>
                            <Input
                                id={'gobia-username-password'}
                                type={'password'}
                                value={password}
                                autoComplete={'current-password'}
                                onChange={(event) => setPassword(event.currentTarget.value)}
                            />
                        </div>
                        <div style={{ marginTop: 18 }}>
                            <Button
                                type={'submit'}
                                isLoading={rename.isPending}
                                disabled={!username.trim() || !password}
                            >
                                Update Username
                            </Button>
                        </div>
                    </form>
                </ContentBox>
            </div>
            {picked && (
                <AvatarCropper
                    file={picked}
                    onCancel={() => setPicked(null)}
                    onApply={(png) =>
                        upload.mutateAsync(png).then(
                            () => undefined,
                            () => undefined
                        )
                    }
                />
            )}
        </PageContentBlock>
    );
}
