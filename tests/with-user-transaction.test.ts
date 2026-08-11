import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../src/db/pool.js";
import { withUserTransaction } from "../src/db/withUserTransaction.js";

/**
 * Prueba de humo de `withUserTransaction`, la pieza de la que depende toda la
 * auditoría del sistema (sección 7.1 del documento maestro).
 *
 * Es una prueba de integración a propósito: lo que se verifica no es lógica de
 * TypeScript, es que el `SET LOCAL app.usuario_id` llegue a la base de datos y
 * que `fn_auditoria` lo lea. Con la base simulada no se comprobaría nada útil.
 *
 * Trabaja sobre un registro propio de la tabla `discapacidad` — un catálogo
 * simple sin dependencias — y lo borra al terminar.
 */

const NOMBRE_PRUEBA = "ZZ Prueba withUserTransaction";
let usuarioId: number;

async function limpiar(): Promise<void> {
  await pool.query(`DELETE FROM public.auditoria_log
                    WHERE tabla_afectada = 'discapacidad'
                      AND registro_id IN (
                        SELECT id FROM public.discapacidad WHERE nombre LIKE 'ZZ Prueba withUserTransaction%'
                      )`);
  await pool.query(
    `DELETE FROM public.discapacidad WHERE nombre LIKE 'ZZ Prueba withUserTransaction%'`,
  );
}

beforeAll(async () => {
  const usuario = await pool.query<{ id: number }>(
    `SELECT id FROM public.usuario WHERE activo = true ORDER BY id LIMIT 1`,
  );
  if (usuario.rows.length === 0) {
    throw new Error(
      "La prueba necesita al menos un usuario activo en la base de datos.",
    );
  }
  usuarioId = usuario.rows[0].id;
  await limpiar();
});

afterAll(async () => {
  await limpiar();
  await pool.end();
});

describe("withUserTransaction", () => {
  it("publica app.usuario_id dentro de la transacción", async () => {
    const leido = await withUserTransaction(usuarioId, async (client) => {
      const r = await client.query<{ valor: string }>(
        `SELECT current_setting('app.usuario_id') AS valor`,
      );
      return r.rows[0].valor;
    });

    expect(leido).toBe(String(usuarioId));
  });

  it("no deja app.usuario_id fijado fuera de la transacción", async () => {
    await withUserTransaction(usuarioId, async (client) => {
      await client.query(`SELECT 1`);
    });

    // `SET LOCAL` muere con la transacción; si se hubiera usado SET normal, el
    // valor quedaría pegado a la conexión y contaminaría al siguiente request
    // que tomara ese cliente del pool.
    const fuera = await pool.query<{ valor: string | null }>(
      `SELECT current_setting('app.usuario_id', true) AS valor`,
    );
    expect(fuera.rows[0].valor).toBeFalsy();
  });

  it("commitea y deja el autor correcto en auditoria_log", async () => {
    const id = await withUserTransaction(usuarioId, async (client) => {
      const r = await client.query<{ id: number }>(
        `INSERT INTO public.discapacidad (nombre, created_by)
         VALUES ($1, $2) RETURNING id`,
        [NOMBRE_PRUEBA, usuarioId],
      );
      return r.rows[0].id;
    });

    const guardado = await pool.query(
      `SELECT nombre FROM public.discapacidad WHERE id = $1`,
      [id],
    );
    expect(guardado.rowCount).toBe(1);

    const auditoria = await pool.query<{
      usuario_id: number;
      accion: string;
    }>(
      `SELECT a.usuario_id, t.nombre AS accion
       FROM public.auditoria_log a
       JOIN public.tipo_accion_auditoria t ON t.id = a.tipo_accion_id
       WHERE a.tabla_afectada = 'discapacidad' AND a.registro_id = $1`,
      [id],
    );

    expect(auditoria.rowCount).toBe(1);
    expect(auditoria.rows[0].accion).toBe("INSERT");
    // Lo que de verdad importa: el trigger atribuyó el cambio al usuario que
    // abrió la transacción, no a NULL.
    expect(auditoria.rows[0].usuario_id).toBe(usuarioId);
  });

  it("revierte todo si la función lanza un error", async () => {
    const nombre = `${NOMBRE_PRUEBA} rollback`;

    await expect(
      withUserTransaction(usuarioId, async (client) => {
        await client.query(
          `INSERT INTO public.discapacidad (nombre, created_by) VALUES ($1, $2)`,
          [nombre, usuarioId],
        );
        throw new Error("fallo intencional a mitad de la transacción");
      }),
    ).rejects.toThrow("fallo intencional");

    const quedo = await pool.query(
      `SELECT 1 FROM public.discapacidad WHERE nombre = $1`,
      [nombre],
    );
    expect(quedo.rowCount).toBe(0);

    // El rollback también se lleva la fila de auditoría: el trigger corre dentro
    // de la misma transacción.
    const auditoria = await pool.query(
      `SELECT 1 FROM public.auditoria_log
       WHERE tabla_afectada = 'discapacidad'
         AND valores_nuevos->>'nombre' = $1`,
      [nombre],
    );
    expect(auditoria.rowCount).toBe(0);
  });

  it("devuelve el cliente al pool aunque haya error", async () => {
    const antes = pool.idleCount + pool.totalCount;

    await withUserTransaction(usuarioId, async (c) => c.query(`SELECT 1`));
    await withUserTransaction(usuarioId, async () => {
      throw new Error("otro fallo");
    }).catch(() => undefined);

    // Si el `finally` con client.release() no existiera, el pool se agotaría
    // tras unas cuantas llamadas fallidas y el servidor quedaría colgado.
    expect(pool.waitingCount).toBe(0);
    expect(pool.totalCount).toBeLessThanOrEqual(antes + 1);
  });
});
