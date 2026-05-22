import type { ListingCard as ListingCardType } from "@/lib/listings.functions";
import placeholderImg from "@/assets/listing-placeholder.png";

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
