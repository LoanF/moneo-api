import { OpenAPIHono } from '@hono/zod-openapi';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import {Transaction, UniqueConstraintError} from 'sequelize';
import sequelize from '../config/database.js';
import User from '../models/User.js';
import { googleRoute, loginRoute, refreshRoute, registerRoute } from '../definitions/auth.definitions.js';

const auth = new OpenAPIHono();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateTokens = async (userId: number, email: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const payload = { id: userId, email, exp: Math.floor(Date.now() / 1000) + 60 * 15 }; // 15 min
    const refreshPayload = { id: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }; // 7 jours

    const [accessToken, refreshToken] = await Promise.all([
        sign(payload, process.env.ACCESS_TOKEN_SECRET as string, 'HS256'),
        sign(refreshPayload, process.env.REFRESH_TOKEN_SECRET as string, 'HS256')
    ]);

    return { accessToken, refreshToken };
};

const authSuccessResponse = async (c: any, user: User, fcmToken?: string, status: 200 | 201 = 200, transaction?: Transaction) => {
    const tokens = await generateTokens(user.id, user.email);

    user.refreshToken = tokens.refreshToken;

    if (fcmToken) {
        user.fcmToken = fcmToken;
    }

    await user.save({ transaction });

    return c.json({
        ...tokens,
        user: {
            uid: String(user.id),
            displayName: user.username,
            email: user.email,
            photoUrl: user.photoUrl || null,
            fcmToken: user.fcmToken || null,
            hasCompletedSetup: user.hasCompletedSetup
        }
    }, status);
};

auth.openapi(registerRoute, async (c) => {
    const transaction = await sequelize.transaction();
    try {
        const body = c.req.valid('json');
        const hashedPassword = await bcrypt.hash(body.password, 10);

        const user = await User.create({
            username: body.username,
            email: body.email.toLowerCase(),
            password: hashedPassword
        }, { transaction });

        const response = await authSuccessResponse(c, user, body.fcmToken, 201, transaction);
        await transaction.commit();
        return response;
    } catch (error) {
        await transaction.rollback();
        const msg = error instanceof UniqueConstraintError ? "Email déjà utilisé" : "Erreur lors de l'inscription";
        return c.json({ error: msg }, 400);
    }
});

auth.openapi(loginRoute, async (c) => {
    const { email, password, fcmToken } = c.req.valid('json');
    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (user && user.password && await bcrypt.compare(password, user.password)) {
        return authSuccessResponse(c, user, fcmToken, 200);
    }
    return c.json({ error: "Identifiants incorrects" }, 401);
});

auth.openapi(googleRoute, async (c) => {
    try {
        const { idToken, fcmToken } = c.req.valid('json');
        const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();

        if (!payload || !payload.email) return c.json({ error: "Token Google invalide" }, 403);

        const { sub, email, name, picture } = payload;

        const [user, created] = await User.findOrCreate({
            where: { email },
            defaults: {
                username: name || 'User',
                email: email,
                googleId: sub,
                photoUrl: picture || null
            }
        });

        if (!created && !user.googleId) {
            user.googleId = sub;
            if (!user.photoUrl && picture) user.photoUrl = picture;
            if (!fcmToken) await user.save();
        }

        return authSuccessResponse(c, user, fcmToken, 200);
    } catch (error) {
        return c.json({ error: "Authentification Google échouée" }, 403);
    }
});

auth.openapi(refreshRoute, async (c) => {
    const { token } = c.req.valid('json');

    try {
        await verify(token, process.env.REFRESH_TOKEN_SECRET as string, 'HS256');
    } catch {
        return c.json({ error: "Token expiré ou invalide" }, 403);
    }

    const user = await User.findOne({ where: { refreshToken: token } });
    if (!user) return c.json({ error: "Token non reconnu" }, 403);

    const tokens = await generateTokens(user.id, user.email);

    user.refreshToken = tokens.refreshToken;
    await user.save();

    return c.json(tokens, 200);
});

export default auth;