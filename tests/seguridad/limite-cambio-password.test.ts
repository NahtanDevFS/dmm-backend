import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  levantarServidor,
  bajarServidor,
  sesionComo,
  pedir,
  type Sesion,
} from "../helpers/servidor.js";
import { resetBaseDePruebas, cerrarPools } from "../helpers/bd.js";

/**
 * QA-06: cambiar la propia contraseña permite adivinar la actual desde una
 * sesión abierta. Tiene su propio límite (5 intentos fallidos cada 15 minutos
 * por usuario) y cada respuesta le dice a la persona cuántos le quedan.
 */

let empleado: Sesion;
let directora: Sesion;

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
  empleado = await sesionComo("EMPLEADO_DMM");
  directora = await sesionComo("DIRECTORA");
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

const intentar = (sesion: Sesion, password_actual: string, password_nueva = "OtraClave123") =>
  pedir("PATCH", "/api/usuarios/mi-password", sesion, {
    password_actual,
    password_nueva,
  });

describe("límite de intentos al cambiar la contraseña", () => {
  it("un error de formato en la contraseña nueva no gasta intentos", async () => {
    const r = await intentar(empleado, "incorrecta", "corta");
    expect(r.status).toBe(400);
    expect(r.cuerpo.intentos_restantes).toBeUndefined();
  });

  it("cuenta hacia atrás con cada contraseña actual incorrecta", async () => {
    for (const restantes of [4, 3, 2, 1]) {
      const r = await intentar(empleado, "incorrecta");
      expect(r.status).toBe(400);
      expect(r.cuerpo.code).toBe("CURRENT_PASSWORD_INVALID");
      expect(r.cuerpo.intentos_restantes).toBe(restantes);
      expect(r.cuerpo.message).toContain(
        `Le quedan ${restantes} intento${restantes === 1 ? "" : "s"}`,
      );
    }

    const ultimo = await intentar(empleado, "incorrecta");
    expect(ultimo.status).toBe(400);
    expect(ultimo.cuerpo.intentos_restantes).toBe(0);
    expect(ultimo.cuerpo.message).toContain("último intento");
  });

  it("al agotarlos bloquea con 429 y dice cuánto esperar", async () => {
    const r = await intentar(empleado, "incorrecta");
    expect(r.status).toBe(429);
    expect(r.cuerpo.code).toBe("CAMBIO_PASSWORD_BLOQUEADO");
    expect(r.cuerpo.message).toMatch(/de nuevo en \d+ minutos?/);
  });

  it("el bloqueo es por usuario: no afecta a otra persona", async () => {
    const r = await intentar(directora, "incorrecta");
    expect(r.status).toBe(400);
    expect(r.cuerpo.intentos_restantes).toBe(4);
  });
});
