import React, { useEffect, useRef, useState } from 'react';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { Websocket } from '@/plugins/Websocket';
import { ServerContext } from '@/state/server';
import getWebsocketToken from '@/api/server/getWebsocketToken';
import Spinner from '@/components/elements/Spinner';
import tw from 'twin.macro';

const reconnectErrors = ['jwt: exp claim is invalid', 'jwt: created too far in past (denylist)'];

export default () => {
    let updatingToken = false;
    const [error, setError] = useState<'connecting' | string>('');
    const [retry, setRetry] = useState(0);
    const wasDown = useRef(false);
    const toast = useStoreActions((actions: Actions<ApplicationStore>) => actions.toasts.push);
    const { connected, instance } = ServerContext.useStoreState((state) => state.socket);
    const uuid = ServerContext.useStoreState((state) => state.server.data?.uuid);
    const setServerStatus = ServerContext.useStoreActions((actions) => actions.status.setServerStatus);
    const { setInstance, setConnectionState } = ServerContext.useStoreActions((actions) => actions.socket);

    const updateToken = (uuid: string, socket: Websocket) => {
        if (updatingToken) return;

        updatingToken = true;
        getWebsocketToken(uuid)
            .then((data) => socket.setToken(data.token, true))
            .catch((error) => console.error(error))
            .then(() => {
                updatingToken = false;
            });
    };

    const connect = (uuid: string) => {
        const socket = new Websocket();

        socket.on('auth success', () => setConnectionState(true));
        socket.on('SOCKET_CLOSE', () => setConnectionState(false));
        socket.on('SOCKET_CONNECT_ERROR', () => {
            setError('Could not reach the server after several attempts.');
        });
        socket.on('SOCKET_RECONNECT_SCHEDULED', ({ attempt }: { attempt: number }) => {
            setRetry(attempt);
            setError('connecting');
            setConnectionState(false);
        });
        socket.on('SOCKET_ERROR', () => {
            setConnectionState(false);
        });
        socket.on('status', (status) => setServerStatus(status));

        socket.on('daemon error', (message) => {
            console.warn('Got error message from daemon socket:', message);
        });

        socket.on('token expiring', () => updateToken(uuid, socket));
        socket.on('token expired', () => updateToken(uuid, socket));
        socket.on('jwt error', (error: string) => {
            setConnectionState(false);
            console.warn('JWT validation error from wings:', error);

            if (reconnectErrors.find((v) => error.toLowerCase().indexOf(v) >= 0)) {
                updateToken(uuid, socket);
            } else {
                setError(
                    'There was an error validating the credentials provided for the websocket. Please refresh the page.'
                );
            }
        });

        socket.on('transfer status', (status: string) => {
            if (status === 'starting' || status === 'success') {
                return;
            }

            // This code forces a reconnection to the websocket which will connect us to the target node instead of the source node
            // in order to be able to receive transfer logs from the target node.
            socket.close();
            setError('connecting');
            setConnectionState(false);
            setInstance(null);
            connect(uuid);
        });

        getWebsocketToken(uuid)
            .then((data) => {
                // Connect and then set the authentication token.
                socket.setToken(data.token).connect(data.socket);

                // Once that is done, set the instance.
                setInstance(socket);
            })
            .catch((error) => console.error(error));
    };

    useEffect(() => {
        if (connected) {
            setError('');
            setRetry(0);
            if (wasDown.current) toast({ type: 'success', message: 'Connection restored.' });
            wasDown.current = false;
        }
    }, [connected]);

    useEffect(() => {
        if (error) wasDown.current = true;
    }, [error]);

    useEffect(() => {
        return () => {
            instance && instance.close();
        };
    }, [instance]);

    useEffect(() => {
        // If there is already an instance or there is no server, just exit out of this process
        // since we don't need to make a new connection.
        if (instance || !uuid) {
            return;
        }

        connect(uuid);
    }, [uuid]);

    if (!error) return null;

    // A compact notice pinned to the corner, so a lost connection never pushes the page content around.
    return (
        <div
            role={'status'}
            aria-live={'polite'}
            css={tw`fixed bottom-4 left-4 z-40 max-w-sm flex items-center rounded shadow-lg px-4 py-2 text-sm bg-neutral-800 border border-red-500 text-neutral-100`}
        >
            {error === 'connecting' ? (
                <>
                    <Spinner size={'small'} />
                    <span css={tw`ml-2`}>
                        Disconnected from server. Reconnecting{retry ? ` (attempt ${retry})` : ''}&hellip;
                    </span>
                </>
            ) : (
                <>
                    <span css={tw`flex-1`}>{error}</span>
                    {instance && (
                        <button type={'button'} css={tw`ml-3 underline`} onClick={() => instance.retryNow()}>
                            Retry
                        </button>
                    )}
                </>
            )}
        </div>
    );
};
