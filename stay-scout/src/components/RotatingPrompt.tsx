import { useEffect, useState } from "react";

const PROMPTS = [
  "What kind of stay are you after?",
  "Where do you want to wake up?",
  "What's your perfect place?",
  "Ready to find your next stay?",
  "What are you looking for today?",
  "What kind of home fits your trip?",
  "Let's find your ideal stay?",
  "Need a place that feels right?",
  "What vibe are you searching for?",
  "Want help finding the right place?",
];

export function RotatingPrompt() {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState(PROMPTS[0]);
  const [phase, setPhase] = useState<"hold" | "erasing" | "writing">("hold");

  useEffect(() => {
    if (phase === "hold") {
      const t = setTimeout(() => setPhase("erasing"), 4000);
      return () => clearTimeout(t);
    }
    if (phase === "erasing") {
      if (text.length === 0) {
        setIndex((i) => (i + 1) % PROMPTS.length);
        setPhase("writing");
        return;
      }
      const t = setTimeout(() => setText(text.slice(0, -1)), 25);
      return () => clearTimeout(t);
    }
    if (phase === "writing") {
      const target = PROMPTS[index];
      if (text.length === target.length) {
        setPhase("hold");
        return;
      }
      const t = setTimeout(() => setText(target.slice(0, text.length + 1)), 40);
      return () => clearTimeout(t);
    }
  }, [phase, text, index]);

  return (
    <div className="w-full max-w-3xl rounded-full bg-secondary px-8 py-6 shadow-sm">
      <h2 className="text-center text-2xl font-bold text-foreground md:text-3xl">
        {text}
        <span
          className="ml-0.5 inline-block w-0.5 animate-pulse bg-foreground align-middle"
          style={{ height: "1em" }}
        />
      </h2>
    </div>
  );
}
