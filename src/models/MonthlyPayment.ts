import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';
import Category from './Category.js';

interface MonthlyPaymentAttributes {
    id: number;
    userId: number;
    categoryId: number;
    name: string;
    amount: number;
    dayOfMonth: number;
    type: 'credit' | 'debit';
    lastAppliedMonth: Date | null;
}

export interface MonthlyPaymentCreationAttributes extends Optional<MonthlyPaymentAttributes, 'id' | 'lastAppliedMonth'> {}

class MonthlyPayment extends Model<MonthlyPaymentAttributes, MonthlyPaymentCreationAttributes> implements MonthlyPaymentAttributes {
    declare id: number;
    declare userId: number;
    declare categoryId: number;
    declare name: string;
    declare amount: number;
    declare dayOfMonth: number;
    declare type: 'credit' | 'debit';
    declare lastAppliedMonth: Date | null;
}

MonthlyPayment.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
    },
    categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Categories', key: 'id' }
    },
    name: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    dayOfMonth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 31 }
    },
    type: {
        type: DataTypes.ENUM('credit', 'debit'),
        allowNull: false
    },
    lastAppliedMonth: { type: DataTypes.DATE, allowNull: true }
}, { sequelize, modelName: 'MonthlyPayment' });

User.hasMany(MonthlyPayment, { foreignKey: 'userId', as: 'monthlyPayments' });
MonthlyPayment.belongsTo(User, { foreignKey: 'userId' });
Category.hasMany(MonthlyPayment, { foreignKey: 'categoryId', as: 'monthlyPayments' });
MonthlyPayment.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });

export default MonthlyPayment;