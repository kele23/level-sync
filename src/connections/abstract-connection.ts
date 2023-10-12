export abstract class AbstractConnection {
    constructor() {}

    abstract send(data: any): Promise<void>;

    abstract onReceive(fn: (data: any) => void): void;
}
