export abstract class AbstractConnection {
    constructor() {}

    abstract send(data: any): Promise<any>; // send and receive data

    abstract onReceive(fn: (data: any) => Promise<any>): void; // receive and send data
}
