import http from '@/api/http';

export const uploadAccountAvatar = async (file: File): Promise<string> => {
    const body = new FormData();
    body.append('avatar', file);

    const { data } = await http.post('/api/client/account/avatar', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });

    return data.avatar_url;
};

export const deleteAccountAvatar = (): Promise<void> => http.delete('/api/client/account/avatar');
