import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { levantarServidor, bajarServidor, pedir } from "../helpers/servidor.js";
import { resetBaseDePruebas, cerrarPools } from "../helpers/bd.js";
import { INTENTOS_LOGIN } from "../../src/middlewares/rate-limit.middleware.js";

// Límite de intentos fallidos de inicio de sesión: 5 por IP+usuario cada 15
// minutos. Cada caso usa un usuario propio porque la cuota se lleva por
// usuario intentado y el almacén del limitador vive en memoria del proceso.

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

const intentar = (username: string) =>
  pedir("POST", "/api/auth/login", null, { username, password: "incorrecta1" });

describe("límite de inicio de sesión", () => {
  it("son 5 intentos", () => {
    expect(INTENTOS_LOGIN).toBe(5);
  });

  it("bloquea el sexto intento fallido con 429", async () => {
    for (let i = 0; i < INTENTOS_LOGIN; i++) {
      expect((await intentar("test_limite_login_a")).status).toBe(401);
    }

    const bloqueado = await intentar("test_limite_login_a");
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.cuerpo.message).toMatch(/Demasiados intentos/);
  });

  it("la cuota es por usuario: otro usuario desde la misma IP no queda bloqueado", async () => {
    for (let i = 0; i < INTENTOS_LOGIN; i++) await intentar("test_limite_login_b");
    expect((await intentar("test_limite_login_b")).status).toBe(429);

    expect((await intentar("test_limite_login_c")).status).toBe(401);
  });
});
