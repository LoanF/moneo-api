'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('BankAccounts', {
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
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: 'checking',
            },
            balance: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0,
            },
            currency: {
                type: Sequelize.STRING(3),
                allowNull: false,
                defaultValue: 'EUR',
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

        await queryInterface.addIndex('BankAccounts', ['userId']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('BankAccounts');
    },
};
