'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('MonthlyPayments', {
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
            name: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            amount: {
                type: Sequelize.DECIMAL(15, 2),
                allowNull: false,
            },
            type: {
                type: Sequelize.ENUM('income', 'expense'),
                allowNull: false,
            },
            dayOfMonth: {
                type: Sequelize.INTEGER,
                allowNull: false,
            },
            lastProcessed: {
                type: Sequelize.DATE,
                allowNull: true,
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

        await queryInterface.addIndex('MonthlyPayments', ['userId']);
        await queryInterface.addIndex('MonthlyPayments', ['accountId']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('MonthlyPayments');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_MonthlyPayments_type";');
    },
};
