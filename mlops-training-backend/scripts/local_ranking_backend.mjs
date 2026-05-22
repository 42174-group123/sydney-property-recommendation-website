import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = readEnv(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT || ENV.ML_BACKEND_PORT || 8090);
const SUPABASE_URL = (ENV.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY || "";
const LISTING_CACHE_MS = Number(ENV.RANKING_LISTING_CACHE_SECONDS || 300) * 1000;
const USER_ACTION_CACHE_MS = Number(ENV.RANKING_USER_ACTION_CACHE_SECONDS || 1800) * 1000;
const MAX_CANDIDATES = Number(ENV.MAX_RANKING_CANDIDATES || 20000);

const LISTING_SELECT = [
  "id::text",
  "name",
  "picture_url",
  "host_picture_url",
  "price",
  "property_type",
  "room_type",
  "accommodates",
  "bathrooms",
  "bathrooms_text",
  "bedrooms",
  "beds",
  "amenities",
  "minimum_nights",
  "availability_365",
  "instant_bookable",
  "neighbourhood_cleansed",
  "review_scores_rating",
  "number_of_reviews",
].join(",");

const EVENT_WEIGHTS = {
  open_listing: 0.25,
  view_images: 0.4,
  check_amenities: 0.45,
  check_location: 0.5,
  save_property: 0.8,
  contact_host: 1.0,
};

let listingCache = null;
const userCache = new Map();

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, {
        ok: true,
        backend: "node-local-ranking",
        listing_cache_seconds: LISTING_CACHE_MS / 1000,
        user_action_cache_seconds: USER_ACTION_CACHE_MS / 1000,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/rank-listings") {
      const body = await readJson(req);
      const response = await rankListings(body);
      json(res, 200, response);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local ranking backend listening on http://127.0.0.1:${PORT}`);
});

function readEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function rankListings(request) {
  const offset = clampInt(request.offset, 0, 100000, 0);
  const limit = clampInt(request.limit, 1, 100, 20);
  const listings = await getListings();
  const stats = buildStats(listings);
  const userContext = await getUserContext(request.user_id, listings, stats);

  let candidates = applyFilters(listings, request.filters || {});
  if (Array.isArray(request.listing_ids) && request.listing_ids.length > 0) {
    const wanted = new Set(request.listing_ids.map(String));
    candidates = candidates.filter((listing) => wanted.has(listing.id));
  }
  candidates = candidates.slice(0, MAX_CANDIDATES);

  const scored = candidates.map((listing) => scoreListing(listing, userContext, stats));
  const minCombined = Math.min(...scored.map((item) => item.combined_score), 0);
  const maxCombined = Math.max(...scored.map((item) => item.combined_score), 1);
  for (const item of scored) {
    const scaled =
      maxCombined > minCombined
        ? ((item.combined_score - minCombined) / (maxCombined - minCombined)) * 10
        : item.combined_score * 10;
    item.match_score = round(Math.max(0, Math.min(10, scaled)), 1);
  }

  scored.sort((a, b) => b.combined_score - a.combined_score || compareIds(a.id, b.id));
  return {
    items: scored.slice(offset, offset + limit),
    nextOffset: offset + Math.min(limit, Math.max(0, scored.length - offset)),
    total: scored.length,
    model_source: "node_heuristic_local",
  };
}

async function getListings() {
  const now = Date.now();
  if (listingCache && now - listingCache.loadedAt < LISTING_CACHE_MS) return listingCache.rows;
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < MAX_CANDIDATES; offset += pageSize) {
    const page = await supabaseGet("listings", {
      select: LISTING_SELECT,
      order: "id.asc",
      limit: String(pageSize),
      offset: String(offset),
    });
    rows.push(...page.map(normaliseListing));
    if (page.length < pageSize) break;
  }
  listingCache = { loadedAt: now, rows };
  return rows;
}

async function getUserContext(userId, listings, stats) {
  if (!userId || !isUuid(userId)) return defaultUserContext(listings, stats, "unknown");
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.loadedAt < USER_ACTION_CACHE_MS) return cached.context;

  const [actions, hostRows] = await Promise.all([
    supabaseGet("user_action", {
      select: "event_id,user_id,user_type,property_id::text,event_type,event_timestamp",
      user_id: `eq.${userId}`,
      order: "event_timestamp.asc",
      limit: "5000",
    }).catch(() => []),
    supabaseGet("hosts", {
      select: "user_type",
      user_id: `eq.${userId}`,
      limit: "1",
    }).catch(() => []),
  ]);

  const userType = String(hostRows[0]?.user_type || actions.at(-1)?.user_type || "unknown");
  const context = buildUserContext(actions, listings, stats, userType);
  userCache.set(userId, { loadedAt: Date.now(), context });
  return context;
}

async function supabaseGet(table, params) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase env vars missing");
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${table} request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function normaliseListing(row) {
  return {
    ...row,
    id: String(row.id),
    price_num: numberFromText(row.price),
    accommodates_num: toNumber(row.accommodates),
    bathrooms_num: toNumber(row.bathrooms) ?? numberFromText(row.bathrooms_text),
    bedrooms_num: toNumber(row.bedrooms),
    beds_num: toNumber(row.beds),
    minimum_nights_num: toNumber(row.minimum_nights),
    availability_num: toNumber(row.availability_365),
    review_rating_num: toNumber(row.review_scores_rating),
    reviews_num: toNumber(row.number_of_reviews),
    amenities_count: countAmenities(row.amenities),
  };
}

function applyFilters(listings, filters) {
  return listings.filter((listing) => {
    if (filters.min_accommodates != null && listing.accommodates_num < filters.min_accommodates) return false;
    if (filters.min_bathrooms != null && listing.bathrooms_num < filters.min_bathrooms) return false;
    if (filters.min_bedrooms != null && listing.bedrooms_num < filters.min_bedrooms) return false;
    if (filters.min_beds != null && listing.beds_num < filters.min_beds) return false;
    if (filters.min_price != null && listing.price_num < filters.min_price) return false;
    if (filters.max_price != null && listing.price_num > filters.max_price) return false;
    if (filters.min_nights != null && listing.minimum_nights_num < filters.min_nights) return false;
    if (filters.instant_bookable === true && String(listing.instant_bookable).toLowerCase() !== "t") return false;
    if (
      filters.neighbourhood &&
      String(listing.neighbourhood_cleansed || "").toLowerCase() !== String(filters.neighbourhood).toLowerCase()
    ) {
      return false;
    }
    return true;
  });
}

function buildStats(listings) {
  const fields = [
    "price_num",
    "accommodates_num",
    "bathrooms_num",
    "bedrooms_num",
    "beds_num",
    "minimum_nights_num",
    "availability_num",
    "amenities_count",
  ];
  const stats = {};
  for (const field of fields) {
    const values = listings.map((item) => item[field]).filter(Number.isFinite);
    stats[field] = {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.5,
    };
  }
  return stats;
}

function buildUserContext(actions, listings, stats, userType) {
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const weighted = [];
  for (const action of actions) {
    const listing = byId.get(String(action.property_id));
    if (!listing) continue;
    const weight = EVENT_WEIGHTS[action.event_type] ?? 0.15;
    weighted.push({ listing, weight });
  }
  if (weighted.length === 0) return defaultUserContext(listings, stats, userType);

  const weightedAvg = (field) => {
    let total = 0;
    let weightTotal = 0;
    for (const item of weighted) {
      const value = norm(item.listing[field], stats[field]);
      if (!Number.isFinite(value)) continue;
      total += value * item.weight;
      weightTotal += item.weight;
    }
    return weightTotal ? total / weightTotal : 0.5;
  };

  return {
    userType,
    price: weightedAvg("price_num"),
    accommodates: weightedAvg("accommodates_num"),
    bathrooms: weightedAvg("bathrooms_num"),
    bedrooms: weightedAvg("bedrooms_num"),
    beds: weightedAvg("beds_num"),
    minimumNights: weightedAvg("minimum_nights_num"),
    amenities: weightedAvg("amenities_count"),
    totalEvents: weighted.length,
    strongRate: weighted.filter((item) => item.weight >= 0.8).length / weighted.length,
  };
}

function defaultUserContext(listings, stats, userType) {
  return {
    userType,
    price: norm(stats.price_num.mean, stats.price_num),
    accommodates: norm(stats.accommodates_num.mean, stats.accommodates_num),
    bathrooms: norm(stats.bathrooms_num.mean, stats.bathrooms_num),
    bedrooms: norm(stats.bedrooms_num.mean, stats.bedrooms_num),
    beds: norm(stats.beds_num.mean, stats.beds_num),
    minimumNights: norm(stats.minimum_nights_num.mean, stats.minimum_nights_num),
    amenities: norm(stats.amenities_count.mean, stats.amenities_count),
    totalEvents: 0,
    strongRate: 0,
  };
}

function scoreListing(listing, user, stats) {
  const priceFit = fit(norm(listing.price_num, stats.price_num), user.price);
  const spaceFit =
    (fit(norm(listing.accommodates_num, stats.accommodates_num), user.accommodates) +
      fit(norm(listing.bathrooms_num, stats.bathrooms_num), user.bathrooms) +
      fit(norm(listing.bedrooms_num, stats.bedrooms_num), user.bedrooms) +
      fit(norm(listing.beds_num, stats.beds_num), user.beds)) /
    4;
  const nightFit = fit(norm(listing.minimum_nights_num, stats.minimum_nights_num), user.minimumNights);
  const amenityFit = fit(norm(listing.amenities_count, stats.amenities_count), user.amenities);
  const reviewQuality = reviewScore(listing, stats);
  const eventSignal = Math.min(0.2, Math.log1p(user.totalEvents) / Math.log1p(50) * 0.08 + user.strongRate * 0.12);
  const typeBonus = userTypeBonus(user.userType, listing, priceFit, spaceFit, reviewQuality);
  const userPreference = clamp01(
    0.3 * priceFit + 0.24 * spaceFit + 0.14 * nightFit + 0.14 * amenityFit + 0.18 * reviewQuality + eventSignal + typeBonus,
  );
  const combined = clamp01(0.6 * userPreference + 0.4 * reviewQuality);
  return {
    id: listing.id,
    name: listing.name ?? null,
    picture_url: listing.picture_url ?? null,
    host_picture_url: listing.host_picture_url ?? null,
    price: listing.price ?? null,
    match_score: null,
    combined_score: round(combined, 6),
    user_preference_score: round(userPreference, 6),
    review_quality_score: round(reviewQuality, 6),
    review_scores_rating_final: round((listing.review_rating_num ?? reviewQuality * 100), 3),
    review_score_source: Number.isFinite(listing.review_rating_num) ? "real" : "heuristic",
  };
}

function reviewScore(listing, stats) {
  if (Number.isFinite(listing.review_rating_num)) return clamp01(listing.review_rating_num / 100);
  const amenities = norm(listing.amenities_count, stats.amenities_count);
  const availability = norm(listing.availability_num, stats.availability_num);
  const reviews = Math.min(1, Math.log1p(listing.reviews_num || 0) / Math.log1p(100));
  return clamp01(0.45 * amenities + 0.35 * availability + 0.2 * reviews);
}

function userTypeBonus(userType, listing, priceFit, spaceFit, reviewQuality) {
  const type = String(userType || "").toLowerCase();
  const property = `${listing.property_type || ""} ${listing.room_type || ""}`.toLowerCase();
  let bonus = 0;
  if (type.includes("budget")) bonus += priceFit * 0.08;
  if (type.includes("luxury")) bonus += reviewQuality * 0.08;
  if (type.includes("family") || type.includes("large")) bonus += spaceFit * 0.06;
  if (type.includes("business") && /hotel|apartment|entire/.test(property)) bonus += 0.05;
  if (type.includes("couple") && /apartment|suite|studio|private/.test(property)) bonus += 0.04;
  return Math.min(0.12, bonus);
}

function countAmenities(raw) {
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw !== "string") return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return raw.split(",").filter(Boolean).length;
  }
}

function numberFromText(value) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function norm(value, stat) {
  if (!Number.isFinite(value)) return 0.5;
  if (!stat || stat.max <= stat.min) return 0.5;
  return clamp01((value - stat.min) / (stat.max - stat.min));
}

function fit(a, b) {
  return clamp01(1 - Math.abs(a - b));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareIds(a, b) {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return String(a).localeCompare(String(b));
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}
