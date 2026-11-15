import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../config/env.js';

type Entry = { count: number; resetAt: number };

/**
 * Compteur à fenêtre fixe, en mémoire. Suffisant pour une instance unique ;
 * à remplacer par Redis si l'API passe un jour sur plusieurs réplicas.
 */
export class RateLimit {
    private readonly store = new Map<string, Entry>();

    constructor(
        private readonly max: number,
        private readonly windowMs: number,
    ) {
        // Purge périodique : sans elle, chaque IP vue une fois resterait en mémoire.
        const timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
        timer.unref();
    }

    /** Consomme une unité. `retryAfter` (secondes) est renseigné quand la limite est atteinte. */
    hit(key: string, now = Date.now()): { ok: boolean; retryAfter: number } {
        const entry = this.store.get(key);
        if (!entry || now >= entry.resetAt) {
            this.store.set(key, { count: 1, resetAt: now + this.windowMs });
            return { ok: true, retryAfter: 0 };
        }
        if (entry.count >= this.max) {
            return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
        }
        entry.count++;
        return { ok: true, retryAfter: 0 };
    }

    reset(key: string): void {
        this.store.delete(key);
    }

    sweep(now = Date.now()): void {
        for (const [key, entry] of this.store) if (now >= entry.resetAt) this.store.delete(key);
    }

    get size(): number {
        return this.store.size;
    }
}

/**
 * IP du client. `X-Forwarded-For` n'est lu que si TRUST_PROXY est activé, et on prend
 * la dernière entrée : c'est celle écrite par notre proxy, les précédentes sont
 * fournies par le client et donc falsifiables.
 */
export const clientIp = (c: Context): string => {
    if (env.TRUST_PROXY) {
        const forwarded = c.req.header('x-forwarded-for');
        const last = forwarded?.split(',').pop()?.trim();
        if (last) return last;
    }
    try {
        return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
        return 'unknown';
    }
};

export const tooManyRequests = (c: Context, retryAfter: number) => {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Trop de tentatives, réessayez plus tard.', code: 'rate_limited' }, 429);
};

/** Limite par IP, appliquée en middleware. */
export const rateLimit = (max: number, windowMs: number): MiddlewareHandler => {
    const limiter = new RateLimit(max, windowMs);
    return async (c, next) => {
        const result = limiter.hit(clientIp(c));
        if (!result.ok) return tooManyRequests(c, result.retryAfter);
        await next();
    };
};
