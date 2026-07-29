import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    port: 5173,
    // Dev: deploy/server.py provides /api/* (geocode+WFS agent, VWorld tile proxy)
    proxy: {
      "/api": "http://localhost:5188"
    }
  },
  build: {
    target: "es2022"
  }
});
