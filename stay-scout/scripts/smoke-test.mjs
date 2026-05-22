import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = JSON.parse(read("package.json"));
const viteConfig = read("vite.config.ts");
assert(packageJson.scripts?.build, "package.json must define a build script");
assert(packageJson.scripts?.lint, "package.json must define a lint script");
assert(packageJson.scripts?.typecheck, "package.json must define a typecheck script");
assert(packageJson.scripts?.ci, "package.json must define a ci script");
assert(packageJson.scripts?.deploy, "package.json must define a deploy script");
assert(packageJson.devDependencies?.nitro, "package.json must include Nitro for Vercel builds");

assert(viteConfig.includes("nitro/vite"), "Vercel build must use the Nitro Vite plugin");
assert(viteConfig.includes("isVercelBuild"), "Vite config must detect Vercel builds");
assert(viteConfig.includes("cloudflare: isVercelBuild ? false : undefined"), "Vercel build must disable Cloudflare plugin");
assert(viteConfig.includes('server: { entry: "server" }'), "Vite config must keep the SSR server entry");

console.log("Stay Scout smoke test passed.");
