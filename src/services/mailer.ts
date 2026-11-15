import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
    if (!env.BREVO_API_KEY) {
        logger.warn({ subject }, '[Mail] BREVO_API_KEY non configurée — email ignoré');
        return;
    }
    const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
            sender: { name: 'Moneo', email: env.SMTP_FROM },
            to: [{ email: to }],
            subject,
            htmlContent: html,
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
        throw new Error(`Brevo a répondu ${response.status}`);
    }
};

const layout = (title: string, intro: string, code: string, footer: string) => `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#111">
    <h2 style="margin:0 0 12px">${title}</h2>
    <p>${intro}</p>
    <div style="margin:28px auto;width:fit-content;background:#f4f4f5;border-radius:12px;padding:18px 36px;
                font-size:34px;font-weight:700;letter-spacing:10px;font-family:monospace">${code}</div>
    <p style="color:#777;font-size:13px">${footer}</p>
  </div>`;

/** Les envois sont « best effort » : un échec est journalisé sans bloquer la requête. */
const fireAndForget = (promise: Promise<void>, context: string) => {
    promise.catch((err) => logger.error({ err }, `[Mail] ${context}`));
};

export const sendVerificationEmail = (to: string, code: string): void =>
    fireAndForget(
        sendEmail(
            to,
            'Moneo — Vérification de votre email',
            layout(
                'Vérifiez votre email',
                'Entrez ce code dans l’application pour activer votre compte :',
                code,
                'Ce code expire dans 24 heures. Si vous n’avez pas créé de compte, ignorez cet email.',
            ),
        ),
        'Échec de l’email de vérification',
    );

export const sendPasswordResetEmail = (to: string, code: string): void =>
    fireAndForget(
        sendEmail(
            to,
            'Moneo — Réinitialisation du mot de passe',
            layout(
                'Réinitialisation du mot de passe',
                'Entrez ce code dans l’application pour choisir un nouveau mot de passe :',
                code,
                'Ce code expire dans 15 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.',
            ),
        ),
        'Échec de l’email de réinitialisation',
    );
