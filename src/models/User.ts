import {DataTypes, Model, type Optional} from 'sequelize';
import sequelize from '../config/database.js';
import {hashPassword} from "../utils/password.js";

interface UserAttributes {
    uid: string;
    username: string;
    email: string;
    password?: string;
    googleId?: string;
    refreshToken?: string | null;
    fcmToken?: string | null;
    hasCompletedSetup: boolean;
    photoUrl?: string | null;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'uid' | 'hasCompletedSetup'> {}

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
    declare uid: string;
    declare username: string;
    declare email: string;
    declare password?: string;
    declare googleId?: string;
    declare refreshToken?: string;
    declare fcmToken: string | null;
    declare hasCompletedSetup: boolean;
    declare photoUrl: string | null;
}

User.init({
    uid: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
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

User.addHook('beforeSave', async (user: User) => {
    if (user.changed('password') && user.password) {
        user.password = await hashPassword(user.password);
    }
});

export default User;