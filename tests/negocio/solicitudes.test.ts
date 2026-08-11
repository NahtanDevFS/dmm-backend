import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
  idCatalogo,
} from "../helpers/bd.js";
import {
  crearUsuario,
  crearPersona,
  crearInsumo,
  crearLote,
  type InsumoCreado,
} from "../helpers/fixtures.js";

/**
 * Reglas de solicitudes que decide la base de datos.
 *
 * Lo importante aqui: el backend NO elige el estado de una linea. Lo fija
 * `fn_estado_inicial_linea_solicitud` segun el stock real del insumo en ese
 * momento. Estas pruebas verifican esa decision y el bloqueo condicional de
 * insumos criticos.
 */

let usuarioId: number;
let personaId: number;
let programaId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("solicitudes");

  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa de prueba', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_solicitud_apoyo, public.solicitud_apoyo,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote
     RESTART IDENTITY CASCADE`,
  );
  personaId = await crearPersona(usuarioId, { nombres: "Solicitante" });
});

afterAll(async () => {
  await cerrarPools();
});

async function crearSolicitud(): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.solicitud_apoyo
       (persona_id, programa_id, estado_id, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      personaId,
      programaId,
      await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ENTREGA"),
      usuarioId,
    ],
  );
  return rows[0].id;
}

async function agregarLinea(
  solicitudId: number,
  insumo: InsumoCreado,
  cantidad = 5,
): Promise<{ id: number; estado: string }> {
  const { rows } = await poolOwner.query<{ id: number; estado: string }>(
    `WITH nueva AS (
       INSERT INTO public.detalle_solicitud_apoyo
         (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
       VALUES ($1, $2, $3, 1, $4)
       RETURNING id, estado_id
     )
     SELECT n.id, e.nombre AS estado
     FROM nueva n JOIN public.estado_solicitud_apoyo e ON e.id = n.estado_id`,
    [solicitudId, insumo.insumoId, cantidad, usuarioId],
  );
  return rows[0];
}

describe("estado inicial de la linea segun stock", () => {
  it("queda PENDIENTE_ENTREGA cuando hay stock", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 50 });
    const solicitud = await crearSolicitud();

    const linea = await agregarLinea(solicitud, insumo);

    expect(linea.estado).toBe("PENDIENTE_ENTREGA");
  });

  it("queda PENDIENTE_ADQUISICION cuando no hay stock", async () => {
    const insumo = await crearInsumo(usuarioId);
    const solicitud = await crearSolicitud();

    const linea = await agregarLinea(solicitud, insumo);

    // Un insumo sin existencias SI se puede solicitar: queda en lista de
    // espera hasta que llegue una donacion.
    expect(linea.estado).toBe("PENDIENTE_ADQUISICION");
  });

  it("ignora el estado que envie el backend y decide por stock", async () => {
    // agregarLinea manda estado_id = 1 siempre. El trigger lo sobrescribe.
    const conStock = await crearInsumo(usuarioId, { nombre: "Con stock" });
    await crearLote(usuarioId, conStock, { cantidad: 10 });
    const sinStock = await crearInsumo(usuarioId, { nombre: "Sin stock" });
    const solicitud = await crearSolicitud();

    const lineaA = await agregarLinea(solicitud, conStock);
    const lineaB = await agregarLinea(solicitud, sinStock);

    expect(lineaA.estado).toBe("PENDIENTE_ENTREGA");
    expect(lineaB.estado).toBe("PENDIENTE_ADQUISICION");
  });

  it("cuenta como sin stock un lote agotado", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET cantidad_disponible = 0 WHERE id = $1`,
      [lote.loteId],
    );
    const solicitud = await crearSolicitud();

    const linea = await agregarLinea(solicitud, insumo);

    expect(linea.estado).toBe("PENDIENTE_ADQUISICION");
  });
});

describe("insumos que bloquean la solicitud sin stock", () => {
  it("rechaza la linea de un insumo critico sin existencias", async () => {
    const medicamento = await crearInsumo(usuarioId, {
      nombre: "Medicamento critico",
      bloqueaSolicitudSinStock: true,
    });
    const solicitud = await crearSolicitud();

    await expect(agregarLinea(solicitud, medicamento)).rejects.toThrow(
      /no hay stock disponible/i,
    );
  });

  it("nombra el insumo en el mensaje de error", async () => {
    // El mensaje lo ve la trabajadora social: un id crudo no le sirve.
    const medicamento = await crearInsumo(usuarioId, {
      nombre: "Amoxicilina 500mg",
      bloqueaSolicitudSinStock: true,
    });
    const solicitud = await crearSolicitud();

    await expect(agregarLinea(solicitud, medicamento)).rejects.toThrow(
      /Amoxicilina 500mg/,
    );
  });

  it("acepta la linea del insumo critico si hay stock", async () => {
    const medicamento = await crearInsumo(usuarioId, {
      bloqueaSolicitudSinStock: true,
    });
    await crearLote(usuarioId, medicamento, { cantidad: 20 });
    const solicitud = await crearSolicitud();

    const linea = await agregarLinea(solicitud, medicamento);

    expect(linea.estado).toBe("PENDIENTE_ENTREGA");
  });

  it("permite sin stock un insumo que NO bloquea", async () => {
    // La contraparte de la regla: equipos y alimentos si entran a lista de
    // espera. Solo los criticos bloquean.
    const equipo = await crearInsumo(usuarioId, {
      bloqueaSolicitudSinStock: false,
    });
    const solicitud = await crearSolicitud();

    const linea = await agregarLinea(solicitud, equipo);

    expect(linea.estado).toBe("PENDIENTE_ADQUISICION");
  });
});

describe("integridad de las lineas", () => {
  it("no admite el mismo insumo dos veces en una solicitud", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 10 });
    const solicitud = await crearSolicitud();

    await agregarLinea(solicitud, insumo);
    await expect(agregarLinea(solicitud, insumo)).rejects.toThrow();
  });

  it("borra las lineas al borrar la solicitud", async () => {
    const insumo = await crearInsumo(usuarioId);
    const solicitud = await crearSolicitud();
    await agregarLinea(solicitud, insumo);

    await poolOwner.query(`DELETE FROM public.solicitud_apoyo WHERE id = $1`, [
      solicitud,
    ]);

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.detalle_solicitud_apoyo
       WHERE solicitud_id = $1`,
      [solicitud],
    );
    expect(rows[0].n).toBe("0");
  });
});
