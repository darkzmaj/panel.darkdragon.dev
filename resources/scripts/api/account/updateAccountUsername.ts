import http from '@/api/http';

export default async (username: string, password: string): Promise<string> => {
    const { data } = await http.put('/api/client/account/username', { username, password });

    return data.username;
};
