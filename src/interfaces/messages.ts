import { RangeOptions } from 'abstract-level/types/interfaces';
import { ExportLog } from './logged';

export interface Message {}

export interface Request extends Message {}

export interface Response extends Message {}

////////// ERROR
export interface ErrorMessage extends Response {
    message: string;
}

////////// DISCOVERY
export interface DiscoveryRequest extends Request {
    push?: boolean;
}

export interface DiscoveryResponse extends Response {
    levelId: string;
    sequence: string;
}

////////// FETCH
export interface FetchRequest extends Request {
    options: RangeOptions<string>;
}

export interface FetchResponse extends Response {
    logs: ExportLog[];
}

////////// PULL
export interface PullRequest extends Request {
    keys: string[];
}

export interface PullResponse extends Response {
    data: {
        key: string;
        value: any;
    }[];
}
