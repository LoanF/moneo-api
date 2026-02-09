import { z } from "@hono/zod-openapi";

export const CategoryResponseSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    iconCode: z.number(),
    colorValue: z.number(),
    parentId: z.uuid().nullable(),
    userId: z.uuid()
}).openapi('CategoryResponse');

export const CreateCategorySchema = z.object({
    name: z.string().min(1),
    iconCode: z.number(),
    colorValue: z.number(),
    parentId: z.uuid().optional().nullable()
}).openapi('CreateCategoryInput');