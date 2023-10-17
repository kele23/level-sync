import { AbstractBatchOperation } from 'abstract-level';
import { Level } from 'level';
import UUID from 'pure-uuid';
import { AbstractConnection } from './connections/abstract-connection';
import { ExportLog, LogRecord } from './interfaces/logged';
import {
    PULL_ACTION,
    PULL_DISCOVERY_ACTION,
    PULL_FETCH_ACTION,
    PUSH_ACTION,
    PUSH_DISCOVERY_ACTION,
    PUSH_SEND_ACTION,
    PullData,
    PullDiscoveryRequest,
    PullDiscoveryResponse,
    PullFetchRequest,
    PullFetchResponse,
    PullRequest,
    PullResponse,
    PushData,
    PushDiscoveryRequest,
    PushDiscoveryResponse,
    PushRequest,
    PushResponse,
    PushSendRequest,
    PushSendResponse,
    Request,
} from './interfaces/messages';
import { LevelLogged } from './level-logged';
import { base64Decode, base64Encode } from './utils/base64';
import { getSequence } from './utils/sequence';

interface PushInterface {
    friendLevelId: string;
    friendSequence: string;
    newSequence?: string;
    operations: AbstractBatchOperation<Level<string, any>, string, any>[];
}

export class SyncManager {
    private _db: LevelLogged;
    private _connection: AbstractConnection;
    private _intervalId?: any;
    private _pushStatus?: PushInterface;

    constructor(db: LevelLogged, connection: AbstractConnection) {
        this._db = db;
        this._connection = connection;

        this._connection.onReceive(async (data: any) => {
            return await this._handleReceive(data);
        });
    }

    /**
     * Do a PULL Operation
     * @param transaction The transaction of this Pull Action
     */
    async doPull(transaction?: string): Promise<void> {
        if (!transaction) transaction = new UUID(4).format('std');

        const friendsLevel = this._db.getFriendsLevel();

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest = { transaction, action: PULL_DISCOVERY_ACTION } as PullDiscoveryRequest;
        const discoveryResponse = (await this._connection.send(discoveryRequest)) as PullDiscoveryResponse;

        const friendLevelId = discoveryResponse.levelId;
        const friendSequence = discoveryResponse.sequence;
        const options = await this._getOptions(friendLevelId, friendSequence);

        /////////////////////////////////////////////////////////// FETCH
        const fetchRequest = {
            transaction,
            action: PULL_FETCH_ACTION,
            options,
        } as PullFetchRequest;
        const fetchResponse = (await this._connection.send(fetchRequest)) as PullFetchResponse;

        let friendLogs = fetchResponse.logs;

        // Handle Logs
        const { keyToTake, operations, newSequence } = await this._mergeLogs(friendLogs);

        /////////////////////////////////////////////////////////// PULL
        const pullRequest = {
            transaction,
            keys: Array.from(keyToTake),
            action: PULL_ACTION,
        } as PullRequest;
        const pullResponse = (await this._connection.send(pullRequest)) as PullResponse;
        for (const { key, value } of pullResponse.data) {
            operations.push({
                type: 'put',
                key,
                value: base64Decode(value),
                valueEncoding: 'view',
            });
        }

        operations.push({
            type: 'put',
            key: discoveryResponse.levelId,
            value: friendSequence,
            sublevel: friendsLevel,
        });

        await this._db.directBatch(operations);
        if (newSequence) this._db.setSequence(newSequence);
    }

    /**
     * Do a PUSH Operation
     * @param transaction The transaction of this Push Action
     */
    async doPush(transaction?: string): Promise<void> {
        if (!transaction) transaction = new UUID(4).format('std');

        const logsLevel = this._db.getLogsLevel();

        /////////////////////////////////////////////////////////// DISCOVERY
        const discoveryRequest = {
            transaction,
            action: PUSH_DISCOVERY_ACTION,
            sequence: this._db.sequence,
            levelId: this._db.id,
        } as PushDiscoveryRequest;
        const discoveryResponse = (await this._connection.send(discoveryRequest)) as PushDiscoveryResponse;

        const toExport = [] as ExportLog[];
        for await (const [sequence, value] of logsLevel.iterator(discoveryResponse.options)) {
            toExport.push({ sequence, value });
        }

        /////////////////////////////////////////////////////////// SEND
        const sendRequest = { transaction, action: PUSH_SEND_ACTION, logs: toExport } as PushSendRequest;
        const sendResponse = (await this._connection.send(sendRequest)) as PushSendResponse;

        /////////////////////////////////////////////////////////// PUSH
        const result = [] as PushData[];
        for (const key of sendResponse.keys) {
            const value = await this._db.get<string, Uint8Array>(key, { valueEncoding: 'view' });
            result.push({
                key,
                value: base64Encode(value),
            });
        }

        const pushRequest = { transaction, action: PUSH_ACTION, data: result } as PushRequest;
        (await this._connection.send(pushRequest)) as PushResponse;
    }

    /**
     * Sync two level instances, if an interval is provided every <interval> a new Sync operation is done
     * @param interval The interval
     */
    async doSync(interval?: number) {
        if (!interval) {
            const transaction = new UUID(4).format('std');
            await this.doPull(transaction);
            await this.doPush(transaction);
        } else {
            this._intervalId = setInterval(async () => {
                const transaction = new UUID(4).format('std');
                await this.doPull(transaction);
                await this.doPush(transaction);
            }, interval * 1000);
        }
    }

    /**
     * Stop a Sync if it is running
     */
    stopSync() {
        if (this._intervalId) clearInterval(this._intervalId);
        this._intervalId = undefined;
    }

    /**
     * @returns true if a sync is running
     */
    isScheduled() {
        return this._intervalId ? true : false;
    }

    private async _handleReceive(data: any): Promise<any> {
        const request = data as Request;
        switch (request.action) {
            /// PULL
            case PULL_ACTION:
                return await this._waitPull(data as PullRequest);
            case PULL_DISCOVERY_ACTION:
                return await this._waitPullDiscovery(data as PullDiscoveryRequest);
            case PULL_FETCH_ACTION:
                return await this._waitPullFetch(data as PullFetchRequest);
            /// PUSH
            case PUSH_ACTION:
                return await this._waitPush(data as PushRequest);
            case PUSH_DISCOVERY_ACTION:
                return await this._waitPushDiscovery(data as PushDiscoveryRequest);
            case PUSH_SEND_ACTION:
                return await this._waitPushSend(data as PushSendRequest);
        }
    }

    ///////////////////////////////////// PULL
    private async _waitPullDiscovery(_discoveryRequest: PullDiscoveryRequest) {
        return {
            sequence: this._db.sequence,
            levelId: this._db.id,
        } as PullDiscoveryResponse;
    }

    private async _waitPullFetch(fetchRequest: PullFetchRequest): Promise<PullFetchResponse> {
        const logsLevel = this._db.getLogsLevel();

        const toExport = [] as ExportLog[];
        for await (const [sequence, value] of logsLevel.iterator(fetchRequest.options)) {
            toExport.push({ sequence, value });
        }

        return {
            transaction: fetchRequest.transaction,
            logs: toExport,
        };
    }

    private async _waitPull(pullRequest: PullRequest): Promise<PullResponse> {
        const result = [] as PullData[];
        for (const key of pullRequest.keys) {
            const value = await this._db.get<string, Uint8Array>(key, { valueEncoding: 'view' });
            result.push({
                key,
                value: base64Encode(value),
            });
        }

        return {
            transaction: pullRequest.transaction,
            data: result,
        };
    }

    ///////////////////////////////////// PUSH
    private async _waitPushDiscovery(discoveryRequest: PushDiscoveryRequest): Promise<PushDiscoveryResponse> {
        const friendLevelId = discoveryRequest.levelId;
        const friendSequence = discoveryRequest.sequence;
        const options = await this._getOptions(friendLevelId, friendSequence);

        this._pushStatus = {
            friendLevelId,
            friendSequence,
            operations: [],
        };

        return {
            transaction: discoveryRequest.transaction,
            options,
        };
    }

    private async _waitPushSend(sendRequest: PushSendRequest): Promise<PushSendResponse> {
        let friendLogs = sendRequest.logs;

        // Handle Logs
        const { keyToTake, operations, newSequence } = await this._mergeLogs(friendLogs);

        this._pushStatus!.newSequence = newSequence;
        this._pushStatus!.operations = operations;

        return {
            transaction: sendRequest.transaction,
            keys: Array.from(keyToTake),
        };
    }

    private async _waitPush(pushRequest: PushRequest): Promise<PushResponse> {
        const friendsLevel = this._db.getFriendsLevel();
        const operations = this._pushStatus?.operations || [];

        for (const { key, value } of pushRequest.data) {
            operations.push({
                type: 'put',
                key,
                value: base64Decode(value),
                valueEncoding: 'view',
            });
        }

        operations.push({
            type: 'put',
            key: this._pushStatus!.friendLevelId,
            value: this._pushStatus!.friendSequence,
            sublevel: friendsLevel,
        });

        await this._db.directBatch(operations);
        if (this._pushStatus?.newSequence) this._db.setSequence(this._pushStatus?.newSequence);
        return {
            transaction: pushRequest.transaction,
        };
    }

    private async _getOptions(friendLevelId: string, friendSequence: string) {
        const friendsLevel = this._db.getFriendsLevel();

        // get current friend position
        let gt = undefined as string | undefined;
        try {
            gt = await friendsLevel.get(friendLevelId);
        } catch (error) {
            console.debug(`Friend ${friendLevelId} not found`);
        }

        // create options for logs to take
        let options = { lte: friendSequence } as object;
        if (gt) {
            options = { ...options, gt };
        }
        return options;
    }

    private async _mergeLogs(friendLogs: ExportLog[]) {
        const logsLevel = this._db.getLogsLevel();
        const indexLevel = this._db.getIndexLevel();

        let keyToTake = new Set<string>();
        let keyToDelete = new Set<string>();

        // create operations, first friend logs after mylogs
        let newSequence;
        const operations = [] as AbstractBatchOperation<Level<string, any>, string, any>[];
        if (friendLogs.length > 0) {
            const baseSequence = friendLogs[0].sequence;
            const conflictKeys = new Map<string, boolean>();

            const changedKeys = new Map<string, LogRecord>();
            for (const friendLog of friendLogs) {
                changedKeys.set(friendLog.value.key, friendLog.value);
            }

            // check conflicts
            let myLogs = [] as ExportLog[];
            for await (const [sequence, value] of logsLevel.iterator({ gte: baseSequence })) {
                const key = value.key;
                if (changedKeys.has(key)) {
                    conflictKeys.set(key, changedKeys.get(key)?.uuid == value.uuid);
                }

                myLogs.push({ sequence, value });
            }

            // changedKeys --> All key changed + last friend log
            // conflictKeys --> All key changed with conflict + last mine log
            // remove all conflict keys from myLogs
            if (conflictKeys.size > 0) {
                myLogs = myLogs.filter((item) => !conflictKeys.has(item.value.key));
            }

            // re-organize logs
            const allLogs = [...friendLogs, ...myLogs].sort((a, b) => {
                const order = a.sequence.localeCompare(b.sequence);
                return order != 0 ? order : a.value.timestamp - b.value.timestamp;
            }) as ExportLog[];

            newSequence = baseSequence;
            for (let i = 0; i < allLogs.length; i++) {
                const log = allLogs[i];
                operations.push({
                    key: newSequence,
                    type: 'put',
                    value: log.value,
                    sublevel: logsLevel,
                });
                operations.push({
                    type: 'put',
                    key: log.value.key,
                    value: newSequence,
                    sublevel: indexLevel,
                });
                // increate sequence if not last log
                if (i + 1 < allLogs.length) newSequence = getSequence(newSequence);
            }

            // if log is a PUT, include value to keyToTake.. otherwise delete it from keyToTake
            for (const log of friendLogs) {
                if (log.value.type == 'put') keyToTake.add(log.value.key);
                else keyToTake.delete(log.value.key);
            }

            keyToDelete = new Set<string>([...conflictKeys.keys()].filter((item) => !keyToTake.has(item)));
            keyToTake = new Set<string>([...keyToTake].filter((item) => !conflictKeys.get(item))); // remove equals hash
        }

        // delete keys if necessary
        for (const key of keyToDelete) {
            operations.push({
                type: 'del',
                key,
            });
        }
        return { keyToTake, operations, newSequence };
    }
}
