import {
    DataTypes,
    Model,
    type CreationOptional,
    type InferAttributes,
    type InferCreationAttributes,
    type ModelAttributeColumnOptions,
} from 'sequelize';
import sequelize from '../config/database.js';

// ── Helpers de colonnes ──────────────────────────────────────────────────────

const uuidPk = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true } as const;

/** NUMERIC(15,2) exposé en `number` (pg renvoie des chaînes pour ne pas perdre de précision). */
const money = (field: string, opts: Partial<ModelAttributeColumnOptions> = {}): ModelAttributeColumnOptions => ({
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    ...opts,
    get(this: Model) {
        const raw = this.getDataValue(field);
        return raw === null || raw === undefined ? null : Number(raw);
    },
});

const bigintNumber = (field: string, opts: Partial<ModelAttributeColumnOptions> = {}): ModelAttributeColumnOptions => ({
    type: DataTypes.BIGINT,
    ...opts,
    get(this: Model) {
        const raw = this.getDataValue(field);
        return raw === null || raw === undefined ? null : Number(raw);
    },
});

const base = { sequelize, underscored: true } as const;

// ── Types métier ─────────────────────────────────────────────────────────────

export type RecurringMode = 'month_start' | 'due_date' | 'manual';

export type UserSettings = {
    currency?: string;
    /** Premier jour du mois budgétaire (1–28). */
    monthStartDay?: number;
    defaultAccountId?: string | null;
    /** Saisie rapide : ne pas s'arrêter sur la note (option « Libellé libre » du classeur). */
    skipNote?: boolean;
    /** Date de début de suivi : une saisie antérieure demande confirmation. */
    trackingStartDate?: string | null;
    /** `month_start` reproduit la mensualisation Excel : tout le mois est généré d'un coup. */
    recurringMode?: RecurringMode;
    /** Seuil de solde bas par défaut, utilisé quand le compte n'a pas le sien. */
    lowBalanceThreshold?: number | null;
};

export type NotificationPrefs = {
    paymentApplied?: boolean;
    lowBalance?: boolean;
    monthlyRecap?: boolean;
    activityReminder?: boolean;
    budgetAlert?: boolean;
    upcomingPayment?: boolean;
    /** Heures calmes `HH:MM` : pas de push, la notification reste visible dans l'app. */
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
};

export type TransactionType = 'income' | 'expense' | 'transfer';
export type PaymentKind = 'card' | 'cheque' | 'direct_debit' | 'transfer' | 'cash' | 'other';

// ── Modèles ──────────────────────────────────────────────────────────────────

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare id: CreationOptional<string>;
    declare username: string;
    declare email: string;
    declare passwordHash: CreationOptional<string | null>;
    declare googleId: CreationOptional<string | null>;
    declare photoUrl: CreationOptional<string | null>;
    declare emailVerifiedAt: CreationOptional<Date | null>;
    declare hasCompletedSetup: CreationOptional<boolean>;
    declare settings: CreationOptional<UserSettings>;
    declare notificationPrefs: CreationOptional<NotificationPrefs>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
User.init(
    {
        id: uuidPk,
        username: { type: DataTypes.STRING(60), allowNull: false },
        email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
        passwordHash: { type: DataTypes.TEXT, allowNull: true },
        googleId: { type: DataTypes.STRING(255), allowNull: true, unique: true },
        photoUrl: { type: DataTypes.TEXT, allowNull: true },
        emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
        hasCompletedSetup: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        notificationPrefs: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'users' },
);

export class Session extends Model<InferAttributes<Session>, InferCreationAttributes<Session>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare tokenHash: string;
    declare previousTokenHash: CreationOptional<string | null>;
    declare rotatedAt: CreationOptional<Date | null>;
    declare deviceName: CreationOptional<string | null>;
    declare platform: CreationOptional<string | null>;
    declare fcmToken: CreationOptional<string | null>;
    declare ip: CreationOptional<string | null>;
    declare userAgent: CreationOptional<string | null>;
    declare lastUsedAt: Date;
    declare expiresAt: Date;
    declare revokedAt: CreationOptional<Date | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
Session.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
        previousTokenHash: { type: DataTypes.CHAR(64), allowNull: true },
        rotatedAt: { type: DataTypes.DATE, allowNull: true },
        deviceName: { type: DataTypes.STRING(120), allowNull: true },
        platform: { type: DataTypes.STRING(30), allowNull: true },
        fcmToken: { type: DataTypes.TEXT, allowNull: true },
        ip: { type: DataTypes.STRING(64), allowNull: true },
        userAgent: { type: DataTypes.STRING(255), allowNull: true },
        lastUsedAt: { type: DataTypes.DATE, allowNull: false },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        revokedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'sessions' },
);

export type CodePurpose = 'email_verify' | 'password_reset';

export class VerificationCode extends Model<InferAttributes<VerificationCode>, InferCreationAttributes<VerificationCode>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare purpose: CodePurpose;
    declare codeHash: string;
    declare expiresAt: Date;
    declare attempts: CreationOptional<number>;
    declare consumedAt: CreationOptional<Date | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
VerificationCode.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        purpose: { type: DataTypes.STRING(30), allowNull: false },
        codeHash: { type: DataTypes.CHAR(64), allowNull: false },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        consumedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'verification_codes' },
);

export class BankAccount extends Model<InferAttributes<BankAccount>, InferCreationAttributes<BankAccount>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare name: string;
    declare type: CreationOptional<string>;
    declare initialBalance: CreationOptional<number>;
    declare currency: CreationOptional<string>;
    declare sortOrder: CreationOptional<number>;
    declare iconCode: CreationOptional<string | null>;
    declare colorValue: CreationOptional<number | null>;
    declare lowBalanceThreshold: CreationOptional<number | null>;
    declare includeInTotal: CreationOptional<boolean>;
    declare archivedAt: CreationOptional<Date | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
BankAccount.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        name: { type: DataTypes.STRING(80), allowNull: false },
        type: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'checking' },
        initialBalance: money('initialBalance', { defaultValue: 0 }),
        currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'EUR' },
        sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        iconCode: { type: DataTypes.STRING(60), allowNull: true },
        colorValue: bigintNumber('colorValue', { allowNull: true }),
        lowBalanceThreshold: money('lowBalanceThreshold', { allowNull: true }),
        includeInTotal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        archivedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'bank_accounts' },
);

export class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare name: string;
    declare iconCode: CreationOptional<string>;
    declare colorValue: CreationOptional<number>;
    declare parentId: CreationOptional<string | null>;
    declare sortOrder: CreationOptional<number>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
Category.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        name: { type: DataTypes.STRING(80), allowNull: false },
        iconCode: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'category' },
        colorValue: bigintNumber('colorValue', { allowNull: false, defaultValue: 0xff607d8b }),
        parentId: { type: DataTypes.UUID, allowNull: true },
        sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'categories' },
);

export class PaymentMethod extends Model<InferAttributes<PaymentMethod>, InferCreationAttributes<PaymentMethod>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare name: string;
    declare kind: CreationOptional<PaymentKind>;
    /** Sens présélectionné à la saisie (colonne « Par défaut » du classeur). */
    declare defaultDirection: CreationOptional<'income' | 'expense'>;
    declare sortOrder: CreationOptional<number>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
PaymentMethod.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        name: { type: DataTypes.STRING(80), allowNull: false },
        kind: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'card' },
        defaultDirection: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'expense' },
        sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'payment_methods' },
);

export class Chequebook extends Model<InferAttributes<Chequebook>, InferCreationAttributes<Chequebook>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare accountId: CreationOptional<string | null>;
    declare name: string;
    /** Numéro qui sera attribué au prochain chèque émis. */
    declare nextNumber: CreationOptional<number>;
    declare isActive: CreationOptional<boolean>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
Chequebook.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        accountId: { type: DataTypes.UUID, allowNull: true },
        name: { type: DataTypes.STRING(80), allowNull: false },
        nextNumber: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'chequebooks' },
);

export class RecurringPayment extends Model<InferAttributes<RecurringPayment>, InferCreationAttributes<RecurringPayment>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare accountId: string;
    declare categoryId: CreationOptional<string | null>;
    declare paymentMethodId: CreationOptional<string | null>;
    declare name: string;
    /** Montant positif ; le signe vient de `type`. */
    declare amount: number;
    declare type: 'income' | 'expense';
    declare dayOfMonth: number;
    /** Exceptions par mois : `{ "12": 85.41 }`. Une valeur `0` saute le mois. */
    declare monthlyAmounts: CreationOptional<Record<string, number> | null>;
    declare isActive: CreationOptional<boolean>;
    declare startPeriod: CreationOptional<string | null>;
    declare endPeriod: CreationOptional<string | null>;
    declare lastGeneratedPeriod: CreationOptional<string | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
RecurringPayment.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        accountId: { type: DataTypes.UUID, allowNull: false },
        categoryId: { type: DataTypes.UUID, allowNull: true },
        paymentMethodId: { type: DataTypes.UUID, allowNull: true },
        name: { type: DataTypes.STRING(160), allowNull: false },
        amount: money('amount'),
        type: { type: DataTypes.STRING(10), allowNull: false },
        dayOfMonth: { type: DataTypes.SMALLINT, allowNull: false },
        monthlyAmounts: { type: DataTypes.JSONB, allowNull: true },
        isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        startPeriod: { type: DataTypes.STRING(7), allowNull: true },
        endPeriod: { type: DataTypes.STRING(7), allowNull: true },
        lastGeneratedPeriod: { type: DataTypes.STRING(7), allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'recurring_payments' },
);

export class Transaction extends Model<InferAttributes<Transaction>, InferCreationAttributes<Transaction>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare accountId: string;
    declare categoryId: CreationOptional<string | null>;
    declare paymentMethodId: CreationOptional<string | null>;
    declare chequebookId: CreationOptional<string | null>;
    declare chequeNumber: CreationOptional<string | null>;
    /** Montant signé : négatif = sortie du compte, positif = entrée. */
    declare amount: number;
    declare type: TransactionType;
    declare date: string;
    declare note: CreationOptional<string | null>;
    /** Pointage (colonne « P » du classeur). */
    declare isChecked: CreationOptional<boolean>;
    declare checkedAt: CreationOptional<Date | null>;
    /** Identifiant commun aux deux jambes d'un transfert entre comptes suivis. */
    declare transferId: CreationOptional<string | null>;
    /** Compte tiers non suivi pour un transfert externe. */
    declare counterparty: CreationOptional<string | null>;
    declare recurringPaymentId: CreationOptional<string | null>;
    declare recurringPeriod: CreationOptional<string | null>;
    declare source: CreationOptional<'manual' | 'recurring' | 'import'>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
    declare deletedAt: CreationOptional<Date | null>;
}
Transaction.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        accountId: { type: DataTypes.UUID, allowNull: false },
        categoryId: { type: DataTypes.UUID, allowNull: true },
        paymentMethodId: { type: DataTypes.UUID, allowNull: true },
        chequebookId: { type: DataTypes.UUID, allowNull: true },
        chequeNumber: { type: DataTypes.STRING(20), allowNull: true },
        amount: money('amount'),
        type: { type: DataTypes.STRING(10), allowNull: false },
        date: { type: DataTypes.DATEONLY, allowNull: false },
        note: { type: DataTypes.STRING(255), allowNull: true },
        isChecked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        checkedAt: { type: DataTypes.DATE, allowNull: true },
        transferId: { type: DataTypes.UUID, allowNull: true },
        counterparty: { type: DataTypes.STRING(120), allowNull: true },
        recurringPaymentId: { type: DataTypes.UUID, allowNull: true },
        recurringPeriod: { type: DataTypes.STRING(7), allowNull: true },
        source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual' },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
        deletedAt: DataTypes.DATE,
    },
    // Suppression logique : permet la synchronisation incrémentale des clients hors-ligne.
    { ...base, tableName: 'transactions', paranoid: true },
);

export class Budget extends Model<InferAttributes<Budget>, InferCreationAttributes<Budget>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    /** `null` = budget global sur toutes les dépenses. */
    declare categoryId: CreationOptional<string | null>;
    declare amount: number;
    /** Pourcentage à partir duquel une alerte est envoyée. */
    declare alertThreshold: CreationOptional<number>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
Budget.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        categoryId: { type: DataTypes.UUID, allowNull: true },
        amount: money('amount'),
        alertThreshold: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 80 },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'budgets' },
);

export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
    declare id: CreationOptional<string>;
    declare userId: string;
    declare type: string;
    declare title: string;
    declare body: string;
    declare data: CreationOptional<Record<string, string> | null>;
    declare dedupKey: CreationOptional<string | null>;
    declare readAt: CreationOptional<Date | null>;
    declare createdAt: CreationOptional<Date>;
    declare updatedAt: CreationOptional<Date>;
}
Notification.init(
    {
        id: uuidPk,
        userId: { type: DataTypes.UUID, allowNull: false },
        type: { type: DataTypes.STRING(40), allowNull: false },
        title: { type: DataTypes.STRING(160), allowNull: false },
        body: { type: DataTypes.TEXT, allowNull: false },
        data: { type: DataTypes.JSONB, allowNull: true },
        dedupKey: { type: DataTypes.STRING(160), allowNull: true },
        readAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
    },
    { ...base, tableName: 'notifications' },
);

// ── Associations ─────────────────────────────────────────────────────────────

User.hasMany(Session, { foreignKey: 'userId' });
Session.belongsTo(User, { foreignKey: 'userId' });
Transaction.belongsTo(BankAccount, { foreignKey: 'accountId', as: 'account' });
Transaction.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });
Category.hasMany(Category, { foreignKey: 'parentId', as: 'children' });

export { sequelize };
