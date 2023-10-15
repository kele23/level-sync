import queueMicrotask from 'queue-microtask';

export const browserNextTick = function (fn: any, ...args: any[]) {
    if (args.length === 0) {
        queueMicrotask(fn);
    } else {
        queueMicrotask(() => fn(...args));
    }
};

let nextTick = browserNextTick;
if (typeof process === 'object' && process && typeof process.nextTick === 'function') {
    nextTick = process.nextTick;
}

export { nextTick };
