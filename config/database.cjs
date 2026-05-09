'use strict';

function makeConfig(ssl) {
    if (process.env.DATABASE_URL) {
        return {
            url: process.env.DATABASE_URL,
            dialect: 'postgres',
            dialectOptions: ssl ? { ssl: { rejectUnauthorized: false } } : { ssl: false },
        };
    }
    return {
        username: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        dialectOptions: ssl ? { ssl: { rejectUnauthorized: false } } : { ssl: false },
    };
}

module.exports = {
    development: makeConfig(false),
    test: makeConfig(false),
    production: makeConfig(true),
};
