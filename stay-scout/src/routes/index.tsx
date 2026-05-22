import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  listListings,
  getMyHost,
  logUserAction,
  searchListings,
  type ListingCard as ListingCardType,
} from "@/lib/listings.functions";
import { RotatingPrompt } from "@/components/RotatingPrompt";
import { FilterPanel, type Filters } from "@/components/FilterPanel";
import { ListingCard } from "@/components/ListingCard";
import { LoginGateModal, GoogleIcon } from "@/components/LoginGateModal";
import { BecomeHostModal } from "@/components/BecomeHostModal";
import { TravelTypeModal } from "@/components/TravelTypeModal";
import { AvatarMenu } from "@/components/AvatarMenu";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
});

const PAGE_SIZE = 20;
const DEFAULT_ML_BACKEND_URL = "https://stay-scout-ml-backend.onrender.com";
const FILTER_STORAGE_KEY = "stay-scout.activeFilters";

function hasAnyFilter(filters: Filters): boolean {
  return Object.values(filters).some((value) => value !== null && value !== "");
}

function toStoredNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStoredFilters(): Filters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    const filters: Filters = {
      min_accommodates: toStoredNumber(parsed.min_accommodates),
      min_bathrooms: toStoredNumber(parsed.min_bathrooms),
      min_bedrooms: toStoredNumber(parsed.min_bedrooms),
      min_beds: toStoredNumber(parsed.min_beds),
      min_price: toStoredNumber(parsed.min_price),
      max_price: toStoredNumber(parsed.max_price),
      min_nights: toStoredNumber(parsed.min_nights),
      instant_bookable: parsed.instant_bookable === true ? true : null,
      neighbourhood:
        typeof parsed.neighbourhood === "string" && parsed.neighbourhood.trim()
          ? parsed.neighbourhood.trim()
          : null,
    };
    return hasAnyFilter(filters) ? filters : null;
  } catch {
    return null;
  }
}

function writeStoredFilters(filters: Filters | null) {
  if (typeof window === "undefined") return;
  if (filters && hasAnyFilter(filters)) {
    window.sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    return;
  }
  window.sessionStorage.removeItem(FILTER_STORAGE_KEY);
}

async function rankListingsFromBrowser({
  filters,
  offset,
  limit,
  userId,
}: {
  filters: Filters;
  offset: number;
  limit: number;
  userId?: string | null;
}): Promise<{ items: ListingCardType[]; nextOffset: number }> {
  const baseUrl = import.meta.env.VITE_ML_BACKEND_URL || DEFAULT_ML_BACKEND_URL;

  const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/rank-listings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: userId ?? null,
      offset,
      limit,
      filters: {
        min_accommodates: filters.min_accommodates,
        min_bathrooms: filters.min_bathrooms,
        min_bedrooms: filters.min_bedrooms,
        min_beds: filters.min_beds,
        min_price: filters.min_price,
        max_price: filters.max_price,
        min_nights: filters.min_nights,
        instant_bookable: filters.instant_bookable,
        neighbourhood: filters.neighbourhood,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`ML ranking backend returned ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    items?: Array<ListingCardType & { id: unknown }>;
    nextOffset?: number;
  };
  const items = (payload.items ?? []).map((item) => ({ ...item, id: String(item.id) }));
  const unscored = items.filter(
    (item) => typeof item.match_score !== "number" || !Number.isFinite(item.match_score),
  );
  if (unscored.length > 0) {
    throw new Error(`ML ranking backend returned ${unscored.length} unscored listings`);
  }

  return { items, nextOffset: payload.nextOffset ?? offset + items.length };
}

function Index() {
  const navigate = useNavigate();
  const { isAuthenticated, user, signOut } = useAuth();
  const [gateOpen, setGateOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const queryClient = useQueryClient();
  const fetchListings = useServerFn(listListings);
  const fetchMyHost = useServerFn(getMyHost);
  const recordUserAction = useServerFn(logUserAction);
  const fetchFiltered = useServerFn(searchListings);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFiltersState] = useState<Filters | null>(() => readStoredFilters());

  const setActiveFilters = (next: Filters | null) => {
    setFiltersState(next);
    writeStoredFilters(next);
  };

  const hostQuery = useQuery({
    queryKey: ["myHost"],
    queryFn: () => fetchMyHost({}),
    enabled: isAuthenticated,
  });
  const needsTravelType = isAuthenticated && hostQuery.data != null && !hostQuery.data.user_type;

  useEffect(() => {
    if (!isAuthenticated) return;
    if (hostQuery.isLoading) return;
    if (hostQuery.data) return;
    const t = setTimeout(() => hostQuery.refetch(), 800);
    return () => clearTimeout(t);
  }, [isAuthenticated, hostQuery]);

  const query = useInfiniteQuery({
    queryKey: ["listings", filters, user?.id ?? null],
    queryFn: ({ pageParam }) => {
      if (!filters) {
        return fetchListings({ data: { offset: pageParam, limit: PAGE_SIZE } });
      }
      if (import.meta.env.VITE_ML_BACKEND_URL || import.meta.env.PROD) {
        return rankListingsFromBrowser({
          filters,
          offset: pageParam,
          limit: PAGE_SIZE,
          userId: user?.id,
        });
      }
      return fetchFiltered({ data: { offset: pageParam, limit: PAGE_SIZE, ...filters } });
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.items.length < PAGE_SIZE ? undefined : last.nextOffset),
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (!query.hasNextPage || query.isFetchingNextPage) return;
        if (!isAuthenticated) {
          setGateOpen(true);
          return;
        }
        query.fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isAuthenticated, query]);

  const handleCardClick = async (id: string) => {
    if (!isAuthenticated) {
      setGateOpen(true);
      return;
    }
    try {
      await recordUserAction({ data: { property_id: id, event_type: "open_listing" } });
    } catch (e: unknown) {
      console.error("logUserAction(open_listing) failed", e);
    }
    navigate({ to: "/listing/$id", params: { id: String(id) } });
  };

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
  };

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="min-h-screen bg-secondary">
      <header className="flex items-start justify-end gap-3 px-6 py-4">
        {isAuthenticated ? (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <AvatarMenu email={user?.email} />
              <button
                onClick={() => signOut()}
                className="rounded-md bg-card px-3 py-2 text-xs font-medium shadow-sm hover:bg-muted"
              >
                Sign out
              </button>
            </div>
            <button
              onClick={() => setHostOpen(true)}
              className="rounded-md border-2 border-muted-foreground/30 bg-card px-4 py-2.5 text-sm font-bold shadow-sm hover:bg-muted bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500 bg-clip-text text-transparent"
            >
              Become a host!
            </button>
          </div>
        ) : (
          <button
            onClick={signIn}
            className="flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-medium shadow-sm hover:bg-muted"
          >
            <GoogleIcon /> Login with Google
          </button>
        )}
      </header>

      <div className="flex flex-col items-center gap-4 px-4 pb-10 pt-2">
        <div className="relative w-full max-w-3xl">
          {!isAuthenticated && !filtersOpen ? (
            <button
              type="button"
              aria-label="Log in to use filters"
              onClick={() => setGateOpen(true)}
              className="absolute inset-0 z-10 rounded-full"
            />
          ) : null}
          <div
            role={filtersOpen ? undefined : "button"}
            tabIndex={filtersOpen ? -1 : 0}
            onClick={() => {
              if (filtersOpen) return;
              setFiltersOpen(true);
            }}
            onKeyDown={(e) => {
              if (filtersOpen) return;
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              setFiltersOpen(true);
            }}
            aria-expanded={filtersOpen}
            className={[
              "w-full overflow-hidden bg-secondary shadow-sm",
              "transition-all duration-500 ease-in-out",
              filtersOpen
                ? "rounded-2xl cursor-default"
                : "rounded-full cursor-pointer hover:scale-[1.01]",
            ].join(" ")}
          >
          <div className="relative">
            <div
              className={[
                "transition-all duration-300",
                filtersOpen ? "pointer-events-none max-h-0 opacity-0" : "max-h-40 opacity-100",
              ].join(" ")}
            >
              <RotatingPrompt />
            </div>
            <div
              className={[
                "transition-all duration-500 ease-in-out",
                filtersOpen
                  ? "max-h-[1200px] opacity-100 delay-150"
                  : "pointer-events-none max-h-0 opacity-0",
              ].join(" ")}
            >
              <FilterPanel
                initialFilters={filters}
                onApply={(f) => {
                  const next = hasAnyFilter(f) ? f : null;
                  setActiveFilters(next);
                  setFiltersOpen(false);
                }}
                onClose={() => setFiltersOpen(false)}
              />
            </div>
          </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 pb-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} onClick={() => handleCardClick(l.id)} />
          ))}
        </div>

        {query.isLoading ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : null}

        {query.hasNextPage ? (
          <div ref={sentinelRef} className="h-16" />
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">You've reached the end.</p>
        )}
      </main>

      <LoginGateModal open={gateOpen} onClose={() => setGateOpen(false)} />
      <BecomeHostModal
        open={hostOpen}
        onClose={() => setHostOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["listings"] })}
      />
      <TravelTypeModal
        open={needsTravelType}
        onDone={() => queryClient.invalidateQueries({ queryKey: ["myHost"] })}
      />
    </div>
  );
}
