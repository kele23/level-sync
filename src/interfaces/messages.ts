import { RangeOptions } from 'abstract-level/types/interfaces';
import { ExportLog } from './logged';

export interface Message {
    transaction: string;
}

export interface Request extends Message {
    action: string;
}

export interface Response extends Message {}

////////// ERROR
export interface ErrorResponse extends Response {
    message: string;
}

//////////////////////////////////////////////////////// PULL
////////// DISCOVERY
export const PULL_DISCOVERY_ACTION = 'pull-discovery';

export interface PullDiscoveryRequest extends Request {}

export interface PullDiscoveryResponse extends Response {
    levelId: string;
    sequence: string;
}

////////// FETCH
export const PULL_FETCH_ACTION = 'pull-fetch';

export interface PullFetchRequest extends Request {
    options: RangeOptions<string>;
}

export interface PullFetchResponse extends Response {
    logs: ExportLog[];
}

////////// PULL
export const PULL_ACTION = 'pull';

export interface PullRequest extends Request {
    keys: string[];
}

export interface PullData {
    key: string;
    value: any;
}

export interface PullResponse extends Response {
    data: PullData[];
}

//////////////////////////////////////////////////////// PUSH
////////// DISCOVERY
export const PUSH_DISCOVERY_ACTION = 'push-discovery';

export interface PushDiscoveryRequest extends Request {
    levelId: string;
    sequence: string;
}

export interface PushDiscoveryResponse extends Response {
    options: RangeOptions<string>;
}

////////// SEND
export const PUSH_SEND_ACTION = 'push-send';

export interface PushSendRequest extends Request {
    logs: ExportLog[];
}

export interface PushSendResponse extends Response {
    keys: string[];
}

////////// PUSH
export const PUSH_ACTION = 'push';

export interface PushData {
    key: string;
    value: any;
}

export interface PushRequest extends Request {
    data: PushData[];
}

export interface PushResponse extends Response {}
