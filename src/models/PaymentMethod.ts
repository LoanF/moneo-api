import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

interface PaymentMethodAttributes {
    id: string;
    name: string;
    type: 'credit' | 'debit' | 'cash' | 'transfer' | 'cheque';
    userId: string;
}

export interface PaymentMethodCreationAttributes extends Optional<PaymentMethodAttributes, 'id'> {}

class PaymentMethod extends Model<PaymentMethodAttributes, PaymentMethodCreationAttributes> implements PaymentMethodAttributes {
    declare id: string;
    declare name: string;
    declare type: 'credit' | 'debit' | 'cash' | 'transfer' | 'cheque';
    declare userId: string;
}

PaymentMethod.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: {
        type: DataTypes.ENUM('credit', 'debit', 'cash', 'transfer', 'cheque'),
        allowNull: false,
        defaultValue: 'debit'
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'uid' }
    },
}, { sequelize, modelName: 'PaymentMethod' });

User.hasMany(PaymentMethod, { foreignKey: 'userId', as: 'paymentMethods' });
PaymentMethod.belongsTo(User, { foreignKey: 'userId' });

export default PaymentMethod;