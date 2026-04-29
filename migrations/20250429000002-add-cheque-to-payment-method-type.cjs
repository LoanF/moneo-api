'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface) {
        await queryInterface.sequelize.query(
            `ALTER TYPE "enum_PaymentMethods_type" ADD VALUE IF NOT EXISTS 'cheque';`
        );
    },

    async down() {
        // Postgres ne supporte pas la suppression d'une valeur d'ENUM
    },
};
