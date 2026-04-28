import { createRouter } from '../utils/router.js';
import {sign, verify} from 'hono/jwt';
import {OAuth2Client} from 'google-auth-library';
import {Transaction, UniqueConstraintError} from 'sequelize';
import sequelize from '../config/database.js';
import TransactionModel from '../models/Transaction.js';
import BankAccount from '../models/BankAccount.js';
import Category from '../models/Category.js';
import PaymentMethod from '../models/PaymentMethod.js';
import MonthlyPayment from '../models/MonthlyPayment.js';
import User from '../models/User.js';
import {googleRoute, loginRoute, logoutRoute, meRoute, refreshRoute, registerRoute, updateProfileRoute, uploadAvatarRoute, verifyEmailRoute, resendVerificationRoute, forgotPasswordRoute, resetPasswordRoute, deleteAccountRoute} from '../definitions/auth.definitions.js';
import {PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {verifyPassword} from "../utils/password.js";
import {hashPassword} from "../utils/password.js";
import {seedUserCategories} from "../utils/seeder.js";
import {sendVerificationEmail, sendPasswordResetEmail} from "../services/messagingService.js";
import {authMiddleware} from "../middleware/auth.js";
import {createRateLimiter} from "../middleware/rateLimiter.js";
import {logger} from "../utils/logger.js";

const auth = createRouter();
const protectedAuth = createRouter();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateCode = (): string => Math.floor(100000 + Math.random() * 900000).toString();

auth.use('/register', createRateLimiter(5, 10 * 60 * 1000));
auth.use('/login', createRateLimiter(10, 15 * 60 * 1000));
auth.use('/google', createRateLimiter(10, 60 * 1000));
auth.use('/refresh', createRateLimiter(10, 60 * 1000));
auth.use('/forgot-password', createRateLimiter(3, 15 * 60 * 1000));
auth.use('/reset-password', createRateLimiter(5, 15 * 60 * 1000));

protectedAuth.use('*', authMiddleware);

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const generateTokens = async (userId: string, email: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const payload = {id: userId, email, exp: Math.floor(Date.now() / 1000) + 60 * 5}; // 5 min
    const refreshPayload = {id: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7}; // 7 jours

    const [accessToken, refreshToken] = await Promise.all([
        sign(payload, process.env.ACCESS_TOKEN_SECRET as string, 'HS256'),
        sign(refreshPayload, process.env.REFRESH_TOKEN_SECRET as string, 'HS256')
    ]);

    return {accessToken, refreshToken};
};

const buildAuthPayload = async (user: User, fcmToken?: string, transaction?: Transaction) => {
    const tokens = await generateTokens(user.uid, user.email);
    user.refreshToken = tokens.refreshToken;
    if (fcmToken) user.fcmToken = fcmToken;
    await user.save({transaction});
    return {
        ...tokens,
        user: {
            uid: String(user.uid),
            username: user.username,
            email: user.email,
            photoUrl: user.photoUrl || null,
            fcmToken: user.fcmToken || null,
            hasCompletedSetup: user.hasCompletedSetup,
            emailVerified: user.emailVerifiedAt !== null,
            notificationPrefs: user.notificationPrefs || { paymentApplied: true, lowBalance: true, monthlyRecap: true, activityReminder: true },
        }
    };
};

auth.openapi(registerRoute, async (c) => {
    const transaction = await sequelize.transaction();
    try {
        const body = c.req.valid('json');

        const verificationCode = generateCode();
        const user = await User.create({
            username: body.username,
            email: body.email.toLowerCase(),
            password: body.password,
            emailVerificationCode: verificationCode,
        }, {transaction});

        await seedUserCategories(user.uid, transaction);

        const payload = await buildAuthPayload(user, body.fcmToken, transaction);
        await transaction.commit();

        sendVerificationEmail(user.email, verificationCode).catch((err) =>
            logger.error({ err }, 'sendVerificationEmail failed (non-blocking)')
        );

        return c.json(payload, 201);
    } catch (error) {
        await transaction.rollback();
        const msg = error instanceof UniqueConstraintError ? "Email déjà utilisé" : "Erreur lors de l'inscription";
        return c.json({error: msg}, 400);
    }
});

auth.openapi(loginRoute, async (c) => {
    const {email, password, fcmToken} = c.req.valid('json');
    const user = await User.findOne({where: {email}});

    if (!user || !user.password || !(await verifyPassword(password, user.password))) {
        return c.json({error: "Identifiants invalides"}, 401);
    }

    return c.json(await buildAuthPayload(user, fcmToken), 200);
});

auth.openapi(googleRoute, async (c) => {
    try {
        const {idToken, fcmToken} = c.req.valid('json');
        const ticket = await client.verifyIdToken({idToken, audience: process.env.GOOGLE_CLIENT_ID});
        const payload = ticket.getPayload();

        if (!payload || !payload.email) return c.json({error: "Token Google invalide"}, 403);

        const {sub, email, name, picture} = payload;

        const [user, created] = await User.findOrCreate({
            where: {email},
            defaults: {
                username: name || 'User',
                email: email,
                googleId: sub,
                photoUrl: picture || null,
                emailVerifiedAt: new Date(),
            }
        });

        if (created) {
            await seedUserCategories(user.uid);
        }

        if (!created) {
            if (!user.googleId) user.googleId = sub;
            if (!user.photoUrl && picture) user.photoUrl = picture;
            if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
            if (!fcmToken) await user.save();
        }

        return c.json(await buildAuthPayload(user, fcmToken), 200);
    } catch (error) {
        return c.json({error: "Authentification Google échouée"}, 403);
    }
});

auth.openapi(refreshRoute, async (c) => {
    const {token} = c.req.valid('json');

    try {
        await verify(token, process.env.REFRESH_TOKEN_SECRET as string, 'HS256');
    } catch {
        return c.json({error: "Token expiré ou invalide"}, 403);
    }

    const user = await User.findOne({where: {refreshToken: token}});
    if (!user) return c.json({error: "Token non reconnu"}, 403);

    const tokens = await generateTokens(user.uid, user.email);

    user.refreshToken = tokens.refreshToken;
    await user.save();

    return c.json(tokens, 200);
});

protectedAuth.openapi(updateProfileRoute, async (c) => {
        const userPayload = c.get('jwtPayload');
        const body = c.req.valid('json');

        try {
            const user = await User.findByPk(userPayload.id);

            if (!user) {
                return c.json({error: "Utilisateur non trouvé"}, 404);
            }

            await user.update(body);

            return c.json({
                uid: String(user.uid),
                username: user.username,
                email: user.email,
                photoUrl: user.photoUrl,
                fcmToken: user.fcmToken,
                hasCompletedSetup: user.hasCompletedSetup,
                emailVerified: user.emailVerifiedAt !== null,
                notificationPrefs: user.notificationPrefs || { paymentApplied: true, lowBalance: true, monthlyRecap: true, activityReminder: true },
            }, 200);

        } catch (error) {
            logger.error(error);
            return c.json({error: 'Une erreur interne est survenue'}, 500);
        }
    });

protectedAuth.openapi(uploadAvatarRoute, async (c) => {
    const userPayload = c.get('jwtPayload');
    const body = await c.req.parseBody();
    const file = body['avatar'] as File;

    if (!file) return c.json({error: "Aucun fichier fourni"}, 400);

    const fileName = `avatars/${userPayload.id}-${Date.now()}-${file.name}`;
    const fileBuffer = await file.arrayBuffer();

    await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: Buffer.from(fileBuffer),
        ContentType: file.type,
    }));

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    const user = await User.findByPk(userPayload.id);
    if (user) {
        user.photoUrl = publicUrl;
        await user.save();
    }
    return c.json({url: publicUrl}, 200);
});

protectedAuth.openapi(meRoute, async (c) => {
    const payload = c.get('jwtPayload');
    const user = await User.findByPk(payload.id);

    if (!user) return c.json({error: "Utilisateur non trouvé"}, 401);

    return c.json({
        uid: String(user.uid),
        username: user.username,
        email: user.email,
        photoUrl: user.photoUrl,
        fcmToken: user.fcmToken,
        hasCompletedSetup: user.hasCompletedSetup,
        emailVerified: user.emailVerifiedAt !== null,
        notificationPrefs: user.notificationPrefs || { paymentApplied: true, lowBalance: true, monthlyRecap: true, activityReminder: true },
    }, 200);
});

protectedAuth.openapi(logoutRoute, async (c) => {
    const payload = c.get('jwtPayload');

    // On invalide le refresh token en base de données
    await User.update(
        {refreshToken: null},
        {where: {uid: payload.id}}
    );

    return c.json({success: true}, 200);
});

protectedAuth.openapi(verifyEmailRoute, async (c) => {
    const payload = c.get('jwtPayload');
    const { code } = c.req.valid('json');

    const user = await User.findByPk(payload.id);
    if (!user) return c.json({ error: "Utilisateur non trouvé" }, 400);
    if (user.emailVerifiedAt !== null) return c.json({ success: true }, 200);
    if (user.emailVerificationCode !== code) return c.json({ error: "Code invalide" }, 400);

    user.emailVerifiedAt = new Date();
    user.emailVerificationCode = null;
    await user.save();

    return c.json({ success: true }, 200);
});

protectedAuth.openapi(resendVerificationRoute, async (c) => {
    const payload = c.get('jwtPayload');
    const user = await User.findByPk(payload.id);
    if (!user) return c.json({ error: "Utilisateur non trouvé" }, 400);
    if (user.emailVerifiedAt !== null) return c.json({ error: "Email déjà vérifié" }, 400);

    const code = generateCode();
    user.emailVerificationCode = code;
    await user.save();

    sendVerificationEmail(user.email, code).catch((err) =>
        logger.error({ err }, 'resendVerificationEmail failed (non-blocking)')
    );

    return c.json({ success: true }, 200);
});

auth.openapi(forgotPasswordRoute, async (c) => {
    const { email } = c.req.valid('json');
    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (!user || !user.password) return c.json({ success: true }, 200);

    const code = generateCode();
    user.passwordResetCode = code;
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    sendPasswordResetEmail(user.email, code).catch((err) =>
        logger.error({ err }, 'sendPasswordResetEmail failed (non-blocking)')
    );

    return c.json({ success: true }, 200);
});

auth.openapi(resetPasswordRoute, async (c) => {
    const { email, code, newPassword } = c.req.valid('json');
    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (
        !user ||
        !user.passwordResetCode ||
        user.passwordResetCode !== code ||
        !user.passwordResetExpires ||
        user.passwordResetExpires < new Date()
    ) {
        return c.json({ error: "Code invalide ou expiré" }, 400);
    }

    user.password = await hashPassword(newPassword);
    user.passwordResetCode = null;
    user.passwordResetExpires = null;
    user.refreshToken = null;
    await user.save({ hooks: false });

    return c.json({ success: true }, 200);
});

protectedAuth.openapi(deleteAccountRoute, async (c) => {
    const payload = c.get('jwtPayload');
    const userId = payload.id;

    const user = await User.findByPk(userId);
    if (!user) return c.json({ error: "Utilisateur non trouvé" }, 404);

    await TransactionModel.destroy({ where: { userId } });
    await MonthlyPayment.destroy({ where: { userId } });
    await BankAccount.destroy({ where: { userId } });
    await Category.destroy({ where: { userId } });
    await PaymentMethod.destroy({ where: { userId } });
    await user.destroy();

    return c.json({ success: true }, 200);
});

auth.route('/', protectedAuth);

export default auth;