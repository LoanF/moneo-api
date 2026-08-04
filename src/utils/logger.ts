import pino from 'pino';
import { Sentry } from '../config/sentry.js';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    hooks: {
        logMethod(args, method, level) {
            if (level >= 50) {
                const err = args.find((a) => a instanceof Error);
                if (err) Sentry.captureException(err);
            }
            return method.apply(this, args);
        },
    },
});
