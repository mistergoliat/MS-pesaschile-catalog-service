import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['req.headers.x-api-key', 'req.headers.authorization', 'db.password', 'config.apiKeys'],
    censor: '[REDACTED]',
  },
});
