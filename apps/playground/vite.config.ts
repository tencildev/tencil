import react from "@vitejs/plugin-react";
import fixhere from "fixhere/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), fixhere()],
});
