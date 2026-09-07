import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { canonicalDevelopmentData } from "./tools/devSnapshot.ts";

export default defineConfig({
  base: "./",
  plugins: [canonicalDevelopmentData(), react()],
  build: {
    assetsDir: "assets",
    cssCodeSplit: false,
    sourcemap: false,
  },
});
