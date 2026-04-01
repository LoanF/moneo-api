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
    username: z.string(),
    email: z.string(),
    photoUrl: z.string().nullable(),
    fcmToken: z.string().nullable(),
    hasCompletedSetup: z.boolean(),
    emailVerified: z.boolean(),
}).openapi('User');

const NotificationPrefsSchema = z.object({
    paymentApplied: z.boolean().optional(),
    lowBalance: z.boolean().optional(),
    monthlyRecap: z.boolean().optional(),
    activityReminder: z.boolean().optional(),
}).openapi('NotificationPrefs');

export const UpdateProfileSchema = z.object({
    username: z.string().min(3).optional(),
    photoUrl: z.url().nullish(),
    hasCompletedSetup: z.boolean().optional(),
    fcmToken: z.string().optional(),
    notificationPrefs: NotificationPrefsSchema.optional(),
}).openapi('UpdateProfileInput');

export const AuthResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: z.object({
        uid: z.uuid(),
        username: z.string(),
        email: z.string(),
        photoUrl: z.string().nullable(),
        fcmToken: z.string().nullable(),
        hasCompletedSetup: z.boolean(),
        emailVerified: z.boolean(),
    })
}).openapi('AuthResponse');

export const RefreshResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string()
}).openapi('RefreshResponse');

export const ErrorSchema = z.object({
    error: z.string()
}).openapi('ErrorResponse');

export const VerifyEmailSchema = z.object({
    code: z.string().length(6, "Le code doit contenir 6 chiffres")
}).openapi('VerifyEmailInput');

export const ForgotPasswordSchema = z.object({
    email: z.email("Format d'email invalide")
}).openapi('ForgotPasswordInput');

export const ResetPasswordSchema = z.object({
    email: z.email(),
    code: z.string().length(6),
    newPassword: z.string()
        .min(8, "Le mot de passe doit contenir au moins 8 caractères")
        .regex(/[A-Z]/, "Il faut au moins une majuscule")
        .regex(/[a-z]/, "Il faut au moins une minuscule")
        .regex(/[0-9]/, "Il faut au moins un chiffre")
        .regex(/[^A-Za-z0-9]/, "Il faut au moins un symbole"),
}).openapi('ResetPasswordInput');
