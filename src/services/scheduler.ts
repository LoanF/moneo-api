import { logger } from '../utils/logger.js';

type HeartbeatStatus = 'up' | 'down';

/**
 * Émet un signal de supervision vers Uptime Kuma.
 * L'échec de l'appel ne doit jamais interrompre le traitement métier :
 * la supervision est un observateur, pas une dépendance fonctionnelle.
 */
export async function notifyHeartbeat(
    status: HeartbeatStatus,
    message: string,
): Promise<void> {
    const url = process.env.UPTIME_PUSH_URL;
    if (!url) return; // supervision désactivée en développement local

    try {
        const params = new URLSearchParams({ status, msg: message });
        await fetch(`${url}?${params.toString()}`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
    } catch (err) {
        logger.warn({ err }, 'Signal de supervision non transmis');
    }
}
