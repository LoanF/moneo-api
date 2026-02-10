import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

interface BankAccountAttributes {
    id: string;
    userId: string;
    name: string;
    type: string;
    balance: number;
    currency: string;
}

interface BankAccountCreationAttributes extends Optional<BankAccountAttributes, 'id' | 'balance' | 'currency'> {}

class BankAccount extends Model<BankAccountAttributes, BankAccountCreationAttributes> implements BankAccountAttributes {
    public id!: string;
    public userId!: string;
    public name!: string;
    public type!: string;
    public balance!: number;
    public currency!: string;
}

BankAccount.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'uid' }
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