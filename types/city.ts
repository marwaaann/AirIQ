import { z } from "zod";

/** A place the user has selected, favorited or located. Stored in localStorage. */
export const SavedCitySchema = z.object({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  /** "Region, Country" line, if known. */
  subtitle: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type SavedCity = z.infer<typeof SavedCitySchema>;
