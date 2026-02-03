import {DataTypes, Model, type Optional} from 'sequelize';
import sequelize from '../config/database.js';

interface UserAttributes {
    id: number;
    username: string;
    email: string;
    password?: string;
    googleId?: string;
    refreshToken?: string | null;
    fcmToken?: string | null;
    hasCompletedSetup: boolean;
    photoUrl?: string | null;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'hasCompletedSetup'> {}

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
    declare id: number;
    declare username: string;
    declare email: string;
    declare password?: string;
    declare googleId?: string;
    declare refreshToken?: string;
    declare fcmToken: string | null;
    declare hasCompletedSetup: boolean;
    declare photoUrl: string | null;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

User.init({
    id: {type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true},
    username: {type: DataTypes.STRING, allowNull: false},
    email: {type: DataTypes.STRING, unique: true, allowNull: false},
    password: {type: DataTypes.STRING, allowNull: true},
    googleId: {type: DataTypes.STRING, unique: true},
    refreshToken: {type: DataTypes.TEXT, allowNull: true},
    fcmToken: { type: DataTypes.STRING, allowNull: true },
    hasCompletedSetup: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
    photoUrl: { type: DataTypes.STRING, allowNull: true },
}, {
    sequelize,
    modelName: 'User',
});

export default User;