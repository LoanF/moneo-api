'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('PaymentMethods', {
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
            name: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            type: {
                type: Sequelize.ENUM('credit', 'debit', 'cash', 'transfer'),
                allowNull: false,
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

        await queryInterface.addIndex('PaymentMethods', ['userId']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('PaymentMethods');
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_PaymentMethods_type";');
    },
};
