import { AbstractConnection } from './abstract-connection';

/**
 * CLIENT ->  SEND than RECEIVE
 * You need to provide a sender method to send data to server
 */
export class ClientConnection extends AbstractConnection {
    private _sender: (data: any) => Promise<any>;

    constructor(sender: (data: any) => Promise<any>) {
        super();
        this._sender = sender;
    }

    async send(data: any): Promise<any> {
        return await this._sender(data);
    }

    onReceive(_fn: (data: any) => Promise<any>): void {
        // do nothing
    }
}

/**
 * SERVER -> RECEIVE than SEND
 * Your server when receive connections need to call the "receiver" method on this class
 */
export class ServerConnection extends AbstractConnection {
    private _receiveListener?: (data: any) => Promise<any>;

    constructor() {
        super();
    }

    async incomingReceive(data: any) {
        return await this._handleReceive(data);
    }

    async send(_data: any): Promise<void> {
        // do nothing
    }

    onReceive(fn: (data: any) => Promise<any>): void {
        this._receiveListener = fn;
    }

    // run receive in async
    private async _handleReceive(data: any): Promise<any> {
        if (this._receiveListener) {
            return await this._receiveListener(data);
        }
        throw 'Missing receive listener';
    }
}
