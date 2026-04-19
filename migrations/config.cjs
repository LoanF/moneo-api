'use strict';

module.exports = {
    development: {
        use_env_variable: 'DATABASE_URL',
        dialect: 'postgres',
        dialectOptions: { ssl: false },
    },
    test: {
        use_env_variable: 'DATABASE_URL',
        dialect: 'postgres',
        dialectOptions: { ssl: false },
    },
    production: {
        use_env_variable: 'DATABASE_URL',
        dialect: 'postgres',
        dialectOptions: {
            ssl: { rejectUnauthorized: false },
        },
    },
};
