import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/sentry.js', () => ({
    Sentry: { captureException: vi.fn() },
}));

import { Sentry } from '../config/sentry.js';
import { logger } from './logger.js';

describe('logger', () => {
    beforeEach(() => vi.clearAllMocks());

    it('envoie les erreurs (niveau error) vers Sentry', () => {
        const err = new Error('boom');
        logger.error(err, 'Erreur de test');
        expect(Sentry.captureException).toHaveBeenCalledWith(err);
    });

    it("n'envoie rien à Sentry pour un log info", () => {
        logger.info('juste une info');
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("n'envoie rien à Sentry si aucun argument n'est une instance d'Error", () => {
        logger.error('une erreur sous forme de string');
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
