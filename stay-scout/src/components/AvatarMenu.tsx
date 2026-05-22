import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getMyHost, updateMyAvatar } from "@/lib/listings.functions";

const defaultAvatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='48' fill='%23e2e8f0'/%3E%3Ccircle cx='48' cy='37' r='16' fill='%2394a3b8'/%3E%3Cpath d='M20 82c5-18 17-27 28-27s23 9 28 27' fill='%2394a3b8'/%3E%3C/svg%3E";

export function AvatarMenu({ email }: { email?: string | null }) {
  const fetchHost = useServerFn(getMyHost);
  const saveAvatar = useServerFn(updateMyAvatar);
  const navigate = useNavigate();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchHost({})
      .then((h) => setAvatar(h?.avatar_url ?? null))
      .catch(() => {});
  }, [fetchHost]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const ext = file.name.split(".").pop() || "jpg";
      const path = `avatars/${uid}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("listing-images")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("listing-images").getPublicUrl(path);
      await saveAvatar({ data: { avatar_url: pub.publicUrl } });
      setAvatar(pub.publicUrl);
      setOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="flex items-center gap-2 rounded-md bg-card px-3 py-2 text-xs font-medium shadow-sm hover:bg-muted">
        <img
          src={avatar || defaultAvatar}
          alt="avatar"
          className="h-6 w-6 rounded-full object-cover"
        />
        <span className="text-muted-foreground">{email}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 w-48 rounded-md border border-muted-foreground/20 bg-card p-1 shadow-lg">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Change avatar"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: "/saved" });
            }}
            className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted"
          >
            Saved properties
          </button>
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: "/published" });
            }}
            className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted"
          >
            Published listings
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
