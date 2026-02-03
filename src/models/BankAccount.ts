import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

interface BankAccountAttributes {
    id: number;
    userId: number;
    name: string;
    type: string;
    balance: number;
    currency: string;
}

interface BankAccountCreationAttributes extends Optional<BankAccountAttributes, 'id' | 'balance' | 'currency'> {}

class BankAccount extends Model<BankAccountAttributes, BankAccountCreationAttributes> implements BankAccountAttributes {
    public id!: number;
    public userId!: number;
    public name!: string;
    public type!: string;
    public balance!: number;
    public currency!: string;
}

BankAccount.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: User, key: 'id' }
    },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'checking' },
    balance: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'EUR' },
}, {
    sequelize,
    modelName: 'BankAccount',
});

User.hasMany(BankAccount, { foreignKey: 'userId', as: 'accounts' });
BankAccount.belongsTo(User, { foreignKey: 'userId', as: 'owner' });

export default BankAccount;