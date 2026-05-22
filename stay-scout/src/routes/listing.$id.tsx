import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Heart, Mail } from "lucide-react";
import { z } from "zod";
import {
  getListing,
  getMyHost,
  toggleSavedListing,
  toggleInterestedListing,
  logUserAction,
} from "@/lib/listings.functions";
import { useAuth } from "@/hooks/use-auth";
import { LoginGateModal } from "@/components/LoginGateModal";
import placeholderImg from "@/assets/listing-placeholder.png";
import envelopeSent from "@/assets/envelope-sent.png";

export const Route = createFileRoute("/listing/$id")({
  validateSearch: (search) => z.object({ from: z.string().optional() }).parse(search),
  component: ListingDetail,
});

function ListingDetail() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  const listingId = id;
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const fetchListing = useServerFn(getListing);
  const fetchHost = useServerFn(getMyHost);
  const toggleSaved = useServerFn(toggleSavedListing);
  const toggleInterested = useServerFn(toggleInterestedListing);
  const recordUserAction = useServerFn(logUserAction);
  const queryClient = useQueryClient();
  const [imageOpen, setImageOpen] = useState(false);
  const [showAllAmenities, setShowAllAmenities] = useState(false);

  const recordAction = (
    eventType:
      | "check_location"
      | "view_images"
      | "check_amenities"
      | "save_property"
      | "contact_host",
  ) => {
    recordUserAction({ data: { property_id: listingId, event_type: eventType } }).catch(
      (e: unknown) => console.error(`logUserAction(${eventType}) failed`, e),
    );
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["listing", listingId],
    queryFn: () => fetchListing({ data: { id: listingId } }),
    enabled: isAuthenticated && /^\d+$/.test(listingId),
  });

  const hostQuery = useQuery({
    queryKey: ["my-host"],
    queryFn: () => fetchHost({}),
    enabled: isAuthenticated,
  });
  const isSaved = (hostQuery.data?.saved_listings ?? []).map(String).includes(listingId);
  const isInterested = (hostQuery.data?.listing_interested ?? []).map(String).includes(listingId);

  const saveMutation = useMutation({
    mutationFn: () => toggleSaved({ data: { listing_id: listingId } }),
    onSuccess: (res) => {
      if ((res as { saved?: boolean } | undefined)?.saved) {
        recordAction("save_property");
      }
      queryClient.invalidateQueries({ queryKey: ["my-host"] });
      queryClient.invalidateQueries({ queryKey: ["saved-listings"] });
    },
  });

  const interestedMutation = useMutation({
    mutationFn: () => toggleInterested({ data: { listing_id: listingId } }),
    onSuccess: (res) => {
      if ((res as { interested?: boolean } | undefined)?.interested) {
        recordAction("contact_host");
      }
      queryClient.invalidateQueries({ queryKey: ["my-host"] });
    },
  });

  useEffect(() => {
    // If user is not authenticated, we'll show the modal blocking the page
  }, [isAuthenticated]);

  const goBackToResults = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate({ to: "/" });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary">Loading…</div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-secondary">
        <LoginGateModal
          open
          onClose={() => navigate({ to: "/" })}
          title="Login required"
          message="Please log in to view this property."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary">
        Loading property…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-secondary">
        <p>Property not found.</p>
        <button type="button" onClick={goBackToResults} className="text-sm underline">
          Back to home
        </button>
      </div>
    );
  }

  const isSuperhost = data.host_is_superhost === "t";
  const yearsHosted = computeYearsHosted(data.host_since);
  const hostInfo = [
    isSuperhost ? "Superhost" : null,
    yearsHosted != null ? `${yearsHosted} year hosting` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen bg-secondary py-10">
      <div className="mx-auto max-w-3xl px-6">
        {from === "saved" ? (
          <Link
            to="/saved"
            className="mb-6 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Link>
        ) : (
          <button
            type="button"
            onClick={goBackToResults}
            className="mb-6 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        )}

        <h1 className="text-4xl font-bold text-foreground">{data.name ?? "Untitled property"}</h1>

        <div className="mt-6 overflow-hidden rounded-2xl bg-muted">
          <img
            src={data.picture_url || placeholderImg}
            alt={data.name ?? "Property"}
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== placeholderImg) img.src = placeholderImg;
            }}
            onClick={() => {
              setImageOpen(true);
              recordAction("view_images");
            }}
            className="h-auto w-full cursor-zoom-in object-cover"
          />
        </div>

        {imageOpen ? (
          <div
            onClick={() => setImageOpen(false)}
            className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
          >
            <img
              src={data.picture_url || placeholderImg}
              alt={data.name ?? "Property"}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xl font-semibold text-foreground">
                {data.neighbourhood_cleansed ?? "Unknown area"}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.beds ?? "—"} bed · {data.bathrooms ?? "—"} bathroom
              </p>
            </div>
            {formatListingPrice(data.price) ? (
              <p className="text-2xl font-semibold text-foreground whitespace-nowrap">
                {formatListingPrice(data.price)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3">
          {data.host_picture_url ? (
            <img
              src={data.host_picture_url}
              alt="Host"
              className="h-12 w-12 rounded-full border-2 border-muted-foreground/40 object-cover"
            />
          ) : (
            <div className="h-12 w-12 rounded-full border-2 border-muted-foreground/40 bg-muted" />
          )}
          {hostInfo ? <p className="text-base font-semibold text-foreground">{hostInfo}</p> : null}
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-pink-400 bg-card px-4 py-2 text-sm font-semibold text-pink-500 hover:bg-pink-50 disabled:opacity-50"
          >
            <Heart size={16} className="text-pink-500" fill={isSaved ? "currentColor" : "none"} />
            {isSaved ? "saved" : "save"}
          </button>
        </div>

        <hr className="my-8 border-t border-muted-foreground/30" />

        <section>
          <h2 className="text-xl font-bold text-foreground">Description</h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/80">
            {data.description ?? "No description provided."}
          </p>
        </section>

        {data.neighborhood_overview ? (
          <section className="mt-8">
            <h2 className="text-xl font-bold text-foreground">Neighbourhood</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/80">
              {data.neighborhood_overview}
            </p>
          </section>
        ) : null}

        <hr className="my-8 border-t border-muted-foreground/30" />

        <section>
          <h2 className="text-xl font-bold text-foreground">Amenities</h2>
          {(() => {
            const all = parseAmenities(data.amenities);
            const visible = showAllAmenities ? all : all.slice(0, 4);
            return (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {visible.map((a, i) => (
                    <span
                      key={`${a}-${i}`}
                      className="rounded-full border border-muted-foreground/40 bg-card px-4 py-1.5 text-sm text-foreground"
                    >
                      {a}
                    </span>
                  ))}
                </div>
                {!showAllAmenities && all.length > visible.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllAmenities(true);
                      recordAction("check_amenities");
                    }}
                    className="mt-4 rounded-md border border-foreground bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Show all amenities
                  </button>
                ) : null}
              </>
            );
          })()}
        </section>

        <hr className="my-8 border-t border-muted-foreground/30" />

        <section>
          <h2 className="text-xl font-bold text-foreground">Location</h2>
          {data.latitude != null && data.longitude != null ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                recordAction("check_location");
              }}
              className="mt-4 inline-block rounded-md border border-foreground bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Open on Google Maps
            </a>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Location unavailable.</p>
          )}
        </section>

        <hr className="my-8 border-t border-muted-foreground/30" />

        <div className="flex justify-center pb-4">
          <button
            type="button"
            onClick={() => interestedMutation.mutate()}
            disabled={interestedMutation.isPending}
            className={`inline-flex items-center gap-3 rounded-full px-8 py-4 text-base font-semibold text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-60 ${
              isInterested
                ? "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500"
                : "bg-gradient-to-r from-pink-500 via-fuchsia-500 to-orange-400"
            }`}
          >
            {isInterested ? (
              <>
                Message sent!
                <img src={envelopeSent} alt="" className="h-6 w-6 brightness-0 invert" />
              </>
            ) : (
              <>
                Interested? let the host know!
                <Mail size={22} className="text-white" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function parseAmenities(raw: unknown): string[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === "string");
}

function computeYearsHosted(hostSince: string | null): number | null {
  if (!hostSince) return null;
  const d = new Date(hostSince);
  if (Number.isNaN(d.getTime())) return null;
  const years = new Date().getFullYear() - d.getFullYear();
  return years >= 0 ? years : null;
}

function formatListingPrice(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Math.round(Number(m[0]));
  if (!Number.isFinite(n)) return null;
  return `$${n}AUD`;
}
