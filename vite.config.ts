import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// On Vercel, Nitro detects the platform at build time and emits the Vercel output
// (.vercel/output), so no preset is hard-coded here. Set NITRO_PRESET to override it.
export default defineConfig(({ command }) => ({
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    ...(command === "build" ? [nitro()] : []),
    viteReact(),
    tailwindcss(),
  ],
}));
