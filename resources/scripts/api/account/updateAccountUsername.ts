import http from '@/api/http';

export default async (username: string): Promise<string> => {
    const { data } = await http.put('/api/client/account/username', { username });

    return data.username;
};
