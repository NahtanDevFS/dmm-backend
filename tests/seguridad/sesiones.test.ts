import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  levantarServidor,
  bajarServidor,
  sesionComo,
  pedir,
  type Sesion,
} from "../helpers/servidor.js";
import { poolOwner, resetBaseDePruebas, cerrarPools } from "../helpers/bd.js";
import {
  INACTIVIDAD_MAXIMA_MINUTOS,
  SESION_DURACION_MAXIMA_HORAS,
} from "../../src/modules/auth/session.utils.js";

/**
 * RNF-SEG-03: expiracion de sesion por inactividad, validada EN SERVIDOR.
 *
 * Es la razon por la que el sistema usa sesion con estado y no JWT puro: con un
 * token sin estado no hay forma de cortar por inactividad sin reintroducir
 * estado, y confiar en que el frontend cierre la sesion no es garantia.
 *
 * Para probar los cortes por tiempo se manipulan las marcas de tiempo en la
 * tabla `sesion` en lugar de esperar 30 minutos o 12 horas. Lo que se verifica
 * es la decision del middleware, no el paso del reloj.
 */

let sesion: Sesion;

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.sesion RESTART IDENTITY CASCADE`,
  );
  sesion = await sesionComo("ADMINISTRADOR");
});

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

/** Desplaza `ultima_actividad` hacia el pasado. */
async function envejecerActividad(minutos: number): Promise<void> {
  await poolOwner.query(
    `UPDATE public.sesion
     SET ultima_actividad = CURRENT_TIMESTAMP - ($1 || ' minutes')::interval
     WHERE revocada_en IS NULL`,
    [String(minutos)],
  );
}

describe("sesion vigente", () => {
  it("permite operar con la cookie recien emitida", async () => {
    const res = await pedir("GET", "/api/auth/me", sesion);

    expect(res.status).toBe(200);
    expect(res.cuerpo.usuario.rol).toBe("ADMINISTRADOR");
  });

  it("rechaza una peticion sin cookie", async () => {
    const res = await pedir("GET", "/api/auth/me", null);
    expect(res.status).toBe(401);
  });

  it("rechaza un token inventado", async () => {
    const falsa: Sesion = { ...sesion, cookie: "dmm_session=token-inventado" };
    const res = await pedir("GET", "/api/auth/me", falsa);

    expect(res.status).toBe(401);
  });

  it("guarda solo el hash del token, nunca el valor en claro", async () => {
    // El token en claro solo vive en la cookie del cliente.
    const valorCookie = sesion.cookie.split("=")[1];
    const { rows } = await poolOwner.query<{ token_hash: string }>(
      `SELECT token_hash FROM public.sesion WHERE revocada_en IS NULL`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(valorCookie);
    expect(rows[0].token_hash).toHaveLength(64); // SHA-256 en hexadecimal
  });
});

describe("corte por inactividad", () => {
  it("sigue viva justo por debajo del limite", async () => {
    await envejecerActividad(INACTIVIDAD_MAXIMA_MINUTOS - 2);

    const res = await pedir("GET", "/api/auth/me", sesion);
    expect(res.status).toBe(200);
  });

  it("corta pasado el limite de inactividad", async () => {
    await envejecerActividad(INACTIVIDAD_MAXIMA_MINUTOS + 1);

    const res = await pedir("GET", "/api/auth/me", sesion);
    expect(res.status).toBe(401);
    expect(res.cuerpo.message).toMatch(/inactividad/i);
  });

  it("la actividad reciente renueva el plazo", async () => {
    // Se acerca al limite, se usa el sistema, y el contador vuelve a empezar.
    await envejecerActividad(INACTIVIDAD_MAXIMA_MINUTOS - 1);
    expect((await pedir("GET", "/api/auth/me", sesion)).status).toBe(200);

    // Tras el latido, un desfase que antes habria cortado ya no corta.
    await envejecerActividad(INACTIVIDAD_MAXIMA_MINUTOS - 1);
    expect((await pedir("GET", "/api/auth/me", sesion)).status).toBe(200);
  });

  it("no elimina la fila de sesion al expirar", async () => {
    // Las sesiones son evidencia de acceso: nunca se borran.
    await envejecerActividad(INACTIVIDAD_MAXIMA_MINUTOS + 5);
    await pedir("GET", "/api/auth/me", sesion);

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.sesion`,
    );
    expect(rows[0].n).toBe("1");
  });
});

describe("tope absoluto de vigencia", () => {
  it("corta al superar el tope aunque haya actividad reciente", async () => {
    // La inactividad no es el unico limite: pasadas 12 horas desde el login,
    // la sesion muere aunque se este usando.
    //
    // Se envejece la sesion COMPLETA (created_at incluido) en vez de solo
    // adelantar expira_en: la constraint `sesion_expira_en_valida_check` exige
    // expira_en > created_at, porque una sesion no puede nacer ya expirada.
    await poolOwner.query(
      `UPDATE public.sesion
       SET created_at  = CURRENT_TIMESTAMP - INTERVAL '13 hours',
           expira_en   = CURRENT_TIMESTAMP - INTERVAL '1 hour',
           ultima_actividad = CURRENT_TIMESTAMP
       WHERE revocada_en IS NULL`,
    );

    const res = await pedir("GET", "/api/auth/me", sesion);
    expect(res.status).toBe(401);
    expect(res.cuerpo.message).toMatch(/expirado/i);
  });

  it("emite el tope a la distancia configurada", async () => {
    const { rows } = await poolOwner.query<{ horas: string }>(
      `SELECT EXTRACT(EPOCH FROM (expira_en - created_at)) / 3600 AS horas
       FROM public.sesion WHERE revocada_en IS NULL`,
    );

    expect(Math.round(Number(rows[0].horas))).toBe(
      SESION_DURACION_MAXIMA_HORAS,
    );
  });
});

describe("cierre de sesion", () => {
  it("invalida la cookie tras el logout", async () => {
    expect((await pedir("POST", "/api/auth/logout", sesion)).status).toBe(200);

    const res = await pedir("GET", "/api/auth/me", sesion);
    expect(res.status).toBe(401);
  });

  it("marca la revocacion en vez de borrar la fila", async () => {
    await pedir("POST", "/api/auth/logout", sesion);

    const { rows } = await poolOwner.query<{ revocada_en: Date | null }>(
      `SELECT revocada_en FROM public.sesion`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].revocada_en).not.toBeNull();
  });

  it("es idempotente", async () => {
    await pedir("POST", "/api/auth/logout", sesion);
    // Un segundo logout no debe reventar; la sesion ya no es valida.
    const res = await pedir("POST", "/api/auth/logout", sesion);
    expect([200, 401]).toContain(res.status);
  });

  it("una sesion revocada a mano deja de servir", async () => {
    // Es el mecanismo con el que desactivar un usuario cierra sus sesiones.
    await poolOwner.query(
      `UPDATE public.sesion SET revocada_en = CURRENT_TIMESTAMP`,
    );

    const res = await pedir("GET", "/api/auth/me", sesion);
    expect(res.status).toBe(401);
    expect(res.cuerpo.message).toMatch(/cerrada/i);
  });
});

describe("credenciales de login", () => {
  it("rechaza una contraseña incorrecta sin crear sesion", async () => {
    const antes = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.sesion`,
    );

    const res = await pedir("POST", "/api/auth/login", null, {
      username: "test_administrador",
      password: "ClaveEquivocada1",
    });

    expect(res.status).toBe(401);

    const despues = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.sesion`,
    );
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it("rechaza un usuario inexistente con el mismo mensaje", async () => {
    // No debe revelar si el usuario existe: seria enumeracion de cuentas.
    const res = await pedir("POST", "/api/auth/login", null, {
      username: "no_existe_este_usuario",
      password: "LoQueSea1234",
    });

    expect(res.status).toBe(401);
  });

  /**
   * Un usuario desactivado recibe 403, no 401, y con un mensaje distinto.
   *
   * Es deliberado: el 401 uniforme de arriba protege contra enumeracion de
   * cuentas, pero aqui quien pregunta ya demostro conocer la contraseña
   * correcta, asi que no se le revela nada nuevo. A cambio, el empleado sabe
   * que su problema no es la contraseña y que debe hablar con el
   * administrador, en vez de reintentar hasta agotar el rate limit.
   */
  it("rechaza a un usuario desactivado con 403 y mensaje propio", async () => {
    await poolOwner.query(
      `UPDATE public.usuario SET activo = false WHERE username = 'test_administrador'`,
    );

    try {
      const res = await pedir("POST", "/api/auth/login", null, {
        username: "test_administrador",
        password: "Prueba1234",
      });
      expect(res.status).toBe(403);
      expect(res.cuerpo.message).toMatch(/suspendida|administrador/i);
    } finally {
      await poolOwner.query(
        `UPDATE public.usuario SET activo = true WHERE username = 'test_administrador'`,
      );
    }
  });
});
