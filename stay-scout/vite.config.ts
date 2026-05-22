// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isVercelBuild = process.env.NITRO_PRESET === "vercel" || process.env.VERCEL === "1";
const vercelPlugins = [];

if (isVercelBuild) {
  const { nitro } = await import("nitro/vite");
  vercelPlugins.push(nitro());
}

// Vercel deployment goes through Nitro. Local Lovable/dev usage can keep the original defaults,
// while GitHub Actions and Vercel builds set NITRO_PRESET=vercel to target the Vercel runtime.
export default defineConfig({
  cloudflare: isVercelBuild ? false : undefined,
  plugins: vercelPlugins,
  tanstackStart: {
    server: { entry: "server" },
  },
});
