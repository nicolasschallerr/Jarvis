import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Solo en desarrollo: permite abrir el servidor local también como 127.0.0.1 (otra sesión de navegador que localhost,
  // útil para probar con un usuario de demo sin cerrar la propia). No afecta a producción.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
