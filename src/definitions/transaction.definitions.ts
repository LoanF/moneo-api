import {createRoute, z} from '@hono/zod-openapi';
import {TransactionResponseSchema, CreateTransactionSchema, CreateTransferSchema} from '../schemas/transaction.schema.js';
import {ErrorSchema} from '../schemas/auth.schema.js';
import {GlobalStatsSchema} from "../schemas/statistics.schema.js";

export const listTransactionsRoute = createRoute({
    method: 'get',
    path: '/',
    summary: 'Lister les transactions',
    description: 'Récupère une liste paginée des transactions de l’utilisateur authentifié. Permet de filtrer l’historique par compte spécifique et renvoie le nombre total de résultats dans le header X-Total-Count.',
    tags: ['Transactions'],
    security: [{Bearer: []}],
    request: {
        query: z.object({
            limit: z.string().optional().default('20').openapi({description: 'Nombre maximum de résultats', example: '20'}),
            offset: z.string().optional().default('0').openapi({description: 'Nombre d’éléments à sauter', example: '0'}),
            accountId: z.string().optional().openapi({description: 'Identifiant du compte bancaire pour filtrer', example: '1'})
        })
    },
    responses: {
        200: {
            description: 'Liste paginée des transactions récupérée avec succès',
            headers: z.object({
                'X-Total-Count': z.string().openapi({description: 'Nombre total de transactions correspondant aux critères de recherche'})
            }),
            content: {
                'application/json': {schema: TransactionResponseSchema.array()}
            }
        }
    }
});

export const createTransactionRoute = createRoute({
    method: 'post',
    path: '/',
    summary: 'Créer une transaction',
    description: 'Enregistre une nouvelle transaction (revenu, dépense ou transfert) et met à jour automatiquement le solde du compte bancaire associé au sein d’une transaction SQL atomique.',
    tags: ['Transactions'],
    security: [{Bearer: []}],
    request: {body: {content: {'application/json': {schema: CreateTransactionSchema}}}},
    responses: {
        201: {content: {'application/json': {schema: TransactionResponseSchema}}, description: 'Transaction créée et solde mis à jour'},
        400: {content: {'application/json': {schema: ErrorSchema}}, description: 'Requête invalide ou erreur lors du traitement'},
        404: {content: {'application/json': {schema: ErrorSchema}}, description: 'Compte bancaire associé non trouvé'}
    }
});

export const deleteTransactionRoute = createRoute({
    method: 'delete',
    path: '/:id',
    summary: 'Supprimer une transaction',
    description: 'Supprime définitivement une transaction. Cette action annule l’impact financier de la transaction sur le solde du compte bancaire concerné (recalcul inverse).',
    tags: ['Transactions'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({
            id: z.string().openapi({ description: 'Identifiant unique de la transaction', example: '1' })
        })
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
            description: 'Transaction supprimée et solde rectifié avec succès'
        },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Transaction introuvable' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Échec de la suppression' }
    }
});

export const createTransferRoute = createRoute({
    method: 'post',
    path: '/transfer',
    summary: 'Effectuer un transfert entre comptes',
    description: 'Transfère un montant d’un compte à un autre en créant deux transactions liées et en mettant à jour les deux soldes simultanément.',
    tags: ['Transactions'],
    security: [{Bearer: []}],
    request: {body: {content: {'application/json': {schema: CreateTransferSchema}}}},
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({
                        fromTransaction: TransactionResponseSchema,
                        toTransaction: TransactionResponseSchema
                    }) } },
            description: 'Transfert réussi'
        },
        400: { content: {'application/json': {schema: ErrorSchema}}, description: 'Erreur' },
        404: { content: {'application/json': {schema: ErrorSchema}}, description: 'Compte(s) introuvable(s)' }
    }
});

export const getStatsRoute = createRoute({
    method: 'get',
    path: '/stats',
    summary: 'Statistiques financières',
    description: 'Calcule le total des revenus et dépenses groupés par catégorie pour une période donnée.',
    tags: ['Transactions'],
    security: [{ Bearer: [] }],
    request: {
        query: z.object({
            startDate: z.string().optional().openapi({ description: 'Date de début (ISO)', example: '2024-01-01' }),
            endDate: z.string().optional().openapi({ description: 'Date de fin (ISO)', example: '2024-01-31' }),
            accountId: z.string().optional().openapi({ description: 'Filtrer pour un compte spécifique', example: '1' })
        })
    },
    responses: {
        200: {
            content: { 'application/json': { schema: GlobalStatsSchema } },
            description: 'Statistiques calculées'
        }
    }
});

export const updateTransactionSchema = CreateTransactionSchema.partial();

export const updateTransactionRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Transactions'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: updateTransactionSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: TransactionResponseSchema } }, description: 'Transaction mise à jour' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur de validation ou solde insuffisant' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvée' }
    }
});