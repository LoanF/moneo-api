import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

export const createRouter = (): OpenAPIHono<AppEnv> =>
    new OpenAPIHono<AppEnv>({
        defaultHook: (result, c) => {
            if (!result.success) {
                const messages = [...new Set(result.error.issues.map((i: any) => i.message))];
                return c.json({ error: messages.join(' • ') }, 400);
            }
        }
    });
