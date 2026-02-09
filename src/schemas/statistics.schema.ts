import { z } from "@hono/zod-openapi";

export const CategoryStatSchema = z.object({
    categoryId: z.uuid().nullable(),
    categoryName: z.string(),
    iconCode: z.number().nullable(),
    colorValue: z.number().nullable(),
    total: z.number(),
    count: z.number()
}).openapi('CategoryStat');

export const GlobalStatsSchema = z.object({
    totalIncome: z.number(),
    totalExpense: z.number(),
    netChange: z.number(),
    byCategory: z.array(CategoryStatSchema)
}).openapi('GlobalStats');