import { createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { badRequest } from '../lib/errors.js';
import { body, createRouter, errors, json, secured } from '../lib/http.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { ImportPayloadSchema, exportCsv, exportData, importData, parseComptesWorkbook } from '../services/importer.js';

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

const ReportSchema = z
    .object({
        accounts: z.number(),
        categories: z.number(),
        paymentMethods: z.number(),
        chequebooks: z.number(),
        recurringPayments: z.number(),
        transactions: z.number(),
        transfersPaired: z.number(),
        warnings: z.string().array(),
    })
    .openapi('ImportReport');

const ModeQuery = z.object({
    mode: z.enum(['merge', 'replace']).default('merge').openapi({ description: '`replace` efface d’abord toutes les données financières du compte' }),
});

const data = createRouter();
data.use('*', authMiddleware);
data.use('/import/*', rateLimit(10, 10 * 60 * 1000));
data.use('/import/*', bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: (c) => c.json({ error: 'Fichier trop volumineux (15 Mo maximum)' }, 413) }));
const tags = ['Import / export'];

data.openapi(
    createRoute({
        method: 'post',
        path: '/import/comptes',
        tags,
        summary: 'Importer le classeur de suivi « Comptes.xlsm » (comptes, catégories, mensualités, écritures)',
        security: secured,
        request: { query: ModeQuery, body: { content: { 'multipart/form-data': { schema: z.object({ file: z.any() }) } } } },
        responses: { 200: json(ReportSchema), ...errors },
    }),
    async (c) => {
        const { userId } = c.get('auth');
        const form = await c.req.parseBody();
        const file = form['file'];
        if (!(file instanceof File)) throw badRequest('Aucun fichier fourni');
        if (file.size > MAX_IMPORT_BYTES) throw badRequest('Fichier trop volumineux (15 Mo maximum)');

        const { payload, warnings } = parseComptesWorkbook(new Uint8Array(await file.arrayBuffer()));
        const report = await importData(userId, payload, c.req.valid('query').mode);
        return c.json({ ...report, warnings: [...warnings, ...report.warnings].slice(0, 50) }, 200);
    },
);

data.openapi(
    createRoute({
        method: 'post',
        path: '/import/json',
        tags,
        summary: 'Importer une sauvegarde JSON (format de l’export)',
        security: secured,
        request: { query: ModeQuery, ...body(ImportPayloadSchema) },
        responses: { 200: json(ReportSchema), ...errors },
    }),
    async (c) => c.json(await importData(c.get('auth').userId, c.req.valid('json'), c.req.valid('query').mode), 200),
);

data.openapi(
    createRoute({
        method: 'get',
        path: '/export',
        tags,
        summary: 'Exporter toutes ses données (JSON ré-importable, ou CSV des écritures)',
        security: secured,
        request: { query: z.object({ format: z.enum(['json', 'csv']).default('json') }) },
        responses: { 200: { description: 'Fichier d’export', content: { 'application/json': { schema: ImportPayloadSchema }, 'text/csv': { schema: z.string() } } }, ...errors },
    }),
    async (c) => {
        const { userId } = c.get('auth');
        const stamp = new Date().toISOString().slice(0, 10);
        if (c.req.valid('query').format === 'csv') {
            c.header('Content-Type', 'text/csv; charset=utf-8');
            c.header('Content-Disposition', `attachment; filename="moneo-${stamp}.csv"`);
            return c.body(await exportCsv(userId), 200) as never;
        }
        c.header('Content-Disposition', `attachment; filename="moneo-${stamp}.json"`);
        return c.json(await exportData(userId), 200);
    },
);

export default data;
