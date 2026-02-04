import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';

interface MonthlyPaymentAttributes {
    id: number;
    userId: number;
    accountId: number;
    categoryId: number | null;
    paymentMethodId: number | null;
    name: string;
    amount: number;
    type: 'income' | 'expense';
    dayOfMonth: number;
    lastProcessed: Date | null;
}

export interface MonthlyPaymentCreationAttributes extends Optional<MonthlyPaymentAttributes, 'id' | 'lastProcessed'> {}

class MonthlyPayment extends Model<MonthlyPaymentAttributes, MonthlyPaymentCreationAttributes> implements MonthlyPaymentAttributes {
    declare id: number;
    declare userId: number;
    declare accountId: number;
    declare categoryId: number | null;
    declare paymentMethodId: number | null;
    declare name: string;
    declare amount: number;
    declare type: 'income' | 'expense';
    declare dayOfMonth: number;
    declare lastProcessed: Date | null;
}

MonthlyPayment.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    categoryId: { type: DataTypes.INTEGER, allowNull: true },
    paymentMethodId: { type: DataTypes.INTEGER, allowNull: true },
    name: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    type: { type: DataTypes.ENUM('income', 'expense'), allowNull: false },
    dayOfMonth: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 31 } },
    lastProcessed: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'MonthlyPayment' });

export default MonthlyPayment;