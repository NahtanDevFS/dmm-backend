/**
 * Redirige la conexión de la aplicación a la base de pruebas ANTES de que
 * cualquier módulo lea `process.env.DATABASE_URL`.
 *
 * Hace falta porque `src/db/pool.ts` y `src/db/prisma.ts` toman la cadena de
 * conexión al importarse. Sin esto, los tests levantarían la app apuntando a la
 * base de desarrollo y escribirían ahí — y desde la migración 12 esa basura en
 * `auditoria_log` sería imposible de borrar.
 */
const urlPruebas = process.env.DATABASE_URL_TEST;

if (!urlPruebas) {
  throw new Error(
    "Falta DATABASE_URL_TEST en el .env. Las pruebas no deben correr contra la base de desarrollo.",
  );
}

process.env.DATABASE_URL = urlPruebas;
process.env.NODE_ENV = "test";
