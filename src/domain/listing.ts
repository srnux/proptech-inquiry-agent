import { z } from "zod";

export const OfferType = z.enum(["rent", "sale"]);
export const PropertyType = z.enum(["apartment", "house", "commercial"]);
export const PetsPolicy = z.enum(["yes", "no", "on-request"]);

export const Listing = z.object({
  id: z.string().regex(/^[A-Z]{1,2}-\d{4}$/),
  title: z.string().min(1),
  city: z.string().min(1),
  district: z.string().min(1),
  offerType: OfferType,
  propertyType: PropertyType,
  price: z.number().positive(),
  priceUnit: z.enum(["EUR", "EUR/month"]),
  livingAreaSqm: z.number().positive(),
  rooms: z.number().positive(),
  floor: z.number().int().nullable(),
  yearBuilt: z.number().int(),
  availableFrom: z.iso.date(),
  features: z.array(z.string()),
  petsAllowed: PetsPolicy,
  energyClass: z.enum(["A+", "A", "B", "C", "D", "E", "F", "G", "H"]),
  description: z.string().min(1),
});
export type Listing = z.infer<typeof Listing>;

export const ListingCatalogue = z.array(Listing).superRefine((listings, ctx) => {
  const seen = new Set<string>();
  for (const l of listings) {
    if (seen.has(l.id)) ctx.addIssue({ code: "custom", message: `duplicate listing id ${l.id}` });
    seen.add(l.id);
  }
});

/** The fields an agent needs to decide whether to open a listing, without the long text. */
export type ListingSummary = Pick<
  Listing,
  "id" | "title" | "city" | "district" | "offerType" | "propertyType" | "price" | "priceUnit" | "livingAreaSqm" | "rooms" | "availableFrom" | "petsAllowed"
>;

export function summarise(l: Listing): ListingSummary {
  const { id, title, city, district, offerType, propertyType, price, priceUnit, livingAreaSqm, rooms, availableFrom, petsAllowed } = l;
  return { id, title, city, district, offerType, propertyType, price, priceUnit, livingAreaSqm, rooms, availableFrom, petsAllowed };
}
