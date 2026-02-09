import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';

interface MonthlyPaymentAttributes {
    id: string;
    userId: string;
    accountId: string;
    categoryId: string | null;
    paymentMethodId: string | null;
    name: string;
    amount: number;
    type: 'income' | 'expense';
    dayOfMonth: number;
    lastProcessed: Date | null;
}

export interface MonthlyPaymentCreationAttributes extends Optional<MonthlyPaymentAttributes, 'id' | 'lastProcessed'> {}

class MonthlyPayment extends Model<MonthlyPaymentAttributes, MonthlyPaymentCreationAttributes> implements MonthlyPaymentAttributes {
    declare id: string;
    declare userId: string;
    declare accountId: string;
    declare categoryId: string | null;
    declare paymentMethodId: string | null;
    declare name: string;
    declare amount: number;
    declare type: 'income' | 'expense';
    declare dayOfMonth: number;
    declare lastProcessed: Date | null;
}

MonthlyPayment.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    accountId: { type: DataTypes.UUID, allowNull: false },
    categoryId: { type: DataTypes.UUID, allowNull: true },
    paymentMethodId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    type: { type: DataTypes.ENUM('income', 'expense'), allowNull: false },
    dayOfMonth: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 31 } },
    lastProcessed: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'MonthlyPayment' });

export default MonthlyPayment;