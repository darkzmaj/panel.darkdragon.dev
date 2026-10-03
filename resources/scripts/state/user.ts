import { Action, action, Thunk, thunk } from 'easy-peasy';
import updateAccountEmail from '@/api/account/updateAccountEmail';
import updateAccountUsername from '@/api/account/updateAccountUsername';
import { deleteAccountAvatar, uploadAccountAvatar } from '@/api/account/avatar';

export interface UserData {
    uuid: string;
    username: string;
    email: string;
    avatarUrl: string | null;
    language: string;
    rootAdmin: boolean;
    useTotp: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserStore {
    data?: UserData;
    setUserData: Action<UserStore, UserData>;
    updateUserData: Action<UserStore, Partial<UserData>>;
    updateUserEmail: Thunk<UserStore, { email: string; password: string }, any, UserStore, Promise<void>>;
    updateUsername: Thunk<UserStore, string, any, UserStore, Promise<void>>;
    uploadAvatar: Thunk<UserStore, File, any, UserStore, Promise<void>>;
    removeAvatar: Thunk<UserStore, void, any, UserStore, Promise<void>>;
}

const user: UserStore = {
    data: undefined,
    setUserData: action((state, payload) => {
        state.data = payload;
    }),

    updateUserData: action((state, payload) => {
        // @ts-expect-error limitation of Typescript, can't do much about that currently unfortunately.
        state.data = { ...state.data, ...payload };
    }),

    updateUserEmail: thunk(async (actions, payload) => {
        await updateAccountEmail(payload.email, payload.password);

        actions.updateUserData({ email: payload.email });
    }),

    updateUsername: thunk(async (actions, payload) => {
        actions.updateUserData({ username: await updateAccountUsername(payload) });
    }),

    uploadAvatar: thunk(async (actions, payload) => {
        actions.updateUserData({ avatarUrl: await uploadAccountAvatar(payload) });
    }),

    removeAvatar: thunk(async (actions) => {
        await deleteAccountAvatar();

        actions.updateUserData({ avatarUrl: null });
    }),
};

export default user;
