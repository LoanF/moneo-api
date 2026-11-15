import { Sequelize } from 'sequelize';
import { env } from './env.js';

const common = {
    dialect: 'postgres' as const,
    logging: false as const,
    dialectOptions: env.DB_SSL ? { ssl: { rejectUnauthorized: false } } : {},
    pool: { max: 10, min: 0, idle: 10_000 },
};

const sequelize = env.DATABASE_URL
    ? new Sequelize(env.DATABASE_URL, common)
    : new Sequelize(env.POSTGRES_DB ?? 'moneo', env.POSTGRES_USER ?? 'moneo', env.POSTGRES_PASSWORD ?? '', {
          ...common,
          host: env.DB_HOST,
          port: env.DB_PORT,
      });

export default sequelize;
