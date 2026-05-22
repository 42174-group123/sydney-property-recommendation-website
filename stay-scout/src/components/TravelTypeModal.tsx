import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { setMyUserType } from "@/lib/listings.functions";

const OPTIONS = [
  { label: "Business travel", value: "business_traveller", emoji: "💼", color: "bg-slate-600 hover:bg-slate-700" },
  { label: "Staying for long-term study", value: "student_long_stay", emoji: "🎓", color: "bg-indigo-500 hover:bg-indigo-600" },
  { label: "Keep it simple", value: "budget_traveller", emoji: "🎒", color: "bg-emerald-500 hover:bg-emerald-600" },
  { label: "Travel with family", value: "family_group", emoji: "👨‍👩‍👧", color: "bg-orange-500 hover:bg-orange-600" },
  { label: "Looking for extra comfort", value: "luxury_guest", emoji: "✨", color: "bg-amber-500 hover:bg-amber-600" },
  { label: "A trip for two", value: "couple_getaway", emoji: "💕", color: "bg-rose-500 hover:bg-rose-600" },
  { label: "Coming with a group", value: "large_group", emoji: "🎉", color: "bg-purple-500 hover:bg-purple-600" },
] as const;

export function TravelTypeModal({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useServerFn(setMyUserType);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await save({ data: { user_type: selected as (typeof OPTIONS)[number]["value"] } });
      onDone();
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card p-8 shadow-xl">
        <h2 className="text-2xl font-bold text-foreground">What type of travel are you after?</h2>
        <p className="mt-2 text-sm text-muted-foreground">Pick the one that fits you best.</p>
        <div className="mt-6 flex flex-col gap-2">
          {OPTIONS.map((opt) => {
            const active = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium text-white transition-all ${opt.color} ${active ? "ring-4 ring-foreground/40 scale-[1.02]" : "opacity-80 hover:opacity-100"}`}
              >
                <span className="text-xl">{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selected || saving}
          className="mt-6 w-full rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}