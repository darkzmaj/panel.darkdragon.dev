import getServer, { Server } from '@/api/server/getServer';
import { action, Action, computed, Computed, createContextStore, thunk, Thunk } from 'easy-peasy';
import socket, { SocketStore } from './socket';
import files, { ServerFileStore } from '@/state/server/files';
import { composeWithDevTools } from 'redux-devtools-extension';
import schedules, { ServerScheduleStore } from '@/state/server/schedules';
import databases, { ServerDatabaseStore } from '@/state/server/databases';
import isEqual from 'react-fast-compare';

let latestRequest = 0;

/** Marks any in-flight server request as stale, so a late response cannot overwrite what is on screen. */
export const invalidateServerRequests = () => {
    latestRequest++;
};

export type ServerStatus = 'offline' | 'starting' | 'stopping' | 'running' | null;

interface ServerDataStore {
    data?: Server;
    inConflictState: Computed<ServerDataStore, boolean>;
    isInstalling: Computed<ServerDataStore, boolean>;
    permissions: string[];

    getServer: Thunk<ServerDataStore, string, Record<string, unknown>, ServerStore, Promise<void>>;
    setServer: Action<ServerDataStore, Server>;
    setServerFromState: Action<ServerDataStore, (s: Server) => Server>;
    setPermissions: Action<ServerDataStore, string[]>;
}

const server: ServerDataStore = {
    permissions: [],

    inConflictState: computed((state) => {
        if (!state.data) {
            return false;
        }

        return state.data.status !== null || state.data.isTransferring || state.data.isNodeUnderMaintenance;
    }),

    isInstalling: computed((state) => {
        return state.data?.status === 'installing' || state.data?.status === 'install_failed';
    }),

    getServer: thunk(async (actions, payload) => {
        const request = ++latestRequest;
        const [server, permissions] = await getServer(payload);

        // The user already moved on to another server (or left): this response is stale and must not be shown.
        if (request !== latestRequest) return;

        actions.setServer(server);
        actions.setPermissions(permissions);
    }),

    setServer: action((state, payload) => {
        if (!isEqual(payload, state.data)) {
            state.data = payload;
        }
    }),

    setServerFromState: action((state, payload) => {
        const output = payload(state.data!);
        if (!isEqual(output, state.data)) {
            state.data = output;
        }
    }),

    setPermissions: action((state, payload) => {
        if (!isEqual(payload, state.permissions)) {
            state.permissions = payload;
        }
    }),
};

interface ServerStatusStore {
    value: ServerStatus;
    setServerStatus: Action<ServerStatusStore, ServerStatus>;
}

const status: ServerStatusStore = {
    value: null,
    setServerStatus: action((state, payload) => {
        state.value = payload;
    }),
};

export interface ServerStore {
    server: ServerDataStore;
    databases: ServerDatabaseStore;
    files: ServerFileStore;
    schedules: ServerScheduleStore;
    socket: SocketStore;
    status: ServerStatusStore;
    clearServerState: Action<ServerStore>;
}

export const ServerContext = createContextStore<ServerStore>(
    {
        server,
        socket,
        status,
        databases,
        files,
        schedules,
        clearServerState: action((state) => {
            state.server.data = undefined;
            state.server.permissions = [];
            state.databases.data = [];
            state.files.directory = '/';
            state.files.selectedFiles = [];
            state.schedules.data = [];

            if (state.socket.instance) {
                state.socket.instance.removeAllListeners();
                state.socket.instance.close();
            }

            state.socket.instance = null;
            state.socket.connected = false;
        }),
    },
    {
        compose: composeWithDevTools({
            name: 'ServerStore',
            trace: true,
        }),
    }
);
