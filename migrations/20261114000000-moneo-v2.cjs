'use strict';

/**
 * Schéma Moneo v2 — base de référence.
 *
 * ATTENTION : cette migration SUPPRIME les tables de la v1 (aucune reprise de données,
 * décision assumée lors de la refonte). L'historique se réimporte via POST /data/import.
 */

const V1_TABLES = ['Transactions', 'MonthlyPayments', 'PaymentMethods', 'Categories', 'BankAccounts', 'Users'];
const V1_ENUMS = ['enum_Transactions_type', 'enum_MonthlyPayments_type', 'enum_PaymentMethods_type'];

const V2_TABLES = [
    'notifications',
    'budgets',
    'transactions',
    'recurring_payments',
    'chequebooks',
    'payment_methods',
    'categories',
    'bank_accounts',
    'verification_codes',
    'sessions',
    'users',
];

const TIMESTAMPS = `created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()`;

const UP = [
    `CREATE TABLE users (
        id uuid PRIMARY KEY,
        username varchar(60) NOT NULL,
        email varchar(255) NOT NULL UNIQUE,
        password_hash text,
        google_id varchar(255) UNIQUE,
        photo_url text,
        email_verified_at timestamptz,
        has_completed_setup boolean NOT NULL DEFAULT false,
        settings jsonb NOT NULL DEFAULT '{}',
        notification_prefs jsonb NOT NULL DEFAULT '{}',
        ${TIMESTAMPS}
    )`,
    `CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash char(64) NOT NULL UNIQUE,
        previous_token_hash char(64),
        rotated_at timestamptz,
        device_name varchar(120),
        platform varchar(30),
        fcm_token text,
        ip varchar(64),
        user_agent varchar(255),
        last_used_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX sessions_user_idx ON sessions (user_id)`,
    `CREATE TABLE verification_codes (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose varchar(30) NOT NULL,
        code_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        consumed_at timestamptz,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX verification_codes_user_idx ON verification_codes (user_id, purpose)`,
    `CREATE TABLE bank_accounts (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name varchar(80) NOT NULL,
        type varchar(30) NOT NULL DEFAULT 'checking',
        initial_balance numeric(15,2) NOT NULL DEFAULT 0,
        currency char(3) NOT NULL DEFAULT 'EUR',
        sort_order integer NOT NULL DEFAULT 0,
        icon_code varchar(60),
        color_value bigint,
        low_balance_threshold numeric(15,2),
        include_in_total boolean NOT NULL DEFAULT true,
        archived_at timestamptz,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX bank_accounts_user_idx ON bank_accounts (user_id, sort_order)`,
    `CREATE TABLE categories (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name varchar(80) NOT NULL,
        icon_code varchar(60) NOT NULL DEFAULT 'category',
        color_value bigint NOT NULL DEFAULT 4284513675,
        parent_id uuid REFERENCES categories(id) ON DELETE CASCADE,
        sort_order integer NOT NULL DEFAULT 0,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX categories_user_idx ON categories (user_id, parent_id)`,
    `CREATE TABLE payment_methods (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name varchar(80) NOT NULL,
        kind varchar(30) NOT NULL DEFAULT 'card',
        default_direction varchar(10) NOT NULL DEFAULT 'expense' CHECK (default_direction IN ('income', 'expense')),
        sort_order integer NOT NULL DEFAULT 0,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX payment_methods_user_idx ON payment_methods (user_id)`,
    `CREATE TABLE chequebooks (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
        name varchar(80) NOT NULL,
        next_number integer NOT NULL DEFAULT 1,
        is_active boolean NOT NULL DEFAULT true,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX chequebooks_user_idx ON chequebooks (user_id)`,
    `CREATE TABLE recurring_payments (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
        category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
        payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
        name varchar(160) NOT NULL,
        amount numeric(15,2) NOT NULL CHECK (amount >= 0),
        type varchar(10) NOT NULL CHECK (type IN ('income', 'expense')),
        day_of_month smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
        monthly_amounts jsonb,
        is_active boolean NOT NULL DEFAULT true,
        start_period varchar(7),
        end_period varchar(7),
        last_generated_period varchar(7),
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX recurring_payments_user_idx ON recurring_payments (user_id)`,
    `CREATE TABLE transactions (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
        category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
        payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
        chequebook_id uuid REFERENCES chequebooks(id) ON DELETE SET NULL,
        cheque_number varchar(20),
        amount numeric(15,2) NOT NULL,
        type varchar(10) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
        date date NOT NULL,
        note varchar(255),
        is_checked boolean NOT NULL DEFAULT false,
        checked_at timestamptz,
        transfer_id uuid,
        counterparty varchar(120),
        recurring_payment_id uuid REFERENCES recurring_payments(id) ON DELETE SET NULL,
        recurring_period varchar(7),
        source varchar(20) NOT NULL DEFAULT 'manual',
        ${TIMESTAMPS},
        deleted_at timestamptz
    )`,
    `CREATE INDEX transactions_user_date_idx ON transactions (user_id, date DESC, created_at DESC)`,
    `CREATE INDEX transactions_account_date_idx ON transactions (account_id, date)`,
    `CREATE INDEX transactions_user_updated_idx ON transactions (user_id, updated_at)`,
    `CREATE INDEX transactions_transfer_idx ON transactions (transfer_id) WHERE transfer_id IS NOT NULL`,
    `CREATE INDEX transactions_category_idx ON transactions (category_id) WHERE category_id IS NOT NULL`,
    // Garde-fou d'idempotence : une mensualité ne produit qu'une écriture par mois.
    `CREATE UNIQUE INDEX transactions_recurring_period_uq ON transactions (recurring_payment_id, recurring_period)
        WHERE recurring_payment_id IS NOT NULL`,
    `CREATE TABLE budgets (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
        amount numeric(15,2) NOT NULL CHECK (amount > 0),
        alert_threshold smallint NOT NULL DEFAULT 80 CHECK (alert_threshold BETWEEN 1 AND 100),
        ${TIMESTAMPS}
    )`,
    `CREATE UNIQUE INDEX budgets_user_category_uq ON budgets (user_id, category_id) WHERE category_id IS NOT NULL`,
    `CREATE UNIQUE INDEX budgets_user_global_uq ON budgets (user_id) WHERE category_id IS NULL`,
    `CREATE TABLE notifications (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type varchar(40) NOT NULL,
        title varchar(160) NOT NULL,
        body text NOT NULL,
        data jsonb,
        dedup_key varchar(160),
        read_at timestamptz,
        ${TIMESTAMPS}
    )`,
    `CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC)`,
    `CREATE UNIQUE INDEX notifications_dedup_uq ON notifications (user_id, dedup_key) WHERE dedup_key IS NOT NULL`,
];

module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
            for (const table of V1_TABLES) await run(`DROP TABLE IF EXISTS "${table}" CASCADE`);
            for (const type of V1_ENUMS) await run(`DROP TYPE IF EXISTS "${type}" CASCADE`);
            for (const statement of UP) await run(statement);
        });
    },

    async down(queryInterface) {
        await queryInterface.sequelize.transaction(async (transaction) => {
            for (const table of V2_TABLES) {
                await queryInterface.sequelize.query(`DROP TABLE IF EXISTS ${table} CASCADE`, { transaction });
            }
        });
    },
};
