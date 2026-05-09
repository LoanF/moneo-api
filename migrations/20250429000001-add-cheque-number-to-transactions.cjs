'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const tableDescription = await queryInterface.describeTable('Transactions');
        if (!tableDescription.chequeNumber) {
            await queryInterface.addColumn('Transactions', 'chequeNumber', {
                type: Sequelize.STRING,
                allowNull: true,
                defaultValue: null,
            });
        }
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('Transactions', 'chequeNumber');
    },
};
