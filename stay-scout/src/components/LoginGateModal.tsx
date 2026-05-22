import { supabase } from "@/integrations/supabase/client";

export function LoginGateModal({
  open,
  onClose,
  title = "Please log in",
  message = "Please log in to have a better experience with our service.",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}) {
  if (!open) return null;

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={signIn}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <GoogleIcon />
          Continue with Google
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.5 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.2 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.5 6.2 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.5C29.5 34.7 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.6 39.7 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.5 5.5C41.8 35.7 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
