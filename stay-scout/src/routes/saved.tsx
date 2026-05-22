import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { getSavedListings, toggleSavedListing } from "@/lib/listings.functions";
import { useAuth } from "@/hooks/use-auth";
import { LoginGateModal } from "@/components/LoginGateModal";
import placeholderImg from "@/assets/listing-placeholder.png";

export const Route = createFileRoute("/saved")({
  component: SavedPage,
});

function SavedPage() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const fetchSaved = useServerFn(getSavedListings);
  const toggleSaved = useServerFn(toggleSavedListing);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["saved-listings"],
    queryFn: () => fetchSaved({}),
    enabled: isAuthenticated,
  });

  const removeMutation = useMutation({
    mutationFn: (listing_id: string) => toggleSaved({ data: { listing_id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-listings"] });
      queryClient.invalidateQueries({ queryKey: ["my-host"] });
    },
  });

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
          message="Please log in to view saved properties."
        />
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="min-h-screen bg-secondary py-10">
      <div className="mx-auto max-w-3xl px-6">
        <Link
          to="/"
          className="mb-6 inline-block text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <h1 className="text-3xl font-bold text-foreground">Saved properties</h1>

        {isLoading ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            You haven't saved any properties yet.
          </p>
        ) : (
          <ul className="mt-8 flex flex-col gap-4">
            {items.map((l) => {
              const matchScore =
                typeof l.match_score === "number" && Number.isFinite(l.match_score)
                  ? l.match_score.toFixed(1)
                  : null;
              return (
                <li key={l.id}>
                  <Link
                    to="/listing/$id"
                    params={{ id: String(l.id) }}
                    search={{ from: "saved" }}
                    className="flex items-center gap-4 rounded-xl border-2 border-muted-foreground/30 bg-card p-3 hover:bg-muted"
                  >
                    <img
                      src={l.picture_url || placeholderImg}
                      alt={l.name ?? "Listing"}
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.src !== placeholderImg) img.src = placeholderImg;
                      }}
                      className="h-20 w-28 shrink-0 rounded-lg object-cover"
                    />
                    <p className="flex-1 text-sm font-semibold text-foreground">
                      {l.name ?? "Untitled"}
                    </p>
                    {matchScore ? (
                      <span className="rounded-md bg-background/90 px-2 py-1 text-xs font-bold text-foreground shadow-sm">
                        Match {matchScore}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeMutation.mutate(l.id);
                      }}
                      disabled={removeMutation.isPending}
                      aria-label="Remove from saved"
                      className="rounded-md p-2 text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Trash2 size={20} />
                    </button>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
