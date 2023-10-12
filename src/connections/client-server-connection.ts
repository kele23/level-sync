import EventEmitter, { once } from 'events';
import { AbstractConnection } from './abstract-connection';

/**
 * CLIENT ->  SEND than RECEIVE
 * You need to provide a sender method to send data to server
 */
export class ClientConnection extends AbstractConnection {
    private _sender: (data: any) => Promise<any>;
    private _receiveListeners: ((data: any) => void)[];

    constructor(sender: (data: any) => Promise<any>) {
        super();
        this._sender = sender;
        this._receiveListeners = [];
    }

    async send(data: any): Promise<void> {
        console.debug('>>>>>> ', data);
        const response = await this._sender(data);
        if (response.status == 200) {
            this._handleReceive(response.data);
        } else {
            throw 'Cannot receive data';
        }
    }

    onReceive(fn: (data: any) => void): void {
        this._receiveListeners.push(fn);
    }

    private _handleReceive(data: any) {
        console.debug('<<<<<< ', data);
        for (const fn of this._receiveListeners) {
            fn(data);
        }
    }
}

/**
 * SERVER -> RECEIVE than SEND
 * Your server when receive connections need to call the "receiver" method on this class
 */
export class ServerConnection extends AbstractConnection {
    private _ee: EventEmitter;
    private _receiveListeners: ((data: any) => void)[];

    constructor() {
        super();
        this._ee = new EventEmitter();
        this._receiveListeners = [];
    }

    async incomingReceive(data: any) {
        this._handleReceive(data);
        return await once(this._ee, 'send');
    }

    async send(data: any): Promise<void> {
        console.debug('>>>>>> ', data);
        this._ee.emit('send', data);
    }

    onReceive(fn: (data: any) => void): void {
        this._receiveListeners.push(fn);
    }

    // run receive in async
    private _handleReceive(data: any) {
        console.debug('<<<<<< ', data);
        for (const fn of this._receiveListeners) {
            fn(data);
        }
    }
}
