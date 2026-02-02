import { OpenAPIHono } from '@hono/zod-openapi';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import {googleRoute, loginRoute, refreshRoute, registerRoute} from './auth.definitions.js';

const auth = new OpenAPIHono();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateTokens = async (user: User): Promise<{ accessToken: string; refreshToken: string }> => {
    const payload = { id: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 15 };
    const refreshPayload = { id: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 };

    const accessToken = await sign(payload, process.env.ACCESS_TOKEN_SECRET as string, 'HS256');
    const refreshToken = await sign(refreshPayload, process.env.REFRESH_TOKEN_SECRET as string, 'HS256');

    return { accessToken, refreshToken };
};

auth.openapi(registerRoute, async (c) => {
    try {
        const body = c.req.valid('json');
        const hashedPassword = await bcrypt.hash(body.password, 10);
        const user = await User.create({
            username: body.username,
            email: body.email.toLowerCase(),
            password: hashedPassword
        });
        const tokens = await generateTokens(user);
        await user.update({ refreshToken: tokens.refreshToken });
        const userId = user.get('id') || user.id;

        return c.json({
            ...tokens,
            user: {
                uid: String(userId),
                displayName: user.username,
                email: user.email
            }
        }, 201);
    } catch (error: any) {
        const msg = error.name === 'SequelizeUniqueConstraintError' ? "Email déjà utilisé" : error.message;
        return c.json({ error: msg }, 400);
    }
});

auth.openapi(loginRoute, async (c) => {
    const { email, password } = c.req.valid('json');
    const user = await User.findOne({ where: { email } });

    if (user && user.password && await bcrypt.compare(password, user.password)) {
        const tokens = await generateTokens(user);
        await user.update({ refreshToken: tokens.refreshToken });
        return c.json({ ...tokens, user: { uid: user.id.toString(), displayName: user.username, email: user.email } }, 200);
    }
    return c.json({ error: "Identifiants incorrects" }, 401);
});

auth.openapi(googleRoute, async (c) => {
    try {
        const { idToken } = c.req.valid('json');
        const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        if (!payload) return c.json({ error: "Token Google invalide" }, 403);

        const { sub, email, name } = payload;
        let user = await User.findOne({ where: { email } });
        if (!user) {
            user = await User.create({ username: name || 'User', email: email!, googleId: sub });
        } else if (!user.googleId) {
            await user.update({ googleId: sub });
        }

        const tokens = await generateTokens(user);
        await user.update({ refreshToken: tokens.refreshToken });
        return c.json({ ...tokens, user: { uid: user.id.toString(), displayName: user.username, email: user.email } }, 200);
    } catch {
        return c.json({ error: "Authentification Google échouée" }, 403);
    }
});

auth.openapi(refreshRoute, async (c) => {
    const { token } = c.req.valid('json');
    const user = await User.findOne({ where: { refreshToken: token } });
    if (!user) return c.json({ error: "Token non reconnu" }, 403);

    try {
        await verify(token, process.env.REFRESH_TOKEN_SECRET as string, 'HS256');
        const tokens = await generateTokens(user);
        await user.update({ refreshToken: tokens.refreshToken });
        return c.json(tokens, 200);
    } catch {
        await user.update({ refreshToken: null });
        return c.json({ error: "Token expiré" }, 403);
    }
});

export default auth;