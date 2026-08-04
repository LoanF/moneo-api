import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/node', () => ({
    init: vi.fn(),
    captureException: vi.fn(),
}));

describe('sentry config', () => {
    const originalDsn = process.env.SENTRY_DSN;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    afterEach(() => {
        process.env.SENTRY_DSN = originalDsn;
    });

    it('initialise Sentry si SENTRY_DSN est défini', async () => {
        process.env.SENTRY_DSN = 'https://example@sentry.io/1';
        const Sentry = await import('@sentry/node');
        await import('./sentry.js');

        expect(Sentry.init).toHaveBeenCalledWith(
            expect.objectContaining({ dsn: 'https://example@sentry.io/1' })
        );
    });

    it("n'initialise pas Sentry si SENTRY_DSN est absent", async () => {
        delete process.env.SENTRY_DSN;
        const Sentry = await import('@sentry/node');
        await import('./sentry.js');

        expect(Sentry.init).not.toHaveBeenCalled();
    });
});
