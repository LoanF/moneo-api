import { OpenAPIHono } from '@hono/zod-openapi';
import { sign, verify } from 'hono/jwt';
import { OAuth2Client } from 'google-auth-library';
import {Transaction, UniqueConstraintError} from 'sequelize';
import sequelize from '../config/database.js';
import User from '../models/User.js';
import {googleRoute, loginRoute, logoutRoute, meRoute, refreshRoute, registerRoute, updateProfileRoute, uploadAvatarRoute} from '../definitions/auth.definitions.js';
import {PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {verifyPassword} from "../utils/password.js";
import {seedUserCategories} from "../utils/seeder.js";

const auth = new OpenAPIHono();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const generateTokens = async (userId: number, email: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const payload = { id: userId, email, exp: Math.floor(Date.now() / 1000) + 60 * 5 }; // 5 min
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

        const user = await User.create({
            username: body.username,
            email: body.email.toLowerCase(),
            password: body.password
        }, { transaction });

        await seedUserCategories(user.id);

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
    const user = await User.findOne({ where: { email } });

    if (!user || !user.password || !(await verifyPassword(password, user.password))) {
        return c.json({ error: "Identifiants invalides" }, 401);
    }

    return authSuccessResponse(c, user, fcmToken, 200);
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

        if (created) {
            await seedUserCategories(user.id);
        }

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

auth.openapi(updateProfileRoute, async (c) => {
    const payload = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const user = await User.findByPk(payload.id);

        if (!user) {
            return c.json({ error: "Utilisateur non trouvé" }, 404);
        }

        await user.update(body);

        return c.json({
            uid: String(user.id),
            displayName: user.username,
            email: user.email,
            photoUrl: user.photoUrl,
            fcmToken: user.fcmToken,
            hasCompletedSetup: user.hasCompletedSetup
        }, 200);

    } catch (error: any) {
        return c.json({ error: error.message || "Erreur lors de la mise à jour" }, 400);
    }
});

auth.openapi(uploadAvatarRoute, async (c) => {
    const userPayload = c.get('jwtPayload');
    const body = await c.req.parseBody();
    const file = body['avatar'] as File;

    if (!file) return c.json({ error: "Aucun fichier fourni" }, 400);

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
    return c.json({ url: publicUrl }, 200);
});

auth.openapi(meRoute, async (c) => {
    const payload = c.get('jwtPayload');
    const user = await User.findByPk(payload.id);

    if (!user) return c.json({ error: "Utilisateur non trouvé" }, 401);

    return c.json({
        uid: String(user.id),
        displayName: user.username,
        email: user.email,
        photoUrl: user.photoUrl,
        fcmToken: user.fcmToken,
        hasCompletedSetup: user.hasCompletedSetup
    }, 200);
});

auth.openapi(logoutRoute, async (c) => {
    const payload = c.get('jwtPayload');

    // On invalide le refresh token en base de données
    await User.update(
        { refreshToken: null },
        { where: { id: payload.id } }
    );

    return c.json({ success: true }, 200);
});

export default auth;