import { serve } from '@hono/node-server';
import { OpenAPIHono } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
import { streamSSE } from 'hono/streaming';
import { EventEmitter } from 'node:events';

import sequelize from './config/database.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import categoryRoutes from './routes/category.js';

// Import models to register them with Sequelize
import './models/User.js'
import './models/Account.js';
import './models/Category.js';

import pkg from '../package.json' with { type: 'json' };

const app = new OpenAPIHono();
const eventBus = new EventEmitter();
const port = Number(process.env.PORT) || 3000;

app.use('*', logger());
app.use('*', cors({ origin: '*' }));

interface DBEvent {
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  model: string;
  data: any;
}

const emitChange = (type: string, instance: any) => {
  eventBus.emit('db_change', {
    type,
    model: instance.constructor.name,
    data: instance.toJSON ? instance.toJSON() : instance
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
  servers: [{ url: `http://localhost:${port}`, description: 'Serveur' }],
});

app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

app.get('/', (c) => c.text('Moneo API is Live'));
app.route('/api/auth', authRoutes);
app.route('/api/accounts', accountRoutes);
app.route('/api/categories', categoryRoutes);

app.get('/api/realtime', async (c) => {
  return streamSSE(c, async (stream) => {
    const listener = (payload: DBEvent) => {
      stream.writeSSE({
        data: JSON.stringify(payload),
        event: 'message',
      });
    };

    eventBus.on('db_change', listener);

    stream.onAbort(() => {
      eventBus.off('db_change', listener);
    });

    while (true) {
      await stream.sleep(30000);
      try {
        await stream.writeSSE({ data: 'heartbeat', event: 'ping' });
      } catch {
        break;
      }
    }
  });
});

const startServer = async () => {
  try {
    await sequelize.authenticate();

    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
    }

    console.log(`🚀 Server & Real-time SSE running on port ${port}`);

    const server = serve({
      fetch: app.fetch,
      port
    });

    const shutdown = async () => {
      console.log('🛑 Arrêt du serveur...');
      await sequelize.close();
      server.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

startServer();