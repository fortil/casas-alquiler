import { z } from "zod";

export const DiscoverParamsSchema = z.object({
  cities: z.array(z.string()).default(["jamundi", "cali"]),
  propertyType: z.enum(["casa", "apartamento"]).default("casa"),
  /** total search queries to run; 0/negative treated as the schema default, not "unlimited" */
  maxQueries: z.number().int().positive().max(25).default(12),
  /** cap on how many "new" candidates get reconned; excludes known/blocklisted from the count */
  maxCandidates: z.number().int().positive().max(50).default(20),
});
export type DiscoverParams = z.input<typeof DiscoverParamsSchema>;
export type ResolvedDiscoverParams = z.infer<typeof DiscoverParamsSchema>;
