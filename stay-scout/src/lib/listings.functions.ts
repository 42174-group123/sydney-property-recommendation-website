import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ListingId = string;
const DEFAULT_ML_BACKEND_URL = "https://stay-scout-ml-backend.onrender.com";
const listingIdSchema = z
  .union([z.string().trim().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((value) => String(value));

const listingIdFilter = (id: ListingId) => id as unknown as number;
const listingIdFilterArray = (ids: ListingId[]) => ids as unknown as readonly number[];

function getServerClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export type ListingCard = {
  id: ListingId;
  name: string | null;
  picture_url: string | null;
  host_picture_url: string | null;
  price: string | null;
  match_score?: number | null;
  combined_score?: number | null;
  user_preference_score?: number | null;
  review_quality_score?: number | null;
  review_scores_rating_final?: number | null;
  review_score_source?: string | null;
};

async function getOptionalUserId(): Promise<string | null> {
  const request = getRequest();
  const authHeader = request?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { data, error } = await getServerClient().auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub;
  } catch {
    return null;
  }
}

type ListingFiltersInput = {
  offset: number;
  limit: number;
  listing_ids?: ListingId[] | null;
  min_accommodates?: number | null;
  min_bathrooms?: number | null;
  min_bedrooms?: number | null;
  min_beds?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  min_nights?: number | null;
  instant_bookable?: boolean | null;
  neighbourhood?: string | null;
};

function toListingId(value: unknown): ListingId {
  return String(value);
}

function toIdArray(value: unknown): ListingId[] {
  return Array.isArray(value) ? value.map(toListingId).filter((id) => /^\d+$/.test(id)) : [];
}

function toListingCard(row: unknown): ListingCard {
  const item = row as ListingCard & { id: unknown };
  return { ...item, id: toListingId(item.id) };
}

async function rankListingsWithMl(
  data: ListingFiltersInput,
): Promise<{ items: ListingCard[]; nextOffset: number }> {
  const baseUrl =
    process.env.ML_BACKEND_URL ||
    process.env.VITE_ML_BACKEND_URL ||
    (process.env.NODE_ENV === "production" ? DEFAULT_ML_BACKEND_URL : "http://127.0.0.1:8090");
  if (!baseUrl) throw new Error("ML_BACKEND_URL is required for filtered listing search");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const userId = await getOptionalUserId();
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rank-listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        user_id: userId,
        offset: data.offset,
        limit: data.limit,
        listing_ids: data.listing_ids ?? null,
        filters: {
          min_accommodates: data.min_accommodates ?? null,
          min_bathrooms: data.min_bathrooms ?? null,
          min_bedrooms: data.min_bedrooms ?? null,
          min_beds: data.min_beds ?? null,
          min_price: data.min_price ?? null,
          max_price: data.max_price ?? null,
          min_nights: data.min_nights ?? null,
          instant_bookable: data.instant_bookable ?? null,
          neighbourhood: data.neighbourhood ?? null,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`ML ranking backend returned ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as { items?: unknown[]; nextOffset?: number };
    const items = (payload.items ?? []).map(toListingCard);
    const unscored = items.filter(
      (item) => typeof item.match_score !== "number" || !Number.isFinite(item.match_score),
    );
    if (unscored.length > 0) {
      throw new Error(`ML ranking backend returned ${unscored.length} unscored listings`);
    }
    return { items, nextOffset: payload.nextOffset ?? data.offset + items.length };
  } finally {
    clearTimeout(timeout);
  }
}

function hasActiveListingFilters(data: ListingFiltersInput): boolean {
  return Boolean(
    data.listing_ids?.length ||
    data.min_accommodates != null ||
    data.min_bathrooms != null ||
    data.min_bedrooms != null ||
    data.min_beds != null ||
    data.min_price != null ||
    data.max_price != null ||
    data.min_nights != null ||
    data.instant_bookable != null ||
    data.neighbourhood,
  );
}

async function fetchSequentialListings(data: { offset: number; limit: number }) {
  const { data: rows, error } = await getServerClient()
    .from("listings")
    .select("id, name, picture_url, host_picture_url, price")
    .order("id", { ascending: true })
    .range(data.offset, data.offset + data.limit - 1);
  if (error) throw new Error(error.message);
  return { items: (rows ?? []).map(toListingCard), nextOffset: data.offset + (rows?.length ?? 0) };
}

export const listListings = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        offset: z.number().int().min(0).max(100000).default(0),
        limit: z.number().int().min(1).max(40).default(20),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    return fetchSequentialListings(data);
  });

const filterSchema = z.object({
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(40).default(20),
  min_accommodates: z.number().int().min(0).nullable().optional(),
  min_bathrooms: z.number().min(0).nullable().optional(),
  min_bedrooms: z.number().min(0).nullable().optional(),
  min_beds: z.number().min(0).nullable().optional(),
  min_price: z.number().min(0).nullable().optional(),
  max_price: z.number().min(0).nullable().optional(),
  min_nights: z.number().int().min(0).nullable().optional(),
  instant_bookable: z.boolean().nullable().optional(),
  neighbourhood: z.string().trim().min(1).max(100).nullable().optional(),
});

export const searchListings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => filterSchema.parse(input))
  .handler(async ({ data }) => {
    if (!hasActiveListingFilters(data)) {
      return fetchSequentialListings(data);
    }

    return rankListingsWithMl(data);
  });

export type ListingDetail = {
  id: ListingId;
  name: string | null;
  picture_url: string | null;
  host_picture_url: string | null;
  price: string | null;
  neighbourhood_cleansed: string | null;
  beds: string | null;
  bathrooms: string | null;
  host_is_superhost: string | null;
  host_since: string | null;
  description: string | null;
  neighborhood_overview: string | null;
  amenities: string[] | string | null;
  latitude: number | null;
  longitude: number | null;
};

export const getListing = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: listingIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await getServerClient()
      .from("listings")
      .select(
        "id, name, picture_url, host_picture_url, price, neighbourhood_cleansed, beds, bathrooms, host_is_superhost, host_since, description, neighborhood_overview, amenities, latitude, longitude",
      )
      .eq("id", listingIdFilter(data.id))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row as unknown as ListingDetail | null;
  });

export type HostInfo = {
  user_id: string;
  host_since: string | null;
  avatar_url: string | null;
  saved_listings: ListingId[];
  listing_interested: ListingId[];
  published_listings: ListingId[];
  user_type: string | null;
};

export const getMyHost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("hosts")
      .select(
        "user_id, host_since, avatar_url, saved_listings, listing_interested, published_listings, user_type",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as HostInfo | null;
  });

export const ensureMyHost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("hosts")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return { ok: true, created: false };
    const { error } = await supabase.from("hosts").insert({ user_id: userId });
    if (error) throw new Error(error.message);
    return { ok: true, created: true };
  });

export const updateMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ avatar_url: z.string().url().max(2000) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("hosts")
      .upsert({ user_id: userId, avatar_url: data.avatar_url }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const USER_TYPE_VALUES = [
  "business_traveller",
  "student_long_stay",
  "budget_traveller",
  "family_group",
  "luxury_guest",
  "couple_getaway",
  "large_group",
] as const;

export const setMyUserType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_type: z.enum(USER_TYPE_VALUES) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("hosts")
      .upsert({ user_id: userId, user_type: data.user_type } as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const EVENT_TYPE_VALUES = [
  "check_location",
  "view_images",
  "open_listing",
  "check_amenities",
  "save_property",
  "contact_host",
] as const;

export const logUserAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        property_id: listingIdSchema,
        event_type: z.enum(EVENT_TYPE_VALUES),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: host } = await supabase
      .from("hosts")
      .select("user_type")
      .eq("user_id", userId)
      .maybeSingle();
    const userType = (host as { user_type?: string | null } | null)?.user_type ?? null;
    const { error } = await supabase.from("user_action" as never).insert({
      user_id: userId,
      user_type: userType,
      property_id: data.property_id,
      event_type: data.event_type,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleSavedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ listing_id: listingIdSchema }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("hosts")
      .select("saved_listings")
      .eq("user_id", userId)
      .maybeSingle();
    const listingId = data.listing_id;
    const current = toIdArray((existing as { saved_listings?: unknown } | null)?.saved_listings);
    const has = current.includes(listingId);
    const next = has ? current.filter((x) => x !== listingId) : [...current, listingId];
    const { error } = await supabase
      .from("hosts")
      .upsert({ user_id: userId, saved_listings: next } as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { saved: !has, saved_listings: next };
  });

export const getSavedListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: host } = await supabase
      .from("hosts")
      .select("saved_listings")
      .eq("user_id", userId)
      .maybeSingle();
    const ids = toIdArray((host as { saved_listings?: unknown } | null)?.saved_listings);
    if (ids.length === 0) return { items: [] as ListingCard[] };
    const ranked = await rankListingsWithMl({
      offset: 0,
      limit: Math.min(ids.length, 100),
      listing_ids: ids,
    });
    if (ranked) return { items: ranked.items };
    const { data: rows, error } = await getServerClient()
      .from("listings")
      .select("id, name, picture_url, host_picture_url, price")
      .in("id", listingIdFilterArray(ids));
    if (error) throw new Error(error.message);
    return { items: (rows ?? []).map(toListingCard) };
  });

export const toggleInterestedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ listing_id: listingIdSchema }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("hosts")
      .select("listing_interested")
      .eq("user_id", userId)
      .maybeSingle();
    const listingId = data.listing_id;
    const current = toIdArray(
      (existing as { listing_interested?: unknown } | null)?.listing_interested,
    );
    const has = current.includes(listingId);
    const next = has ? current.filter((x) => x !== listingId) : [...current, listingId];
    const { error } = await supabase
      .from("hosts")
      .upsert({ user_id: userId, listing_interested: next } as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { interested: !has, listing_interested: next };
  });

const createListingSchema = z.object({
  name: z.string().trim().min(1).max(255),
  picture_url: z.string().url().max(2000),
  property_type: z.string().trim().min(1).max(100),
  accommodates: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  bedrooms: z.number().int().min(0),
  beds: z.number().int().min(0),
  price: z.number().min(0),
  amenities: z.array(z.string().min(1).max(100)).max(200),
  minimum_nights: z.number().int().min(0),
  availability_365: z.number().int().min(0),
  neighbourhood_cleansed: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10000),
  neighborhood_overview: z.string().trim().min(1).max(10000),
});

export const createListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createListingSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("hosts")
      .select("user_id, host_since, avatar_url, published_listings")
      .eq("user_id", userId)
      .maybeSingle();

    let host = existing;
    if (!host) {
      const { data: inserted, error: hostErr } = await supabase
        .from("hosts")
        .insert({ user_id: userId })
        .select("user_id, host_since, avatar_url, published_listings")
        .single();
      if (hostErr) throw new Error(hostErr.message);
      host = inserted;
    }

    const id = Date.now();
    const listingId = String(id);
    const nowIso = new Date().toISOString();
    const row = {
      id,
      name: data.name,
      picture_url: data.picture_url,
      host_picture_url: host?.avatar_url ?? null,
      host_since: host?.host_since ?? nowIso,
      host_is_superhost: "f",
      host_identity_verified: "f",
      property_type: data.property_type,
      accommodates: data.accommodates,
      bathrooms: String(data.bathrooms),
      bedrooms: String(data.bedrooms),
      beds: String(data.beds),
      price: `$${data.price.toFixed(2)}`,
      amenities: data.amenities,
      minimum_nights: data.minimum_nights,
      availability_365: data.availability_365,
      neighbourhood_cleansed: data.neighbourhood_cleansed,
      description: data.description,
      neighborhood_overview: data.neighborhood_overview,
    };

    const { error: insertErr } = await supabase.from("listings").insert(row);
    if (insertErr) throw new Error(insertErr.message);

    const currentPublished = toIdArray(
      (host as { published_listings?: unknown } | null)?.published_listings,
    );
    const nextPublished = [...currentPublished, listingId];
    const hostUpdate: { published_listings: ListingId[]; host_since?: string } = {
      published_listings: nextPublished,
    };
    if (!host?.host_since) hostUpdate.host_since = nowIso;
    const { error: updErr } = await supabase
      .from("hosts")
      .update(hostUpdate as never)
      .eq("user_id", userId);
    if (updErr) throw new Error(updErr.message);

    return { id: listingId };
  });

export const getPublishedListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: host } = await supabase
      .from("hosts")
      .select("published_listings")
      .eq("user_id", userId)
      .maybeSingle();
    const ids = toIdArray((host as { published_listings?: unknown } | null)?.published_listings);
    if (ids.length === 0) return { items: [] as ListingCard[] };
    const ranked = await rankListingsWithMl({
      offset: 0,
      limit: Math.min(ids.length, 100),
      listing_ids: ids,
    });
    if (ranked) return { items: ranked.items };
    const { data: rows, error } = await getServerClient()
      .from("listings")
      .select("id, name, picture_url, host_picture_url, price")
      .in("id", listingIdFilterArray(ids));
    if (error) throw new Error(error.message);
    return { items: (rows ?? []).map(toListingCard) };
  });

export const deleteMyListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ listing_id: listingIdSchema }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: host } = await supabase
      .from("hosts")
      .select("published_listings")
      .eq("user_id", userId)
      .maybeSingle();
    const listingId = data.listing_id;
    const current = toIdArray(
      (host as { published_listings?: unknown } | null)?.published_listings,
    );
    if (!current.includes(listingId)) {
      throw new Error("Listing not owned by user");
    }
    const { data: deleted, error: delErr } = await supabase
      .from("listings")
      .delete()
      .eq("id", listingIdFilter(listingId))
      .select("id");
    if (delErr) throw new Error(delErr.message);
    if (!deleted || deleted.length === 0) {
      throw new Error("Delete blocked by RLS or row missing");
    }
    const next = current.filter((x) => x !== listingId);
    const { error: updErr } = await supabase
      .from("hosts")
      .update({ published_listings: next } as never)
      .eq("user_id", userId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, published_listings: next };
  });
