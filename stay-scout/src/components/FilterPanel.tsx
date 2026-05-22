import { useEffect, useMemo, useState } from "react";

const NEIGHBOURHOODS = [
  "Sydney",
  "Mosman",
  "Hornsby",
  "Randwick",
  "Waverley",
  "Ku-Ring-Gai",
  "Woollahra",
  "North Sydney",
  "Marrickville",
  "Leichhardt",
  "Warringah",
  "City Of Kogarah",
  "Pittwater",
  "Willoughby",
  "Manly",
  "Canada Bay",
  "Sutherland Shire",
  "Hurstville",
  "Auburn",
  "Hunters Hill",
  "Camden",
  "Lane Cove",
  "Parramatta",
  "Ashfield",
  "Blacktown",
  "Canterbury",
  "Rockdale",
  "Botany Bay",
  "The Hills Shire",
  "Ryde",
  "Penrith",
  "Liverpool",
  "Bankstown",
  "Holroyd",
  "Burwood",
  "Campbelltown",
  "Strathfield",
  "Fairfield",
];

export type Filters = {
  min_accommodates: number | null;
  min_bathrooms: number | null;
  min_bedrooms: number | null;
  min_beds: number | null;
  min_price: number | null;
  max_price: number | null;
  min_nights: number | null;
  instant_bookable: boolean | null;
  neighbourhood: string | null;
};

const EMPTY: Filters = {
  min_accommodates: null,
  min_bathrooms: null,
  min_bedrooms: null,
  min_beds: null,
  min_price: null,
  max_price: null,
  min_nights: null,
  instant_bookable: null,
  neighbourhood: null,
};

function toNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInputValue(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

export function FilterPanel({
  initialFilters,
  onApply,
  onClose,
}: {
  initialFilters?: Filters | null;
  onApply: (f: Filters, action?: "apply" | "reset") => void;
  onClose?: () => void;
}) {
  const [accommodates, setAccommodates] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [beds, setBeds] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minNights, setMinNights] = useState("");
  const [instant, setInstant] = useState(false);
  const [neighbourhood, setNeighbourhood] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [neighbourhoodErr, setNeighbourhoodErr] = useState<string | null>(null);

  useEffect(() => {
    const filters = initialFilters ?? EMPTY;
    setAccommodates(toInputValue(filters.min_accommodates));
    setBathrooms(toInputValue(filters.min_bathrooms));
    setBedrooms(toInputValue(filters.min_bedrooms));
    setBeds(toInputValue(filters.min_beds));
    setMinPrice(toInputValue(filters.min_price));
    setMaxPrice(toInputValue(filters.max_price));
    setMinNights(toInputValue(filters.min_nights));
    setInstant(filters.instant_bookable === true);
    setNeighbourhood(filters.neighbourhood ?? "");
    setErr(null);
    setNeighbourhoodErr(null);
  }, [initialFilters]);

  const suggestions = useMemo(() => {
    const q = neighbourhood.trim().toLowerCase();
    if (!q) return [];
    return NEIGHBOURHOODS.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [neighbourhood]);

  const validateNeighbourhood = () => {
    const v = neighbourhood.trim();
    if (!v) {
      setNeighbourhoodErr(null);
      return true;
    }
    const match = NEIGHBOURHOODS.find((n) => n.toLowerCase() === v.toLowerCase());
    if (!match) {
      setNeighbourhoodErr("Place doesn't exist, please try again.");
      return false;
    }
    setNeighbourhoodErr(null);
    return true;
  };

  const handleConfirm = () => {
    let neighbourhoodValue: string | null = null;
    if (neighbourhood.trim()) {
      const match = NEIGHBOURHOODS.find(
        (n) => n.toLowerCase() === neighbourhood.trim().toLowerCase(),
      );
      if (!match) {
        setNeighbourhoodErr("Place doesn't exist, please try again.");
        return;
      }
      neighbourhoodValue = match;
    }
    setErr(null);
    onApply(
      {
        min_accommodates: toNum(accommodates),
        min_bathrooms: toNum(bathrooms),
        min_bedrooms: toNum(bedrooms),
        min_beds: toNum(beds),
        min_price: toNum(minPrice),
        max_price: toNum(maxPrice),
        min_nights: toNum(minNights),
        instant_bookable: instant ? true : null,
        neighbourhood: neighbourhoodValue,
      },
      "apply",
    );
  };

  const handleReset = () => {
    setAccommodates("");
    setBathrooms("");
    setBedrooms("");
    setBeds("");
    setMinPrice("");
    setMaxPrice("");
    setMinNights("");
    setInstant(false);
    setNeighbourhood("");
    setErr(null);
    setNeighbourhoodErr(null);
    onApply(EMPTY, "reset");
  };

  const fieldCls =
    "w-full rounded-md border border-muted-foreground/30 bg-card px-3 py-2 text-sm focus:border-foreground focus:outline-none";

  return (
    <div className="w-full rounded-3xl bg-secondary px-8 py-6 shadow-sm">
      <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
        <Field label="Minimum group size">
          <input
            type="number"
            min={0}
            value={accommodates}
            onChange={(e) => setAccommodates(e.target.value)}
            className={fieldCls}
          />
        </Field>
        <Field label="Minimum night">
          <input
            type="number"
            min={0}
            value={minNights}
            onChange={(e) => setMinNights(e.target.value)}
            className={fieldCls}
          />
        </Field>
        <Field label="Minimum bathrooms">
          <input
            type="number"
            min={0}
            step="0.5"
            value={bathrooms}
            onChange={(e) => setBathrooms(e.target.value)}
            className={fieldCls}
          />
        </Field>
        <Field label="Instant bookable">
          <label className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={instant}
              onChange={(e) => setInstant(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </Field>
        <Field label="Minimum bedrooms">
          <input
            type="number"
            min={0}
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value)}
            className={fieldCls}
          />
        </Field>
        <Field label="Neighbourhood">
          <div className="relative">
            <input
              type="text"
              value={neighbourhood}
              onChange={(e) => {
                setNeighbourhood(e.target.value);
                setShowSuggest(true);
                setNeighbourhoodErr(null);
              }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() =>
                setTimeout(() => {
                  setShowSuggest(false);
                  validateNeighbourhood();
                }, 150)
              }
              className={fieldCls}
              placeholder="Start typing…"
              autoComplete="off"
            />
            {showSuggest && suggestions.length > 0 ? (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-muted-foreground/30 bg-card shadow-lg">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setNeighbourhood(s);
                        setShowSuggest(false);
                        setNeighbourhoodErr(null);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {neighbourhoodErr ? (
              <p className="mt-1 text-xs text-destructive">{neighbourhoodErr}</p>
            ) : null}
          </div>
        </Field>
        <Field label="Minimum beds">
          <input
            type="number"
            min={0}
            value={beds}
            onChange={(e) => setBeds(e.target.value)}
            className={fieldCls}
          />
        </Field>
        <Field label="Price range">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className={fieldCls}
              placeholder="Min"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="number"
              min={0}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className={fieldCls}
              placeholder="Max"
            />
          </div>
        </Field>
      </div>

      {err ? <p className="mt-3 text-sm text-destructive">{err}</p> : null}

      <div className="mt-6 flex justify-end gap-3">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
          >
            Close
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-muted"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="rounded-md bg-foreground px-5 py-2 text-sm font-bold text-background shadow-sm hover:opacity-90"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
