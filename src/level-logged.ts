import {
    AbstractBatchDelOperation,
    AbstractBatchPutOperation,
    AbstractClearOptions,
    AbstractLevel,
    AbstractSublevel,
    NodeCallback,
} from 'abstract-level';
import {
    BatchOptions,
    DelOptions,
    GetManyOptions,
    GetOptions,
    IteratorOptions,
    Level,
    OpenOptions,
    PutOptions,
} from 'level';
import UUID from 'pure-uuid';
import { LogRecord } from './interfaces/logged';
import { getSequence } from './utils/sequence';

export class LevelLogged extends AbstractLevel<any, string, any> {
    private _id: string;

    private _db: Level<string, any>;
    private _logs!: AbstractSublevel<Level<string, any>, any, string, LogRecord>;
    private _logsIndex!: AbstractSublevel<Level<string, any>, any, string, string>;
    private _friends!: AbstractSublevel<Level<string, any>, any, string, string>;
    private _sequence: string;

    constructor(db: Level<string, any>) {
        super({
            encodings: {
                buffer: true,
                utf8: true,
                view: true,
            },
        });
        this._id = new UUID(4).format('std'); // default id
        this._db = db;
        this._sequence = getSequence(); // zero

        // run init in next tick, after open
        this.nextTick(() => {
            this._init();
        });
    }

    ////////////////////////////////// LEVEL

    get id() {
        return this._id;
    }

    get sequence() {
        return this._sequence;
    }

    async _init() {
        try {
            this._id = await this._db.get('__id__');
        } catch (error) {
            await this._db.put('__id__', this._id); // save id on db
        }

        // create levels
        this._logs = this._db.sublevel<string, LogRecord>('__logs__', { valueEncoding: 'json' });
        this._logsIndex = this._db.sublevel<string, string>('__logs_index__', {
            valueEncoding: 'utf8',
        });
        this._friends = this._db.sublevel<string, string>('__friends__', {
            valueEncoding: 'utf8',
        });

        // load starting sequence
        try {
            for await (const key of this._logs.keys({ limit: 1, reverse: true })) {
                this._sequence = key;
            }
        } catch (error) {
            console.warn('Error', error);
        }

        // complete initialization
        this.emit('initialized');
    }

    _open(_options: OpenOptions, callback: NodeCallback<void>): void {
        this.once('initialized', () => {
            this.nextTick(callback);
        });
    }

    _close(callback: NodeCallback<void>) {
        this._db.close(callback);
    }

    _put(key: string, value: any, options: PutOptions<string, any>, callback: NodeCallback<void>) {
        // use batch for put
        let op = { type: 'put', key: key, value: value } as AbstractBatchPutOperation<this, string, any>;
        if (options.keyEncoding) op.keyEncoding = options.keyEncoding;
        if (options.valueEncoding) op.valueEncoding = options.valueEncoding;
        this.batch([op], callback);
    }

    _get(key: string, options: GetOptions<string, any>, callback: NodeCallback<any>) {
        this._db.get(key, options, callback);
    }

    _getMany(keys: string[], options: GetManyOptions<string, any>, callback: NodeCallback<any[]>) {
        this._db.getMany(keys, options, callback);
    }

    _del(key: string, options: DelOptions<string>, callback: NodeCallback<void>) {
        // use batch for del
        let op = { type: 'del', key: key } as AbstractBatchDelOperation<this, string>;
        if (options.keyEncoding) op.keyEncoding = options.keyEncoding;
        this.batch([op], callback);
    }

    _clear(options: AbstractClearOptions<string>, callback: NodeCallback<void>) {
        (async () => {
            try {
                for await (const key of this.keys(options)) {
                    await this.del(key);
                }
                callback(null);
            } catch (error) {
                callback(error as Error);
            }
        })();
    }

    _batch(
        operations: (
            | AbstractBatchPutOperation<Level<string, any>, string, any>
            | AbstractBatchDelOperation<Level<string, any>, string>
        )[],
        options: BatchOptions<string, any>,
        callback: NodeCallback<void>,
    ) {
        let newOperations = [] as (
            | AbstractBatchPutOperation<Level<string, any>, string, any>
            | AbstractBatchDelOperation<Level<string, any>, string>
        )[];

        // add current batch operations
        newOperations.push(...operations);

        // for each operation
        for (const operation of operations) {
            const key = operation.key;
            let size = 0;
            if (operation.type == 'put') {
                if (operation.value instanceof Uint8Array) {
                    size = operation.value.length;
                } else {
                    const enc = new TextEncoder();
                    size = enc.encode(JSON.stringify(operation.value)).length;
                }
            }

            // increase sequence
            this._sequence = getSequence(this._sequence);
            const newRecord = {
                timestamp: new Date().getTime(),
                type: operation.type,
                key: operation.key,
                uuid: new UUID(4).format('std'),
                size,
            };

            const indexValue = this._sequence;
            newOperations.push({
                type: 'put',
                key,
                value: indexValue,
                sublevel: this._logsIndex,
            });
            newOperations.push({
                type: 'put',
                key: this._sequence,
                value: newRecord,
                sublevel: this._logs,
            }); // save only to my logs
        }

        this._db.batch(newOperations, options, callback);
    }

    _iterator(options: IteratorOptions<string, any>) {
        return this._db.iterator(options);
    }

    // GET
    getLogsLevel() {
        return this._logs;
    }

    getIndexLevel() {
        return this._logsIndex;
    }

    getFriendsLevel() {
        return this._friends;
    }

    // SETTER
    setSequence(sequence: string) {
        this._sequence = sequence;
    }

    // DIRECT

    async directPut(key: string, value: any, options?: PutOptions<string, any>) {
        if (options) return await this._db.put(key, value, options);
        return await this._db.put(key, value);
    }

    async directDel(key: string) {
        return await this._db.del(key);
    }

    async directBatch(
        operations: (
            | AbstractBatchPutOperation<Level<string, any>, string, any>
            | AbstractBatchDelOperation<Level<string, any>, string>
        )[],
        options?: BatchOptions<string, any>,
    ) {
        if (options) return await this._db.batch(operations, options);
        return await this._db.batch(operations);
    }
}
