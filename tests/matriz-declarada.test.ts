import { describe, it, expect } from "vitest";
import routes from "./../src/routes/routes.js";
import { verificarRutasProtegidas } from "./../src/lib/rutas-protegidas.js";

/**
 * Prueba barata y sin base de datos: verifica lo que las rutas DECLARAN.
 *
 * No sustituye a `acceso-por-rol.test.ts`, que comprueba el comportamiento
 * real por HTTP. Esta ataca otro riesgo: que alguien agregue una ruta y se le
 * olvide declarar roles, o que afloje un conjunto sin darse cuenta. Corre en
 * milisegundos, asi que puede vivir en cualquier hook de pre-commit.
 */
describe("matriz de autorizacion declarada", () => {
  const rutas = verificarRutasProtegidas(routes as any);

  it("no deja ninguna ruta sin declarar sus roles", () => {
    const sinDeclarar = rutas.filter((r) => r.estado === "desprotegida");
    expect(sinDeclarar, JSON.stringify(sinDeclarar, null, 2)).toHaveLength(0);
  });

  it("mantiene acotadas las rutas exentas de rol", () => {
    const exentas = rutas
      .filter((r) => r.estado === "sin-rol-declarado")
      .map((r) => `${r.metodo} ${r.ruta}`)
      .sort();

    // Cada una de estas es una decision consciente documentada con
    // permitirSinRol(). Si aparece una nueva, este test obliga a justificarla.
    expect(exentas).toEqual([
      "GET /me",
      "PATCH /mi-password",
      "POST /login",
      "POST /logout",
    ]);
  });

  it("descubre una cantidad de rutas coherente con el sistema", () => {
    // Guarda contra que un cambio de Express rompa el recorrido y el resto de
    // las aserciones pasen sobre una lista vacia.
    expect(rutas.length).toBeGreaterThan(100);
  });
});
