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
  crearRecepcion,
  stockDisponible,
  enDias,
  type InsumoCreado,
} from "../helpers/fixtures.js";

/**
 * `sp_registrar_entrega` y `sp_desactivar_entrega`: el nucleo del sistema.
 *
 * El backend NO elige lotes ni calcula cantidades; solo invoca. Toda la
 * decision de que lote se descuenta primero, cuanto se toma de cada uno y como
 * se restituye al anular vive en PL/pgSQL. Leer el repositorio de entregas no
 * dice nada sobre si el orden FEFO es correcto.
 *
 * Notese que en ningun INSERT de estas pruebas se envia `cantidad_entregada`:
 * la calcula `fn_calcular_cantidad_entregada` a partir de la presentacion y del
 * factor de conversion del lote. Enviarla seria probar otra cosa.
 */

let usuarioId: number;
let personaId: number;
let programaId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("entregas");

  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa entregas', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_entrega, public.entrega,
                    public.detalle_solicitud_apoyo, public.solicitud_apoyo,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote
     RESTART IDENTITY CASCADE`,
  );
  personaId = await crearPersona(usuarioId, { nombres: "Beneficiaria" });
});

afterAll(async () => {
  await cerrarPools();
});

async function registrarEntrega(
  insumo: InsumoCreado,
  cantidad: number,
  extras: {
    detalleSolicitudId?: number | null;
    receptorId?: number | null;
    parentescoId?: number | null;
  } = {},
): Promise<void> {
  const {
    detalleSolicitudId = null,
    receptorId = null,
    parentescoId = null,
  } = extras;

  await poolOwner.query(
    `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      detalleSolicitudId,
      personaId,
      insumo.insumoId,
      cantidad,
      usuarioId,
      null,
      receptorId,
      parentescoId,
    ],
  );
}

/** Lo que se tomó de cada lote, en el orden en que la base los eligió. */
async function despachosPorLote(): Promise<
  Array<{ lote: number; cantidad: number }>
> {
  const { rows } = await poolOwner.query<{ lote: number; cantidad: number }>(
    `SELECT detalle_inventario_lote_id AS lote, cantidad_entregada AS cantidad
     FROM public.detalle_entrega
     WHERE activo = true
     ORDER BY id`,
  );
  return rows;
}

describe("orden de despacho FEFO/FIFO", () => {
  it("toma primero el lote que caduca antes, sin importar cuando llego", async () => {
    const insumo = await crearInsumo(usuarioId, {
      requiereFechaCaducidad: true,
    });
    // El que llega primero caduca despues: si el orden fuera por fecha de
    // recepcion, este saldria primero y el otro se venceria en bodega.
    const tardio = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(180),
    });
    const proximo = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(30),
    });

    await registrarEntrega(insumo, 6);

    const despachos = await despachosPorLote();
    expect(despachos).toHaveLength(1);
    expect(despachos[0].lote).toBe(proximo.loteId);
    expect(await stockDisponible(proximo.loteId)).toBe(4);
    expect(await stockDisponible(tardio.loteId)).toBe(10);
  });

  it("encadena lotes cuando uno no alcanza, respetando el orden", async () => {
    const insumo = await crearInsumo(usuarioId, {
      requiereFechaCaducidad: true,
    });
    const primero = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(10),
    });
    const segundo = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(20),
    });
    const tercero = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(30),
    });

    await registrarEntrega(insumo, 12);

    const despachos = await despachosPorLote();
    expect(despachos.map((d) => d.lote)).toEqual([
      primero.loteId,
      segundo.loteId,
      tercero.loteId,
    ]);
    expect(despachos.map((d) => d.cantidad)).toEqual([5, 5, 2]);
    expect(await stockDisponible(tercero.loteId)).toBe(3);
  });

  it("deja los lotes sin caducidad para el final", async () => {
    const insumo = await crearInsumo(usuarioId);
    const sinCaducidad = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: null,
    });
    const conCaducidad = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(365),
    });

    await registrarEntrega(insumo, 3);

    // Aunque caduque dentro de un año, el perecedero sale antes que el que
    // nunca caduca.
    const despachos = await despachosPorLote();
    expect(despachos[0].lote).toBe(conCaducidad.loteId);
    expect(await stockDisponible(sinCaducidad.loteId)).toBe(10);
  });

  it("entre lotes sin caducidad usa el mas antiguo primero", async () => {
    const insumo = await crearInsumo(usuarioId);

    const recepcionVieja = await crearRecepcion(usuarioId);
    await poolOwner.query(
      `UPDATE public.recepcion_donacion_lote SET fecha_recepcion = $1 WHERE id = $2`,
      [enDias(-90), recepcionVieja],
    );
    const viejo = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      recepcionId: recepcionVieja,
    });
    const nuevo = await crearLote(usuarioId, insumo, { cantidad: 10 });

    await registrarEntrega(insumo, 4);

    const despachos = await despachosPorLote();
    expect(despachos[0].lote).toBe(viejo.loteId);
    expect(await stockDisponible(nuevo.loteId)).toBe(10);
  });

  it("ignora lotes agotados e inactivos", async () => {
    const insumo = await crearInsumo(usuarioId, {
      requiereFechaCaducidad: true,
    });
    const agotado = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(5),
    });
    const inactivo = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(10),
    });
    const bueno = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(50),
    });

    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET cantidad_disponible = 0 WHERE id = $1`,
      [agotado.loteId],
    );
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET activo = false WHERE id = $1`,
      [inactivo.loteId],
    );

    await registrarEntrega(insumo, 5);

    const despachos = await despachosPorLote();
    expect(despachos).toHaveLength(1);
    expect(despachos[0].lote).toBe(bueno.loteId);
  });
});

describe("validaciones de sp_registrar_entrega", () => {
  it("rechaza cantidad cero o negativa", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 10 });

    await expect(registrarEntrega(insumo, 0)).rejects.toThrow(/mayor a cero/i);
    await expect(registrarEntrega(insumo, -5)).rejects.toThrow(/mayor a cero/i);
  });

  it("rechaza entregar mas que el stock total del insumo", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 4 });
    await crearLote(usuarioId, insumo, { cantidad: 3 });

    // Suma 7 entre los dos lotes: pedir 8 debe fallar ANTES de tocar nada.
    await expect(registrarEntrega(insumo, 8)).rejects.toThrow(
      /stock insuficiente/i,
    );

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.entrega`,
    );
    // No debe quedar una cabecera de entrega huerfana del intento fallido.
    expect(rows[0].n).toBe("0");
  });

  it("exige parentesco cuando la recibe un tercero", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 10 });
    const receptor = await crearPersona(usuarioId, { nombres: "Receptor" });

    await expect(
      registrarEntrega(insumo, 1, { receptorId: receptor, parentescoId: null }),
    ).rejects.toThrow(/parentesco/i);

    // Con parentesco si pasa.
    await registrarEntrega(insumo, 1, {
      receptorId: receptor,
      parentescoId: await idCatalogo("tipo_parentesco", "HIJO_A"),
    });
    expect(await despachosPorLote()).toHaveLength(1);
  });

  it("rechaza un insumo distinto al de la linea de solicitud", async () => {
    const solicitado = await crearInsumo(usuarioId, { nombre: "Solicitado" });
    const otro = await crearInsumo(usuarioId, { nombre: "Otro" });
    await crearLote(usuarioId, solicitado, { cantidad: 10 });
    await crearLote(usuarioId, otro, { cantidad: 10 });

    const sol = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.solicitud_apoyo (persona_id, programa_id, estado_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        personaId,
        programaId,
        await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ENTREGA"),
        usuarioId,
      ],
    );
    const linea = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.detalle_solicitud_apoyo
         (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
       VALUES ($1, $2, 5, 1, $3) RETURNING id`,
      [sol.rows[0].id, solicitado.insumoId, usuarioId],
    );

    await expect(
      registrarEntrega(otro, 2, { detalleSolicitudId: linea.rows[0].id }),
    ).rejects.toThrow(/no coincide/i);
  });

  it("rechaza un insumo sin presentacion default", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 10 });
    await poolOwner.query(
      `UPDATE public.presentacion_insumo SET es_default = false WHERE insumo_id = $1`,
      [insumo.insumoId],
    );

    await expect(registrarEntrega(insumo, 1)).rejects.toThrow(
      /presentaci[oó]n default/i,
    );
  });
});

describe("anulacion de entregas", () => {
  it("devuelve las unidades a cada lote de origen, no a un total", async () => {
    // El caso que importa: si la anulacion sumara todo al primer lote, el
    // inventario cuadraria en total pero mentiria por lote, y el siguiente
    // despacho FEFO tomaria del lote equivocado.
    const insumo = await crearInsumo(usuarioId, {
      requiereFechaCaducidad: true,
    });
    const primero = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(10),
    });
    const segundo = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(20),
    });

    await registrarEntrega(insumo, 8); // 5 del primero + 3 del segundo
    expect(await stockDisponible(primero.loteId)).toBe(0);
    expect(await stockDisponible(segundo.loteId)).toBe(2);

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Prueba de anulacion')`,
      [rows[0].id, usuarioId],
    );

    expect(await stockDisponible(primero.loteId)).toBe(5);
    expect(await stockDisponible(segundo.loteId)).toBe(5);
  });

  it("marca la entrega y sus detalles como inactivos y anota el motivo", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 10 });
    await registrarEntrega(insumo, 3);

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Error de digitacion')`,
      [rows[0].id, usuarioId],
    );

    const entrega = await poolOwner.query<{
      activo: boolean;
      observaciones: string;
    }>(`SELECT activo, observaciones FROM public.entrega WHERE id = $1`, [
      rows[0].id,
    ]);
    expect(entrega.rows[0].activo).toBe(false);
    expect(entrega.rows[0].observaciones).toMatch(
      /ANULADA.*Error de digitacion/,
    );

    // Borrado logico: los detalles siguen existiendo como evidencia.
    const detalles = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.detalle_entrega WHERE entrega_id = $1`,
      [rows[0].id],
    );
    expect(detalles.rows.length).toBeGreaterThan(0);
    expect(detalles.rows.every((d) => d.activo === false)).toBe(true);
  });

  it("no permite anular dos veces la misma entrega", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });
    await registrarEntrega(insumo, 2);

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Primera')`,
      [rows[0].id, usuarioId],
    );

    // Sin esta guarda, anular dos veces devolveria el stock dos veces y
    // el inventario prometeria unidades que no existen.
    await expect(
      poolOwner.query(`CALL public.sp_desactivar_entrega($1, $2, 'Segunda')`, [
        rows[0].id,
        usuarioId,
      ]),
    ).rejects.toThrow(/no existe o ya est[aá] desactivada/i);

    expect(await stockDisponible(lote.loteId)).toBe(10);
  });

  it("rechaza anular con un usuario inexistente", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 10 });
    await registrarEntrega(insumo, 1);

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await expect(
      poolOwner.query(`CALL public.sp_desactivar_entrega($1, -999, 'X')`, [
        rows[0].id,
      ]),
    ).rejects.toThrow(/usuario .* no existe/i);
  });

  /**
   * Si el lote de origen se dio de baja (vencido o dañado) despues de la
   * entrega, restituir ahi seria devolver stock a un lote que ya no debe
   * usarse. El sistema prefiere NO restaurar y avisar, en vez de inflar el
   * inventario con unidades inservibles.
   */
  it("no restaura hacia un lote que fue dado de baja", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });
    await registrarEntrega(insumo, 4);

    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET activo = false WHERE id = $1`,
      [lote.loteId],
    );

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Lote dado de baja')`,
      [rows[0].id, usuarioId],
    );

    // La anulacion no falla, pero el stock del lote inactivo queda como estaba.
    expect(await stockDisponible(lote.loteId)).toBe(6);
  });
});
