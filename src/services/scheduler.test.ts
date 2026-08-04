import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
    logger: { warn: vi.fn() },
}));

import { logger } from '../utils/logger.js';
import { notifyHeartbeat } from './scheduler.js';

describe('notifyHeartbeat', () => {
    const originalEnv = process.env.UPTIME_PUSH_URL;
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn().mockResolvedValue({ ok: true } as any);
    });

    afterEach(() => {
        process.env.UPTIME_PUSH_URL = originalEnv;
        global.fetch = originalFetch;
    });

    it("n'appelle pas fetch si UPTIME_PUSH_URL n'est pas défini", async () => {
        delete process.env.UPTIME_PUSH_URL;
        await notifyHeartbeat('up', 'OK');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('appelle l\'URL de push avec le status et le message', async () => {
        process.env.UPTIME_PUSH_URL = 'https://kuma.example.com/api/push/abc123';
        await notifyHeartbeat('up', 'Traitements planifiés exécutés : 2 paiement(s)');

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const calledUrl = vi.mocked(global.fetch).mock.calls[0][0] as string;
        expect(calledUrl).toContain('https://kuma.example.com/api/push/abc123?');
        expect(calledUrl).toContain('status=up');
        expect(calledUrl).toContain('msg=');
    });

    it('log un warning sans lever si fetch échoue', async () => {
        process.env.UPTIME_PUSH_URL = 'https://kuma.example.com/api/push/abc123';
        global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

        await expect(notifyHeartbeat('down', 'Erreur')).resolves.not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Error) }),
            'Signal de supervision non transmis'
        );
    });
});
