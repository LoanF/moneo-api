import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

type Messaging = {
    sendEachForMulticast(message: unknown): Promise<{ responses: { success: boolean; error?: { code?: string } }[] }>;
};

let messaging: Messaging | null = null;

export const initPush = async (): Promise<void> => {
    if (!env.FIREBASE_SERVICE_ACCOUNT) {
        logger.warn('[Push] FIREBASE_SERVICE_ACCOUNT non configuré — notifications push désactivées');
        return;
    }
    try {
        const { default: admin } = await import('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
        }
        messaging = admin.messaging() as unknown as Messaging;
        logger.info('[Push] Firebase Admin initialisé');
    } catch (err) {
        logger.error({ err }, '[Push] Initialisation Firebase Admin impossible');
    }
};

const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);

/**
 * Envoie une notification à plusieurs appareils.
 * Retourne les jetons que FCM déclare définitivement invalides, à purger par l'appelant.
 */
export const sendPush = async (
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string> = {},
): Promise<string[]> => {
    if (!messaging || tokens.length === 0) return [];
    try {
        const result = await messaging.sendEachForMulticast({
            tokens,
            notification: { title, body },
            data,
            android: { priority: 'high' },
            apns: { payload: { aps: { sound: 'default' } } },
        });
        return result.responses.flatMap((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code ?? '') ? [tokens[i]] : []));
    } catch (err) {
        logger.error({ err }, '[Push] Échec de l’envoi');
        return [];
    }
};
