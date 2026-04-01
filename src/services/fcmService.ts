import { logger } from '../utils/logger.js';

let messaging: any = null;

export const initFirebase = async (): Promise<void> => {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountEnv) {
        logger.warn('[FCM] FIREBASE_SERVICE_ACCOUNT non configuré — notifications push ignorées');
        return;
    }
    try {
        const { default: admin } = await import('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(serviceAccountEnv)),
            });
        }
        messaging = admin.messaging();
        logger.info('[FCM] Firebase Admin initialisé');
    } catch (err) {
        logger.error({ err }, '[FCM] Erreur initialisation Firebase Admin');
    }
};

export const sendPushNotification = async (
    fcmToken: string,
    title: string,
    body: string,
    data: Record<string, string> = {}
): Promise<void> => {
    if (!messaging || !fcmToken) return;
    try {
        await messaging.send({
            token: fcmToken,
            notification: { title, body },
            data,
            android: { priority: 'high' },
            apns: { payload: { aps: { sound: 'default' } } },
        });
        logger.info({ title }, '[FCM] Notification envoyée');
    } catch (err) {
        logger.error({ err }, '[FCM] Erreur envoi notification');
    }
};
