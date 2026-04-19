'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('Transactions', {
            id: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true,
                allowNull: false,
            },
            userId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: 'Users', key: 'uid' },
                onDelete: 'CASCADE',
            },
            accountId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: { model: 'BankAccounts', key: 'id' },
                onDelete: 'CASCADE',
            },
            categoryId: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: 'Categories', key: 'id' },
                onDelete: 'SET NULL',
            },
            paymentMethodId: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: 'PaymentMethods', key: 'id' },
                onDelete: 'SET NULL',
            },
            amount: {
                type: Sequelize.DECIMAL(15, 2),
                allowNull: false,
            },
            type: {
                type: Sequelize.ENUM('income', 'expense', 'transfer'),
                allowNull: false,
            },
            date: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW,
            },
            note: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            isChecked: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            createdAt: {
                type: Sequelize.DATE,
                allowNull: false,
            },
            updatedAt: {
                type: Sequelize.DATE,
                allowNull: false,
            },
        });

        await queryInterface.addIndex('Transactions', ['userId']);
        await queryInterface.addIndex('Transactions', ['accountId']);
        await queryInterface.addIndex('Transactions', ['date']);
        await queryInterface.addIndex('Transactions', ['userId', 'date']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('Transactions');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Transactions_type";');
    },
};
