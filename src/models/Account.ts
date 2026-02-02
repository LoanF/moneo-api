import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

interface AccountAttributes {
    id: number;
    userId: number;
    name: string;
    type: string;
    balance: number;
    currency: string;
}

interface AccountCreationAttributes extends Optional<AccountAttributes, 'id' | 'balance' | 'currency'> {}

class Account extends Model<AccountAttributes, AccountCreationAttributes> implements AccountAttributes {
    public id!: number;
    public userId!: number;
    public name!: string;
    public type!: string;
    public balance!: number;
    public currency!: string;
}

Account.init({
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
    modelName: 'Account',
});

User.hasMany(Account, { foreignKey: 'userId', as: 'accounts' });
Account.belongsTo(User, { foreignKey: 'userId', as: 'owner' });

export default Account;