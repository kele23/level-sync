import { AbstractBatchOperation, AbstractLevel } from 'abstract-level';
import EventEmitter, { once } from 'events';
import { AbstractConnection } from './connections/abstract-connection';
import { ExportLog } from './interfaces/logged';
import {
    DiscoveryRequest,
    DiscoveryResponse,
    FetchRequest,
    FetchResponse,
    PullRequest,
    PullResponse,
} from './interfaces/messages';
import { LevelLogged } from './level-logged';
import { getSequence } from './utils/sequence';
import { Level } from 'level';

export class SyncManager {
    private _db: LevelLogged;
    private _connection: AbstractConnection;
    private _state: string;
    private _ee: EventEmitter;
    private _intervalId?: any;

    constructor(db: LevelLogged, connection: AbstractConnection) {
        this._db = db;
        this._connection = connection;
        this._state = 'WAIT_DISCOVERY';
        this._connection.onReceive((data: any) => {
            this._handleReceive(data);
        });
        this._ee = new EventEmitter();
    }

    async doPull() {
        if (this._state != 'WAIT_DISCOVERY') throw 'Starting state not valid, maybe another process is in progress';

        this._connection.send({} as DiscoveryRequest);
        this._state = 'WAIT_START';
        await once(this._ee, 'complete');
    }

    // push is a pull, started from the peer that not initialized the connection
    async doPush() {
        if (this._state != 'WAIT_DISCOVERY') throw 'Starting state not valid, maybe another process is in progress';

        this._connection.send({ push: true } as DiscoveryRequest);
        this._state = 'WAIT_PUSH_DISCOVERY'; // remain in discovery ( other type )
        await once(this._ee, 'complete');
    }

    async doSync(interval?: number) {
        if (this._state != 'WAIT_DISCOVERY') throw 'Starting state not valid, maybe another process is in progress';

        if (!interval) {
            await this.doPull();
            await this.doPush();
        } else {
            this._intervalId = setInterval(async () => {
                await this.doPull();
                await this.doPush();
            }, interval * 1000);
        }
    }

    stopSync() {
        if (this._intervalId) clearInterval(this._intervalId);
        this._intervalId = undefined;
    }

    isScheduled() {
        return this._intervalId ? true : false;
    }

    _handleReceive(data: any) {
        switch (this._state) {
            case 'WAIT_PUSH_DISCOVERY':
            case 'WAIT_DISCOVERY': {
                this._waitDiscovery(data);
                break;
            }
            case 'WAIT_START': {
                this._waitStart(data);
                break;
            }
            case 'WAIT_FETCH': {
                this._waitFetch(data);
                break;
            }
            case 'WAIT_FETCH_RESPONSE': {
                this._waitFetchResponse(data);
                break;
            }
            case 'WAIT_PULL': {
                this._waitPull(data);
                break;
            }
            case 'WAIT_PULL_RESPONSE': {
                this._waitPullResponse(data);
                break;
            }
            default: {
                console.error('Unkown state');
            }
        }
    }

    private async _waitDiscovery(data: any) {
        const discoveryRequest = data as DiscoveryRequest;
        if (discoveryRequest.push) {
            this._connection.send({});
            this._state = 'WAIT_START';
        } else {
            this._connection.send({
                sequence: this._db.sequence,
                levelId: this._db.id,
            } as DiscoveryResponse);
            this._state = 'WAIT_FETCH';
        }
    }

    private async _waitStart(data: any) {
        const discoveryResponse = data as DiscoveryResponse;
        const friendsLevel = this._db.getFriendsLevel();

        // get current friend position
        const friendSequence = discoveryResponse.sequence;
        let gt = undefined;
        try {
            gt = await friendsLevel.get(discoveryResponse.levelId);
        } catch (error) {
            console.debug(`Friend ${discoveryResponse.levelId} not found`);
        }

        // create options for logs to take
        let options = { lte: friendSequence } as object;
        if (gt) {
            options = { ...options, gt };
        }

        // move friend up
        await friendsLevel.put(discoveryResponse.levelId, friendSequence);

        this._connection.send({
            options,
        } as FetchRequest);
        this._state = 'WAIT_FETCH_RESPONSE';
    }

    private async _waitFetch(data: any) {
        const fetchRequest = data as FetchRequest;
        const logsLevel = this._db.getLogsLevel();

        const toExport = [];
        for await (const [sequence, value] of logsLevel.iterator(fetchRequest.options)) {
            toExport.push({ sequence, value });
        }

        this._connection.send({
            logs: toExport,
        } as FetchResponse);
        this._state = 'WAIT_PULL';
    }

    private async _waitFetchResponse(data: any) {
        const fetchResponse = data as FetchResponse;
        const logsLevel = this._db.getLogsLevel();
        const indexLevel = this._db.getIndexLevel();

        let friendLogs = fetchResponse.logs;

        // key to request on next step
        let keyToTake = new Set<string>();
        let keyToDelete = new Set<string>();

        if (friendLogs.length > 0) {
            const baseSequence = friendLogs[0].sequence;
            const conflictKeys = new Set<string>();

            const changedKeys = new Set();
            for (const friendLog of friendLogs) {
                changedKeys.add(friendLog.value.key);
            }

            // check conflicts
            let myLogs = [] as ExportLog[];
            for await (const [sequence, value] of logsLevel.iterator({ gte: baseSequence })) {
                const key = value.key;
                if (changedKeys.has(key)) {
                    conflictKeys.add(key);
                }

                myLogs.push({ sequence, value });
            }

            // changedKeys --> All key changed
            // conflictKeys --> All key changed with conflict

            // remove all conflict keys from myLogs
            if (conflictKeys.size > 0) {
                myLogs = myLogs.filter((item) => !conflictKeys.has(item.value.key));
            }

            // re-organize logs
            const allLogs = [...friendLogs, ...myLogs].sort((a, b) => {
                return a.value.timestamp - b.value.timestamp;
            }) as ExportLog[];

            let newSequence = baseSequence;
            // create operations, first friend logs after mylogs
            const operations = [] as AbstractBatchOperation<Level<string, any>, string, any>[];

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
            await this._db.directBatch(operations);
            this._db.setSequence(newSequence);

            // if log is a PUT, include value to keyToTake.. otherwise delete it from keyToTake
            for (const log of friendLogs) {
                if (log.value.type == 'put') keyToTake.add(log.value.key);
                else keyToTake.delete(log.value.key);
            }

            keyToDelete = new Set<string>([...conflictKeys].filter((item) => !keyToTake.has(item)));
        }

        // delete keys if necessary
        for (const key of keyToDelete) {
            await this._db.directDel(key);
        }

        // request new data
        this._connection.send({
            keys: Array.from(keyToTake),
        } as PullRequest);
        this._state = 'WAIT_PULL_RESPONSE';
    }

    private async _waitPull(data: any) {
        const pullRequest = data as PullRequest;

        const result = [];
        for (const key of pullRequest.keys) {
            const value = await this._db.get(key);
            result.push({ key, value });
        }

        this._connection.send({
            data: result,
        } as PullResponse);
        this._state = 'WAIT_DISCOVERY';
        this._ee.emit('complete', {});
    }

    private async _waitPullResponse(data: any) {
        const pullResponse = data as PullResponse;
        for (const { key, value } of pullResponse.data) {
            await this._db.directPut(key, value);
        }
        this._state = 'WAIT_DISCOVERY';
        this._ee.emit('complete', {});
    }
}
