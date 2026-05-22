import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listListings,
  searchListings,
  getMyHost,
  logUserAction,
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

function normalizeRankedPage(page: {
  items?: Array<ListingCardType & { id: unknown }>;
  nextOffset?: number;
}): { items: ListingCardType[]; nextOffset: number } {
  const items = (page.items ?? []).map((item) => ({ ...item, id: String(item.id) }));
  const unscored = items.filter(
    (item) => typeof item.match_score !== "number" || !Number.isFinite(item.match_score),
  );
  if (unscored.length > 0) {
    throw new Error(`ML ranking backend returned ${unscored.length} unscored listings`);
  }

  return { items, nextOffset: page.nextOffset ?? items.length };
}

function Index() {
  const navigate = useNavigate();
  const { isAuthenticated, user, signOut } = useAuth();
  const [gateOpen, setGateOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const queryClient = useQueryClient();
  const fetchListings = useServerFn(listListings);
  const fetchRankedListings = useServerFn(searchListings);
  const fetchMyHost = useServerFn(getMyHost);
  const recordUserAction = useServerFn(logUserAction);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFiltersState] = useState<Filters | null>(() => readStoredFilters());
  const [rankedPages, setRankedPages] = useState<
    Array<{ items: ListingCardType[]; nextOffset: number }>
  >([]);
  const [rankedLoading, setRankedLoading] = useState(false);
  const [rankedHasMore, setRankedHasMore] = useState(false);
  const [rankedNextOffset, setRankedNextOffset] = useState(0);
  const [rankingError, setRankingError] = useState<string | null>(null);

  const setActiveFilters = (next: Filters | null) => {
    setFiltersState(next);
    writeStoredFilters(next);
  };

  const requireLogin = useCallback(() => {
    setGateOpen(true);
  }, []);

  const resolveUserId = useCallback(async () => {
    if (user?.id) return user.id;
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  }, [user?.id]);

  const loadRankedListings = useCallback(
    async (activeFilters: Filters, offset: number, replace: boolean) => {
      setRankedLoading(true);
      setRankingError(null);
      if (replace) {
        setRankedPages([]);
        setRankedHasMore(false);
        setRankedNextOffset(0);
      }

      const userId = await resolveUserId();
      if (!userId) {
        setRankedPages([]);
        setRankedHasMore(false);
        setRankedNextOffset(0);
        setRankedLoading(false);
        requireLogin();
        return;
      }

      try {
        const page = normalizeRankedPage(
          await fetchRankedListings({
            data: {
              ...activeFilters,
              offset,
              limit: PAGE_SIZE,
              user_id: userId,
            },
          }),
        );
        setRankedPages((prev) => (replace ? [page] : [...prev, page]));
        setRankedNextOffset(page.nextOffset);
        setRankedHasMore(page.items.length === PAGE_SIZE);
      } catch (error) {
        setRankingError(error instanceof Error ? error.message : "ML ranking request failed");
        setRankedHasMore(false);
        if (replace) setRankedPages([]);
      } finally {
        setRankedLoading(false);
      }
    },
    [fetchRankedListings, requireLogin, resolveUserId],
  );

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
    queryKey: ["listings"],
    queryFn: ({ pageParam }) => fetchListings({ data: { offset: pageParam, limit: PAGE_SIZE } }),
    initialPageParam: 0,
    enabled: filters === null,
    getNextPageParam: (last) => (last.items.length < PAGE_SIZE ? undefined : last.nextOffset),
  });

  useEffect(() => {
    if (!filters) {
      setRankedPages([]);
      setRankedHasMore(false);
      setRankedNextOffset(0);
      setRankingError(null);
      return;
    }
    if (!isAuthenticated || rankedLoading || rankedPages.length > 0) return;
    void loadRankedListings(filters, 0, true);
  }, [filters, isAuthenticated, loadRankedListings, rankedLoading, rankedPages.length]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (filters) {
          if (!rankedHasMore || rankedLoading) return;
          if (!isAuthenticated) {
            setGateOpen(true);
            return;
          }
          void loadRankedListings(filters, rankedNextOffset, false);
          return;
        }
        if (!query.hasNextPage || query.isFetchingNextPage) return;
        if (!isAuthenticated) {
          setGateOpen(true);
          return;
        }
        void query.fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [
    filters,
    isAuthenticated,
    loadRankedListings,
    query,
    rankedHasMore,
    rankedLoading,
    rankedNextOffset,
  ]);

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

  const items = filters
    ? rankedPages.flatMap((p) => p.items)
    : (query.data?.pages.flatMap((p) => p.items) ?? []);
  const isListLoading = filters ? rankedLoading : query.isLoading;
  const hasMoreListings = filters ? rankedHasMore : query.hasNextPage;

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
              onClick={() => {
                if (!isAuthenticated) {
                  requireLogin();
                  return;
                }
                setHostOpen(true);
              }}
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
        <div
          role={filtersOpen ? undefined : "button"}
          tabIndex={filtersOpen ? -1 : 0}
          onClick={() => {
            if (filtersOpen) return;
            if (!isAuthenticated) {
              requireLogin();
              return;
            }
            setFiltersOpen(true);
          }}
          onKeyDown={(e) => {
            if (filtersOpen) return;
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            if (!isAuthenticated) {
              requireLogin();
              return;
            }
            setFiltersOpen(true);
          }}
          aria-expanded={filtersOpen}
          className={[
            "w-full max-w-3xl overflow-hidden bg-secondary shadow-sm",
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
                  if (!isAuthenticated) {
                    setFiltersOpen(false);
                    setActiveFilters(null);
                    requireLogin();
                    return;
                  }
                  const next = hasAnyFilter(f) ? f : null;
                  setFiltersOpen(false);
                  setActiveFilters(next);
                  if (next) {
                    setRankedPages([]);
                    setRankedHasMore(false);
                    setRankedNextOffset(0);
                    setRankingError(null);
                    void loadRankedListings(next, 0, true);
                  }
                }}
                onClose={() => setFiltersOpen(false)}
              />
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

        {isListLoading ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : null}

        {rankingError ? (
          <p className="mt-10 text-center text-sm text-destructive">{rankingError}</p>
        ) : null}

        {hasMoreListings ? (
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
