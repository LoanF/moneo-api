import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'node:events';

import sequelize from './config/database.js';
import authRoutes from './routes/auth.js';
import './models/User'

import pkg from '../package.json' with { type: 'json' };

const app = new OpenAPIHono();
const eventBus = new EventEmitter();
const port = Number(process.env.PORT) || 3000;

app.use('*', logger());
app.use('*', cors({ origin: '*' }));

const emitChange = (type: string, instance: any) => {
  eventBus.emit('db_change', {
    type,
    model: instance.constructor.name,
    data: instance
  });
};

sequelize.addHook('afterCreate', (instance) => emitChange('CREATE', instance));
sequelize.addHook('afterUpdate', (instance) => emitChange('UPDATE', instance));
sequelize.addHook('afterDestroy', (instance) => emitChange('DELETE', instance));

app.get('/api-docs', swaggerUI({ url: '/api-docs/openapi.json' }));
app.doc('/api-docs/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Moneo API',
    version: pkg.version,
    description: 'API Real-time avec Hono et Zod-OpenAPI',
  },
  servers: [
    {
      url: `http://localhost:${port}`,
      description: 'Serveur local',
    },
  ],
});

app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

app.get('/', (c) => c.text('Moneo API is Live (Hono Edition)'));

app.route('/api/auth', authRoutes);

app.get('/api/realtime', async (c) => {
  return streamSSE(c, async (stream) => {
    let isAborted = false;
    const listener = (payload: any) => {
      if (!isAborted) {
        stream.writeSSE({
          data: JSON.stringify(payload),
          event: 'message',
        });
      }
    };

    eventBus.on('db_change', listener);

    stream.onAbort(() => {
      isAborted = true;
      eventBus.off('db_change', listener);
      console.log("🔌 Client déconnecté du flux SSE");
    });

    while (!isAborted) {
      await stream.sleep(30000);

      try {
        if (!isAborted) {
          await stream.writeSSE({ data: 'heartbeat' });
        }
      } catch (e) {
        isAborted = true;
        break;
      }
    }
  });
});

const startServer = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    console.log(`🚀 Server & Real-time SSE running on port ${port}`);

    serve({
      fetch: app.fetch,
      port
    });
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

startServer();