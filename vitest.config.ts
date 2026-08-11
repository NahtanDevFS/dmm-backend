import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Precargan el .env igual que los scripts dev/start, y además apuntan el
    // pool de la aplicación a la base de PRUEBAS: src/db/pool.ts lee
    // DATABASE_URL, así que sin esto las pruebas escribirían en la base de
    // desarrollo. tests/helpers/bd.ts verifica además que el nombre contenga
    // "test" antes de vaciar nada.
    setupFiles: ["dotenv/config", "./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Sin paralelismo: varias pruebas escriben y leen las mismas tablas, y
    // ejecutarlas a la vez volvería los resultados dependientes del orden.
    fileParallelism: false,
    // El primer test paga la conexión y el arranque de Prisma.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
