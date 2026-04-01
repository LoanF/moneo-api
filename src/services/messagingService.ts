import { logger } from '../utils/logger.js';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@moneo-app.com';
const FROM_NAME = 'Moneo';

export const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
    if (!BREVO_API_KEY) {
        logger.warn({ to, subject }, '[Messaging] BREVO_API_KEY non configurée — email ignoré');
        return;
    }

    const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            sender: { name: FROM_NAME, email: FROM_EMAIL },
            to: [{ email: to }],
            subject,
            htmlContent: html,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        logger.error({ to, subject, status: response.status, error }, '[Messaging] Erreur envoi email');
        console.error('[Messaging] Erreur envoi email:', response.status, error);
        throw new Error(`Brevo API error ${response.status}: ${error}`);
    }

    logger.info({ to, subject }, '[Messaging] Email envoyé');
};

const codeBlock = (code: string) => `
  <div style="margin:32px auto;width:fit-content;background:#f4f4f5;border-radius:12px;padding:20px 40px;
              font-size:36px;font-weight:700;letter-spacing:12px;color:#111;font-family:monospace">
    ${code}
  </div>`;

export const sendVerificationEmail = async (to: string, code: string): Promise<void> => {
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#111">
        <h2 style="color:#e53935">Vérifiez votre email</h2>
        <p>Merci de vous être inscrit sur <strong>Moneo</strong>.<br>
           Entrez ce code dans l'application pour activer votre compte :</p>
        ${codeBlock(code)}
        <p style="color:#888;font-size:13px">Ce code expire dans 24 heures. Si vous n'avez pas créé de compte, ignorez cet email.</p>
      </div>`;
    await sendEmail(to, 'Moneo — Vérification de votre email', html);
};

export const sendPasswordResetEmail = async (to: string, code: string): Promise<void> => {
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;color:#111">
        <h2 style="color:#e53935">Réinitialisation du mot de passe</h2>
        <p>Une demande de réinitialisation a été effectuée pour votre compte <strong>Moneo</strong>.<br>
           Entrez ce code dans l'application :</p>
        ${codeBlock(code)}
        <p style="color:#888;font-size:13px">Ce code expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      </div>`;
    await sendEmail(to, 'Moneo — Réinitialisation de mot de passe', html);
};

// ── FCM Push Notification ─────────────────────────────────────────────────────
export { sendPushNotification } from './fcmService.js';
