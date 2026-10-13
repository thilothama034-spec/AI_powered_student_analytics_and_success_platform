import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.STUDENT_API_URL || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": backend,
      "/docs": backend,
      "/openapi.json": backend,
      "/redoc": backend,
    },
  },
});
