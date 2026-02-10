import {z} from "@hono/zod-openapi";

export const RegisterSchema = z.object({
    username: z.string().min(3, "Le nom d'utilisateur doit contenir au moins 3 caractères"),
    email: z.email("Format d'email invalide"),
    password: z.string()
        .min(8, "Le mot de passe doit contenir au moins 8 caractères")
        .regex(/[A-Z]/, "Il faut au moins une majuscule")
        .regex(/[a-z]/, "Il faut au moins une minuscule")
        .regex(/[0-9]/, "Il faut au moins un chiffre")
        .regex(/[^A-Za-z0-9]/, "Il faut au moins un symbole"),
    fcmToken: z.string().optional()
}).openapi('RegisterInput');

export const LoginSchema = z.object({
    email: z.email(),
    password: z.string(),
    fcmToken: z.string().optional()
}).openapi('LoginInput');

export const GoogleSchema = z.object({
    idToken: z.string(),
    fcmToken: z.string().optional()
}).openapi('GoogleInput');

export const RefreshSchema = z.object({
    token: z.string()
}).openapi('RefreshInput');

export const UserSchema = z.object({
    uid: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    photoUrl: z.string().nullable(),
    fcmToken: z.string().nullable(),
    hasCompletedSetup: z.boolean(),
}).openapi('User');

export const UpdateProfileSchema = z.object({
    username: z.string().min(3).optional(),
    photoUrl: z.url().optional(),
    hasCompletedSetup: z.boolean().optional(),
    fcmToken: z.string().optional(),
    id: z.string().optional(),
    email: z.string().optional(),
    payment_methods: z.array(z.any()).optional(),
}).openapi('UpdateProfileInput');

export const AuthResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: z.object({
        uid: z.uuid(),
        displayName: z.string(),
        email: z.string(),
        photoUrl: z.string().nullable(),
        fcmToken: z.string().nullable(),
        hasCompletedSetup: z.boolean(),
    })
}).openapi('AuthResponse');

export const RefreshResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string()
}).openapi('RefreshResponse');

export const ErrorSchema = z.object({
    error: z.string()
}).openapi('ErrorResponse');