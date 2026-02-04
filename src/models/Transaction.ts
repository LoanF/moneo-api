import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';
import BankAccount from './BankAccount.js';
import Category from './Category.js';

interface TransactionAttributes {
    id: number;
    userId: number;
    accountId: number;
    categoryId: number | null;
    paymentMethodId: number | null;
    amount: number;
    date: Date;
    note: string | null;
    type: 'income' | 'expense' | 'transfer';
    isChecked: boolean;
}

export interface TransactionCreationAttributes extends Optional<TransactionAttributes, 'id' | 'isChecked' | 'note'> {}

class Transaction extends Model<TransactionAttributes, TransactionCreationAttributes> implements TransactionAttributes {
    declare id: number;
    declare userId: number;
    declare accountId: number;
    declare categoryId: number | null;
    declare paymentMethodId: number | null;
    declare amount: number;
    declare date: Date;
    declare note: string | null;
    declare type: 'income' | 'expense' | 'transfer';
    declare isChecked: boolean;
}

Transaction.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' } },
    accountId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'BankAccounts', key: 'id' } },
    categoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Categories', key: 'id' } },
    paymentMethodId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'PaymentMethods', key: 'id' } },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    note: { type: DataTypes.STRING, allowNull: true },
    type: { type: DataTypes.ENUM('income', 'expense', 'transfer'), allowNull: false },
    isChecked: { type: DataTypes.BOOLEAN, defaultValue: false },
}, { sequelize, modelName: 'Transaction' });

User.hasMany(Transaction, { foreignKey: 'userId' });
BankAccount.hasMany(Transaction, { foreignKey: 'accountId' });
Transaction.belongsTo(BankAccount, { foreignKey: 'accountId', as: 'account' });
Transaction.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });

export default Transaction;