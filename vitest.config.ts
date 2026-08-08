import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Las pruebas hablan con la base de datos real: precargan el .env igual que
    // los scripts dev/start, para no duplicar la configuración de conexión.
    setupFiles: ["dotenv/config"],
    include: ["tests/**/*.test.ts"],
    // Sin paralelismo: varias pruebas escriben y leen las mismas tablas, y
    // ejecutarlas a la vez volvería los resultados dependientes del orden.
    fileParallelism: false,
    // El primer test paga la conexión y el arranque de Prisma.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
