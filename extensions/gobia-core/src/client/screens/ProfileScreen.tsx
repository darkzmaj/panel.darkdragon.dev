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
            <div className={'gb:grid gb:gap-6 gb:lg:grid-cols-2'}>
                <ContentBox title={'Avatar'}>
                    <div className={'gb:flex gb:items-center gb:gap-5'}>
                        <div
                            aria-hidden
                            className={
                                'gb:grid gb:size-24 gb:shrink-0 gb:place-items-center gb:overflow-hidden gb:rounded-full gb:border gb:border-border gb:bg-sunken gb:text-3xl gb:font-semibold gb:text-muted-foreground'
                            }
                        >
                            {profile?.avatar_url ? (
                                <img src={profile.avatar_url} alt={''} className={'gb:size-full gb:object-cover'} />
                            ) : (
                                <span>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</span>
                            )}
                        </div>
                        <div className={'gb:flex gb:flex-wrap gb:gap-2'}>
                            <Button type={'button'} color={'primary'} onClick={() => fileInput.current?.click()}>
                                Choose picture
                            </Button>
                            {profile?.avatar_url && (
                                <Button.Danger
                                    type={'button'}
                                    isLoading={remove.isPending}
                                    onClick={() => remove.mutate()}
                                >
                                    Remove
                                </Button.Danger>
                            )}
                            <input
                                ref={fileInput}
                                type={'file'}
                                accept={'image/*'}
                                className={'gb:sr-only'}
                                aria-label={'Choose an avatar picture'}
                                onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    if (file) setPicked(file);
                                }}
                            />
                        </div>
                    </div>
                    <p className={'gb:mt-4 gb:text-xs gb:text-muted-foreground'}>
                        Any image works. You crop it to a square next and it is stored as a 256 pixel PNG.
                    </p>
                </ContentBox>

                <ContentBox title={'Username'}>
                    <form onSubmit={submitRename} className={'gb:flex gb:flex-col gb:gap-4'}>
                        <div>
                            <Label htmlFor={'gobia-username'}>New username</Label>
                            <Input
                                id={'gobia-username'}
                                value={username}
                                placeholder={profile?.username}
                                autoComplete={'off'}
                                onChange={(event) => setUsername(event.currentTarget.value)}
                            />
                        </div>
                        <div>
                            <Label htmlFor={'gobia-username-password'}>Current password</Label>
                            <Input
                                id={'gobia-username-password'}
                                type={'password'}
                                value={password}
                                autoComplete={'current-password'}
                                onChange={(event) => setPassword(event.currentTarget.value)}
                            />
                        </div>
                        <div>
                            <Button
                                type={'submit'}
                                color={'primary'}
                                isLoading={rename.isPending}
                                disabled={!username.trim() || !password}
                            >
                                Change username
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
