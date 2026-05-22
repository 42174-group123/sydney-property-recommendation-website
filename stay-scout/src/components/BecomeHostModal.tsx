import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createListing } from "@/lib/listings.functions";

const SHARED_OPTIONS = ["Shared", "Private", "Entire"];
const TYPE_OPTIONS = ["Apartment", "House", "Nature", "Unique", "Hotel"];

const AMENITY_PRESETS = [
  "wifi","ethernet","tv","hdtv","netflix","chromecast","apple tv","fire tv","roku",
  "sound system","air conditioning","heating","fan","kitchen","refrigerator","fridge",
  "oven","stove","cooktop","microwave","dishwasher","coffee maker","espresso","nespresso",
  "kettle","toaster","washer","dryer","drying rack","shampoo","conditioner","body soap",
  "body wash","bed linens","extra pillows","hangers","clothing storage","workspace","desk",
  "balcony","backyard","bbq","grill","pool","hot tub","sauna","gym","exercise equipment",
  "smoke alarm","carbon monoxide alarm","fire extinguisher","first aid kit","security camera",
  "parking","ev charger","crib","high chair","children","elevator","private entrance",
  "self checkin","lockbox","cleaning","building staff",
];

const rainbowClass =
  "bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500 bg-clip-text text-transparent";

export function BecomeHostModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const createListingFn = useServerFn(createListing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [propShared, setPropShared] = useState(SHARED_OPTIONS[0]);
  const [propType, setPropType] = useState(TYPE_OPTIONS[0]);
  const [accommodates, setAccommodates] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [bedrooms, setBedrooms] = useState(1);
  const [beds, setBeds] = useState(1);
  const [price, setPrice] = useState(0);
  const [minNights, setMinNights] = useState(1);
  const [availability365, setAvailability365] = useState(365);
  const [neighbourhood, setNeighbourhood] = useState("");
  const [description, setDescription] = useState("");
  const [overview, setOverview] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [amenityPick, setAmenityPick] = useState("");
  const [customAmenity, setCustomAmenity] = useState("");

  if (!open) return null;

  const onPickFile = (f: File | null) => {
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(f ? URL.createObjectURL(f) : null);
  };

  const addAmenity = (a: string) => {
    const v = a.trim().toLowerCase();
    if (!v) return;
    setAmenities((prev) => (prev.includes(v) ? prev : [...prev, v]));
  };

  const removeAmenity = (a: string) =>
    setAmenities((prev) => prev.filter((x) => x !== a));

  const submit = async () => {
    setError(null);
    if (!file) {
      setError("Please upload a property photo.");
      return;
    }
    if (!name.trim() || !neighbourhood.trim() || !description.trim() || !overview.trim()) {
      setError("Please fill out all text fields.");
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const ext = file.name.split(".").pop() || "jpg";
      const path = `listings/${uid}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("listing-images")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("listing-images").getPublicUrl(path);

      await createListingFn({
        data: {
          name: name.trim(),
          picture_url: pub.publicUrl,
          property_type: `${propShared} ${propType}`,
          accommodates,
          bathrooms,
          bedrooms,
          beds,
          price,
          amenities,
          minimum_nights: minNights,
          availability_365: availability365,
          neighbourhood_cleansed: neighbourhood.trim(),
          description: description.trim(),
          neighborhood_overview: overview.trim(),
        },
      });
      onSuccess();
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        onClose();
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-2xl bg-card p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={`text-2xl font-bold ${rainbowClass}`}>Become a host!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about your place.
        </p>

        <div className="mt-6 grid gap-5">
          <Field label="Listing name">
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={name}
              maxLength={255}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Photo">
            <label
              htmlFor="listing-file"
              className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/40 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground hover:bg-muted/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) onPickFile(f);
              }}
            >
              {filePreview ? (
                <img
                  src={filePreview}
                  alt="preview"
                  className="h-32 w-auto rounded object-cover"
                />
              ) : (
                <span>Drag &amp; drop or click to upload an image</span>
              )}
              <input
                id="listing-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Room type">
              <select
                value={propShared}
                onChange={(e) => setPropShared(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {SHARED_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Property type">
              <select
                value={propType}
                onChange={(e) => setPropType(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TYPE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NumField label="Accommodates" value={accommodates} onChange={setAccommodates} />
            <NumField label="Bathrooms" value={bathrooms} onChange={setBathrooms} />
            <NumField label="Bedrooms" value={bedrooms} onChange={setBedrooms} />
            <NumField label="Beds" value={beds} onChange={setBeds} />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Price">
              <div className="flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm">
                <span className="mr-1 text-muted-foreground">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-transparent outline-none"
                />
              </div>
            </Field>
            <NumField label="Min nights" value={minNights} onChange={setMinNights} />
            <NumField label="Availability (days/yr)" value={availability365} onChange={setAvailability365} />
          </div>

          <Field label="Neighbourhood">
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={neighbourhood}
              onChange={(e) => setNeighbourhood(e.target.value)}
            />
          </Field>

          <Field label="Description">
            <textarea
              className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field label="Neighbourhood overview">
            <textarea
              className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
            />
          </Field>

          <Field label="Amenities">
            <div className="flex gap-2">
              <select
                value={amenityPick}
                onChange={(e) => {
                  setAmenityPick("");
                  if (e.target.value) addAmenity(e.target.value);
                }}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Pick from list…</option>
                {AMENITY_PRESETS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Or type custom…"
                value={customAmenity}
                onChange={(e) => setCustomAmenity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAmenity(customAmenity);
                    setCustomAmenity("");
                  }
                }}
              />
              <button
                type="button"
                onClick={() => { addAmenity(customAmenity); setCustomAmenity(""); }}
                className="rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background"
              >
                Add
              </button>
            </div>
            {amenities.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {amenities.map((a) => (
                  <span
                    key={a}
                    className="flex items-center gap-1 rounded-full border border-muted-foreground/40 bg-card px-3 py-1 text-xs"
                  >
                    {a}
                    <button
                      type="button"
                      onClick={() => removeAmenity(a)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Field>
        </div>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={`rounded-md border-2 border-muted-foreground/30 bg-card px-5 py-2.5 text-base font-bold disabled:opacity-50 ${rainbowClass}`}
          >
            {submitting ? "Publishing…" : "Publish listing!"}
          </button>
        </div>
      </div>
      {showSuccess ? <SuccessFireworks /> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function SuccessFireworks() {
  const particles = Array.from({ length: 36 });
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 animate-in fade-in" />
      <div className="relative">
        {particles.map((_, i) => {
          const angle = (i / particles.length) * Math.PI * 2;
          const dist = 140 + (i % 3) * 40;
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const colors = ["#ef4444","#f59e0b","#10b981","#3b82f6","#a855f7","#ec4899"];
          const color = colors[i % colors.length];
          return (
            <span
              key={i}
              className="absolute left-0 top-0 h-2 w-2 rounded-full"
              style={{
                background: color,
                boxShadow: `0 0 8px ${color}`,
                animation: `firework-burst 1.6s ease-out forwards`,
                ["--dx" as never]: `${dx}px`,
                ["--dy" as never]: `${dy}px`,
              }}
            />
          );
        })}
        <div
          className="relative rounded-2xl bg-card px-8 py-6 text-center shadow-2xl"
          style={{ animation: "success-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
        >
          <p className="text-2xl font-bold bg-gradient-to-r from-pink-500 via-yellow-500 to-emerald-500 bg-clip-text text-transparent">
            🎉 Congrats!
          </p>
          <p className="mt-1 text-base font-semibold text-foreground">
            Your listing has been published!
          </p>
        </div>
      </div>
      <style>{`
        @keyframes firework-burst {
          0% { transform: translate(0,0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; }
        }
        @keyframes success-pop {
          0% { transform: scale(0.3); opacity: 0; }
          70% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </Field>
  );
}