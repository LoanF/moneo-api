import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(
    process.env.POSTGRES_DB as string,
    process.env.POSTGRES_USER as string,
    process.env.POSTGRES_PASSWORD as string,
    {
        host: process.env.DB_HOST || 'db',
        dialect: 'postgres',
        logging: false,
    }
);

export default sequelize;