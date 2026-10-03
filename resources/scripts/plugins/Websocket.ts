import Sockette from 'sockette';
import { EventEmitter } from 'events';

export class Websocket extends EventEmitter {
    // The socket instance being tracked.
    private socket: Sockette | null = null;

    // The URL being connected to for the socket.
    private url: string | null = null;

    // The authentication token passed along with every request to the Daemon.
    // By default this token expires every 15 minutes and must therefore be
    // refreshed at a pretty continuous interval. The socket server will respond
    // with "token expiring" and "token expired" events when approaching 3 minutes
    // and 0 minutes to expiry.
    private token = '';

    private attempts = 0;

    private timer: ReturnType<typeof setTimeout> | null = null;

    private static readonly MAX_ATTEMPTS = 8;

    constructor() {
        super();
        this.on('auth success', () => {
            this.attempts = 0;
        });
    }

    // Connects to the websocket instance and sets the token for the initial request.
    connect(url: string): this {
        this.url = url;
        this.openSocket();

        return this;
    }

    private openSocket() {
        if (!this.url) return;

        this.socket?.close();
        // Reconnecting is handled below with exponential backoff, so sockette itself must not retry.
        this.socket = new Sockette(`${this.url}`, {
            timeout: 1000,
            maxAttempts: 0,
            onmessage: (e) => {
                try {
                    const { event, args } = JSON.parse(e.data);
                    args ? this.emit(event, ...args) : this.emit(event);
                } catch (ex) {
                    console.warn('Failed to parse incoming websocket message.', ex);
                }
            },
            onopen: () => {
                this.emit('SOCKET_OPEN');
                this.authenticate();
            },
            onclose: () => this.emit('SOCKET_CLOSE'),
            onerror: (error) => this.emit('SOCKET_ERROR', error),
            onmaximum: (evt) => {
                // We return code 4409 from Wings when a server is suspended. 4400 is reserved alongside it.
                if (evt?.code === 4409 || evt?.code === 4400) {
                    this.close(1000);

                    return;
                }
                this.scheduleReconnect();
            },
        });
    }

    // 1s, 2s, 4s ... capped at 30s, and given up on after a handful of attempts rather than hammering forever.
    private scheduleReconnect() {
        if (!this.url || this.timer) return;

        if (++this.attempts > Websocket.MAX_ATTEMPTS) {
            this.emit('SOCKET_CONNECT_ERROR');

            return;
        }

        const delay = Math.min(30000, 1000 * 2 ** (this.attempts - 1));
        this.emit('SOCKET_RECONNECT_SCHEDULED', { attempt: this.attempts, delay });
        this.timer = setTimeout(() => {
            this.timer = null;
            this.emit('SOCKET_RECONNECT');
            this.openSocket();
        }, delay);
    }

    // Starts over immediately, for example from a "Retry" button.
    retryNow() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.attempts = 0;
        this.openSocket();
    }

    // Sets the authentication token to use when sending commands back and forth
    // between the websocket instance.
    setToken(token: string, isUpdate = false): this {
        this.token = token;

        if (isUpdate) {
            this.authenticate();
        }

        return this;
    }

    authenticate() {
        if (this.url && this.token) {
            this.send('auth', this.token);
        }
    }

    close(code?: number, reason?: string) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.url = null;
        this.token = '';
        this.socket?.close(code, reason);
    }

    open() {
        this.socket?.open();
    }

    reconnect() {
        this.socket?.reconnect();
    }

    send(event: string, payload?: string | string[]) {
        this.socket?.json({ event, args: Array.isArray(payload) ? payload : [payload] });
    }
}
