import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const isVercelBuild = process.env.NITRO_PRESET === "vercel" || process.env.VERCEL === "1";
const vercelPlugins = [];

if (isVercelBuild) {
  const { nitro } = await import("nitro/vite");
  vercelPlugins.push(nitro());
}

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    react(),
    ...vercelPlugins,
  ],
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
  },
});
