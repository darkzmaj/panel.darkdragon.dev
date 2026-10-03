import React from 'react';
import BoringAvatar, { AvatarProps } from 'boring-avatars';
import { useStoreState } from '@/state/hooks';

const palette = ['#FFAD08', '#EDD75A', '#73B06F', '#0C8F8F', '#587291'];

type Props = Omit<AvatarProps, 'colors'>;

type ImageProps = {
    src?: string | null;
    // Request the small copy of the uploaded picture, for avatars shown at icon size.
    thumbnail?: boolean;
};

// Renders the uploaded picture when there is one, otherwise a locally generated avatar seeded by the name.
const _Avatar = ({ variant = 'beam', src, thumbnail, ...props }: AvatarProps & ImageProps) =>
    src ? (
        <img
            src={thumbnail ? `${src}&s=64` : src}
            alt={''}
            decoding={'async'}
            className={'block w-full h-full object-cover'}
        />
    ) : (
        <BoringAvatar colors={palette} variant={variant} {...props} />
    );

const _UserAvatar = ({ variant = 'beam', ...props }: Omit<Props, 'name'> & Pick<ImageProps, 'thumbnail'>) => {
    const uuid = useStoreState((state) => state.user.data?.uuid);
    const avatarUrl = useStoreState((state) => state.user.data?.avatarUrl);

    return <_Avatar name={uuid || 'system'} src={avatarUrl} variant={variant} {...props} />;
};

_Avatar.displayName = 'Avatar';
_UserAvatar.displayName = 'Avatar.User';

const Avatar = Object.assign(_Avatar, {
    User: _UserAvatar,
});

export default Avatar;
