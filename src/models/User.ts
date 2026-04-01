import {DataTypes, Model, type Optional} from 'sequelize';
import sequelize from '../config/database.js';
import {hashPassword} from "../utils/password.js";

export interface NotificationPrefs {
    paymentApplied?: boolean;
    lowBalance?: boolean;
    monthlyRecap?: boolean;
    activityReminder?: boolean;
}

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
    emailVerifiedAt?: Date | null;
    emailVerificationCode?: string | null;
    passwordResetCode?: string | null;
    passwordResetExpires?: Date | null;
    notificationPrefs?: NotificationPrefs | null;
}

interface UserCreationAttributes extends Optional<UserAttributes, 'uid' | 'hasCompletedSetup'> {}

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
    declare uid: string;
    declare username: string;
    declare email: string;
    declare password?: string;
    declare googleId?: string;
    declare refreshToken?: string | null;
    declare fcmToken: string | null;
    declare hasCompletedSetup: boolean;
    declare photoUrl: string | null;
    declare emailVerifiedAt: Date | null;
    declare emailVerificationCode: string | null;
    declare passwordResetCode: string | null;
    declare passwordResetExpires: Date | null;
    declare notificationPrefs: NotificationPrefs | null;
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
    emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    emailVerificationCode: { type: DataTypes.STRING(6), allowNull: true },
    passwordResetCode: { type: DataTypes.STRING(6), allowNull: true },
    passwordResetExpires: { type: DataTypes.DATE, allowNull: true },
    notificationPrefs: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
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