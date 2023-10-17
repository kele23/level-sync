export interface LogRecord {
    timestamp: number;
    type: 'del' | 'put';
    key: string;
    uuid: string;
    size: number
}

export interface ExportLog {
    sequence: string;
    value: LogRecord;
}
