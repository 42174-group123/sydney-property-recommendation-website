import type { ListingCard as ListingCardType } from "@/lib/listings.functions";

const placeholderImg =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Crect width='640' height='480' fill='%23e2e8f0'/%3E%3Cpath d='M88 384l142-162 104 118 64-72 154 116H88z' fill='%2394a3b8'/%3E%3Ccircle cx='456' cy='144' r='52' fill='%23cbd5e1'/%3E%3C/svg%3E";

function formatPrice(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Math.round(Number(m[0]));
  if (!Number.isFinite(n)) return null;
  return `$${n}AUD total`;
}

export function ListingCard({
  listing,
  onClick,
}: {
  listing: ListingCardType;
  onClick: () => void;
}) {
  const price = formatPrice(listing.price);
  const matchScore =
    typeof listing.match_score === "number" && Number.isFinite(listing.match_score)
      ? listing.match_score.toFixed(1)
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative block w-full text-left transition-transform hover:scale-[1.02]"
    >
      <div className="overflow-hidden rounded-xl border-2 border-muted-foreground/40 bg-card">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
          <img
            src={listing.picture_url || placeholderImg}
            alt={listing.name ?? "Listing"}
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== placeholderImg) img.src = placeholderImg;
            }}
            className="h-full w-full object-cover"
          />
          {matchScore ? (
            <div className="absolute right-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs font-bold text-foreground shadow-sm backdrop-blur">
              Match {matchScore}
            </div>
          ) : null}
        </div>
        <div className="flex min-h-[88px] items-center gap-3 bg-muted/60 px-3 py-3">
          {listing.host_picture_url ? (
            <img
              src={listing.host_picture_url}
              alt="Host"
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-full border-2 border-muted-foreground/40 object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-bold text-foreground">
              {listing.name ?? "Untitled"}
            </p>
            <p className="mt-0.5 text-xs font-light text-muted-foreground min-h-4">
              {price ?? "\u00A0"}
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
