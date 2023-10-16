import EventEmitter, { once } from 'events';
import Peer, { DataConnection } from 'peerjs';
import { nextTick } from '../utils/next-tick';
import { AbstractConnection } from './abstract-connection';

export class P2PConnection extends AbstractConnection {
    private _peer: Peer;
    private _dataConnection?: DataConnection;
    private _receiveListener?: (data: any) => Promise<any>;
    private _ee: EventEmitter;
    private _isSendWaiting = false;

    constructor(peer: Peer) {
        super();
        this._peer = peer;
        this._ee = new EventEmitter();
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

    async send(data: any): Promise<any> {
        nextTick(() => {
            this._dataConnection?.send(data);
        });
        this._isSendWaiting = true;
        const responseData = await once(this._ee, 'received');
        this._isSendWaiting = false;
        if (responseData && responseData.length > 0) return responseData[0];
        return null;
    }

    onReceive(fn: (data: any) => Promise<any>): void {
        this._receiveListener = fn;
    }

    private _connectListeners() {
        this._dataConnection?.on('data', (data) => {
            if (this._isSendWaiting) this._ee.emit('received', data);
            else this._handleReceive(data);
        });
        this._dataConnection?.on('close', () => {
            this._handleDisconnected();
        });
        this._dataConnection?.on('error', () => {
            this._handleDisconnected();
        });
    }

    private async _handleReceive(data: any) {
        if (!this._receiveListener) return;
        const response = await this._receiveListener(data);
        this._dataConnection?.send(response);
    }

    private _handleDisconnected() {
        this._dataConnection = undefined;
    }
}
