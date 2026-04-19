'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('Categories', {
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
            iconCode: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            colorValue: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            parentId: {
                type: Sequelize.UUID,
                allowNull: true,
                references: { model: 'Categories', key: 'id' },
                onDelete: 'SET NULL',
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

        await queryInterface.addIndex('Categories', ['userId']);
        await queryInterface.addIndex('Categories', ['parentId']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('Categories');
    },
};
