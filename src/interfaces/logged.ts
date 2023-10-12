export interface LogRecord {
    timestamp: number;
    type: 'del' | 'put';
    key: string;
}

export interface ExportLog {
    sequence: string;
    value: LogRecord;
}
