import Peer, { DataConnection } from 'peerjs';
import { AbstractConnection } from './abstract-connection';

export class P2PConnection extends AbstractConnection {
    private _peer: Peer;
    private _dataConnection?: DataConnection;
    private _receiveListeners: ((data: any) => void)[];
    private _disconnectListeners: (() => void)[];

    constructor(peer: Peer) {
        super();
        this._peer = peer;
        this._receiveListeners = [];
        this._disconnectListeners = [];
    }

    //** Start connection to PeerID */
    connect(peerId: string): void {
        if (this._dataConnection) throw 'This connection is already active';
        this._dataConnection = this._peer.connect(peerId, { reliable: true });
        this._connectListeners();
    }

    incomingConnection(conn: DataConnection): void {
        if (this._dataConnection) throw 'This connection is already active';
        this._dataConnection = conn;
        this._connectListeners();
    }

    disconnect() {
        this._dataConnection?.close();
        this._dataConnection = undefined;
    }

    async send(data: any): Promise<void> {
        if (!this._dataConnection) throw 'This connection is not active';

        console.debug('>>>>>> ', data);
        await this._dataConnection.send(data);
    }

    onReceive(fn: (data: any) => void): void {
        this._receiveListeners.push(fn);
    }

    onDisconnected(fn: () => void): void {
        this._disconnectListeners.push(fn);
    }

    private _connectListeners() {
        this._dataConnection?.on('data', (data) => {
            this._handleReceive(data);
        });
        this._dataConnection?.on('close', () => {
            this._handleDisconnected();
        });
        this._dataConnection?.on('error', () => {
            this._handleDisconnected();
        });
    }

    private _handleReceive(data: any) {
        console.debug('<<<<<< ', data);
        for (const fn of this._receiveListeners) {
            fn(data);
        }
    }

    private _handleDisconnected() {
        for (const fn of this._disconnectListeners) {
            fn();
        }
        this._dataConnection = undefined;
    }
}
