import { z } from "@hono/zod-openapi";

export const CategoryResponseSchema = z.object({
    id: z.number(),
    name: z.string(),
    iconCode: z.number(),
    colorValue: z.number(),
    parentId: z.number().nullable(),
    userId: z.number()
}).openapi('CategoryResponse');

export const CreateCategorySchema = z.object({
    name: z.string().min(1),
    iconCode: z.number(),
    colorValue: z.number(),
    parentId: z.number().optional().nullable()
}).openapi('CreateCategoryInput');