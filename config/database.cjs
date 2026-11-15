'use strict';

// Configuration de sequelize-cli (migrations). Le SSL se pilote par DB_SSL=true,
// quel que soit l'environnement : une base Docker locale n'en a pas, une base managée oui.
const ssl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';
const dialectOptions = ssl ? { ssl: { rejectUnauthorized: false } } : {};

const config = process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL, dialect: 'postgres', dialectOptions }
    : {
          username: process.env.POSTGRES_USER,
          password: process.env.POSTGRES_PASSWORD,
          database: process.env.POSTGRES_DB,
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          dialect: 'postgres',
          dialectOptions,
      };

module.exports = { development: config, test: config, production: config };
