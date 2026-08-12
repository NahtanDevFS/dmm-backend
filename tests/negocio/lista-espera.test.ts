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
 * Lista de espera y recalculo de estados en cascada.
 *
 * Dos mecanismos que cierran el ciclo de una solicitud:
 *
 *  - `sp_procesar_donacion_pendientes`: cuando llega una donacion, reparte la
 *    disponibilidad entre las lineas que estaban esperando, en orden de
 *    llegada. Lo ve directamente el beneficiario: si reparte mal, quien lleva
 *    meses esperando se queda atras.
 *
 *  - `fn_recalcular_linea_solicitud` -> `fn_recalcular_cabecera_solicitud`:
 *    al entregar, la linea y la cabecera se mueven solas. El backend nunca
 *    escribe esos estados.
 *
 * Ojo con una sutileza: el SP de lista de espera NO descuenta inventario, solo
 * marca lineas como listas para entregar. El descuento fisico ocurre despues,
 * cuando el empleado despacha.
 */

let usuarioId: number;
let programaId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("lista_espera");

  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa espera', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_entrega, public.entrega,
                    public.detalle_solicitud_apoyo, public.solicitud_apoyo,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote,
                    public.persona
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await cerrarPools();
});

async function crearSolicitudConLinea(
  insumo: InsumoCreado,
  cantidad: number,
  nombre: string,
): Promise<{ solicitudId: number; lineaId: number; personaId: number }> {
  const personaId = await crearPersona(usuarioId, { nombres: nombre });

  const sol = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.solicitud_apoyo (persona_id, programa_id, estado_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      personaId,
      programaId,
      await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ADQUISICION"),
      usuarioId,
    ],
  );

  const linea = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.detalle_solicitud_apoyo
       (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
     VALUES ($1, $2, $3, 1, $4) RETURNING id`,
    [sol.rows[0].id, insumo.insumoId, cantidad, usuarioId],
  );

  return {
    solicitudId: sol.rows[0].id,
    lineaId: linea.rows[0].id,
    personaId,
  };
}

async function estadoLinea(lineaId: number): Promise<string> {
  const { rows } = await poolOwner.query<{ nombre: string }>(
    `SELECT e.nombre FROM public.detalle_solicitud_apoyo d
     JOIN public.estado_solicitud_apoyo e ON e.id = d.estado_id
     WHERE d.id = $1`,
    [lineaId],
  );
  return rows[0].nombre;
}

async function estadoSolicitud(solicitudId: number): Promise<string> {
  const { rows } = await poolOwner.query<{ nombre: string }>(
    `SELECT e.nombre FROM public.solicitud_apoyo s
     JOIN public.estado_solicitud_apoyo e ON e.id = s.estado_id
     WHERE s.id = $1`,
    [solicitudId],
  );
  return rows[0].nombre;
}

async function procesarDonacion(insumo: InsumoCreado): Promise<void> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `SELECT id FROM public.recepcion_donacion_lote ORDER BY id DESC LIMIT 1`,
  );
  await poolOwner.query(`CALL public.sp_procesar_donacion_pendientes($1, $2)`, [
    insumo.insumoId,
    rows[0]?.id ?? null,
  ]);
}

describe("reparto de la lista de espera", () => {
  it("atiende primero a quien lleva mas tiempo esperando", async () => {
    const insumo = await crearInsumo(usuarioId);
    const primera = await crearSolicitudConLinea(
      insumo,
      5,
      "Primera en llegar",
    );
    // created_at se separa a mano: dentro de una misma prueba los INSERT
    // ocurren en el mismo instante y el ORDER BY quedaria indefinido.
    await poolOwner.query(
      `UPDATE public.detalle_solicitud_apoyo
       SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days' WHERE id = $1`,
      [primera.lineaId],
    );
    const segunda = await crearSolicitudConLinea(
      insumo,
      5,
      "Segunda en llegar",
    );

    expect(await estadoLinea(primera.lineaId)).toBe("PENDIENTE_ADQUISICION");
    expect(await estadoLinea(segunda.lineaId)).toBe("PENDIENTE_ADQUISICION");

    // Llega una donacion que solo alcanza para una de las dos.
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await procesarDonacion(insumo);

    expect(await estadoLinea(primera.lineaId)).toBe("PENDIENTE_ENTREGA");
    expect(await estadoLinea(segunda.lineaId)).toBe("PENDIENTE_ADQUISICION");
  });

  it("marca como parcial a quien solo alcanza a cubrirse en parte", async () => {
    const insumo = await crearInsumo(usuarioId);
    const linea = await crearSolicitudConLinea(insumo, 10, "Pide diez");

    await crearLote(usuarioId, insumo, { cantidad: 4 });
    await procesarDonacion(insumo);

    expect(await estadoLinea(linea.lineaId)).toBe("PENDIENTE_ENTREGA_PARCIAL");
  });

  it("registra la fecha de asignacion", async () => {
    const insumo = await crearInsumo(usuarioId);
    const linea = await crearSolicitudConLinea(insumo, 3, "Con fecha");

    await crearLote(usuarioId, insumo, { cantidad: 10 });
    await procesarDonacion(insumo);

    const { rows } = await poolOwner.query<{ fecha_asignacion: Date | null }>(
      `SELECT fecha_asignacion FROM public.detalle_solicitud_apoyo WHERE id = $1`,
      [linea.lineaId],
    );
    expect(rows[0].fecha_asignacion).not.toBeNull();
  });

  it("no toca las lineas de otros insumos", async () => {
    const pedido = await crearInsumo(usuarioId, { nombre: "El donado" });
    const otro = await crearInsumo(usuarioId, { nombre: "Otro distinto" });
    const lineaPedido = await crearSolicitudConLinea(
      pedido,
      2,
      "Espera donado",
    );
    const lineaOtro = await crearSolicitudConLinea(otro, 2, "Espera otro");

    await crearLote(usuarioId, pedido, { cantidad: 10 });
    await procesarDonacion(pedido);

    expect(await estadoLinea(lineaPedido.lineaId)).toBe("PENDIENTE_ENTREGA");
    expect(await estadoLinea(lineaOtro.lineaId)).toBe("PENDIENTE_ADQUISICION");
  });

  it("no hace nada si no hay stock", async () => {
    const insumo = await crearInsumo(usuarioId);
    const linea = await crearSolicitudConLinea(insumo, 5, "Sigue esperando");

    await poolOwner.query(
      `CALL public.sp_procesar_donacion_pendientes($1, NULL)`,
      [insumo.insumoId],
    );

    expect(await estadoLinea(linea.lineaId)).toBe("PENDIENTE_ADQUISICION");
  });

  it("no descuenta inventario: solo reserva la disponibilidad", async () => {
    // El descuento fisico ocurre al despachar, no al asignar. Si este SP
    // descontara, el stock se restaria dos veces.
    const insumo = await crearInsumo(usuarioId);
    await crearSolicitudConLinea(insumo, 5, "Reservada");
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });

    await procesarDonacion(insumo);

    const { rows } = await poolOwner.query<{ cantidad_disponible: number }>(
      `SELECT cantidad_disponible FROM public.detalle_inventario_lote WHERE id = $1`,
      [lote.loteId],
    );
    expect(rows[0].cantidad_disponible).toBe(10);
  });

  it("reparte entre varias lineas hasta agotar la donacion", async () => {
    const insumo = await crearInsumo(usuarioId);
    const a = await crearSolicitudConLinea(insumo, 3, "Espera A");
    await poolOwner.query(
      `UPDATE public.detalle_solicitud_apoyo
       SET created_at = CURRENT_TIMESTAMP - INTERVAL '3 days' WHERE id = $1`,
      [a.lineaId],
    );
    const b = await crearSolicitudConLinea(insumo, 3, "Espera B");
    await poolOwner.query(
      `UPDATE public.detalle_solicitud_apoyo
       SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days' WHERE id = $1`,
      [b.lineaId],
    );
    const c = await crearSolicitudConLinea(insumo, 3, "Espera C");

    // 7 unidades: cubren A (3), B (3) y dejan 1 para C.
    await crearLote(usuarioId, insumo, { cantidad: 7 });
    await procesarDonacion(insumo);

    expect(await estadoLinea(a.lineaId)).toBe("PENDIENTE_ENTREGA");
    expect(await estadoLinea(b.lineaId)).toBe("PENDIENTE_ENTREGA");
    expect(await estadoLinea(c.lineaId)).toBe("PENDIENTE_ENTREGA_PARCIAL");
  });
});

describe("recalculo de la linea al entregar", () => {
  async function entregarContra(
    linea: { lineaId: number; personaId: number },
    insumo: InsumoCreado,
    cantidad: number,
  ): Promise<void> {
    await poolOwner.query(
      `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        linea.lineaId,
        linea.personaId,
        insumo.insumoId,
        cantidad,
        usuarioId,
        null,
        null,
        null,
      ],
    );
  }

  it("pasa a PARCIAL cuando se entrega menos de lo pedido", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 20 });
    const linea = await crearSolicitudConLinea(insumo, 10, "Recibe parte");

    await entregarContra(linea, insumo, 4);

    expect(await estadoLinea(linea.lineaId)).toBe("PENDIENTE_ENTREGA_PARCIAL");

    const { rows } = await poolOwner.query<{ cantidad_entregada: number }>(
      `SELECT cantidad_entregada FROM public.detalle_solicitud_apoyo WHERE id = $1`,
      [linea.lineaId],
    );
    expect(rows[0].cantidad_entregada).toBe(4);
  });

  it("pasa a ENTREGADA al completar la cantidad pedida", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 20 });
    const linea = await crearSolicitudConLinea(insumo, 10, "Recibe todo");

    // En dos entregas sucesivas: el total es lo que cuenta, no cada entrega.
    await entregarContra(linea, insumo, 6);
    expect(await estadoLinea(linea.lineaId)).toBe("PENDIENTE_ENTREGA_PARCIAL");

    await entregarContra(linea, insumo, 4);
    expect(await estadoLinea(linea.lineaId)).toBe("ENTREGADA");
  });

  /**
   * Regresion de estado al anular.
   *
   * Este test detecto un bug real: `fn_recalcular_linea_solicitud` conservaba
   * el estado cuando el total entregado volvia a 0, asi que una linea anulada
   * se quedaba en ENTREGADA con 0 unidades. Como `v_lista_espera` solo muestra
   * PENDIENTE_ADQUISICION y PENDIENTE_ENTREGA_PARCIAL, la persona desaparecia
   * de toda lista de pendientes y el sistema la daba por atendida.
   *
   * Corregido en db/migraciones/13_fix_recalculo_al_anular_entrega.sql.
   */
  it("vuelve atras al anular la entrega", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 20 });
    const linea = await crearSolicitudConLinea(insumo, 5, "Se anula");

    await entregarContra(linea, insumo, 5);
    expect(await estadoLinea(linea.lineaId)).toBe("ENTREGADA");

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Anulada en prueba')`,
      [rows[0].id, usuarioId],
    );

    const { rows: linea2 } = await poolOwner.query<{
      cantidad_entregada: number;
    }>(
      `SELECT cantidad_entregada FROM public.detalle_solicitud_apoyo WHERE id = $1`,
      [linea.lineaId],
    );
    expect(linea2[0].cantidad_entregada).toBe(0);
    // Hay stock (quedaron 20 tras devolver), asi que vuelve a estar lista
    // para entregar, no a lista de espera.
    expect(await estadoLinea(linea.lineaId)).toBe("PENDIENTE_ENTREGA");
  });

  it("vuelve a lista de espera si al anular ya no queda stock", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 5 });
    const linea = await crearSolicitudConLinea(
      insumo,
      5,
      "Sin stock al volver",
    );

    await entregarContra(linea, insumo, 5);

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    // Se da de baja el lote antes de anular: al restaurar no hay donde
    // devolver, asi que el insumo queda sin existencias.
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET activo = false WHERE id = $1`,
      [lote.loteId],
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Lote dado de baja')`,
      [rows[0].id, usuarioId],
    );

    expect(await estadoLinea(linea.lineaId)).toBe("PENDIENTE_ADQUISICION");
  });

  it("no resucita una linea cancelada al anular su entrega", async () => {
    // Cancelar es una decision humana: anular una entrega no debe revertirla.
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 20 });
    const linea = await crearSolicitudConLinea(insumo, 5, "Cancelada");

    await entregarContra(linea, insumo, 2);
    await poolOwner.query(
      `CALL public.sp_cancelar_linea_solicitud($1, $2, 'Ya no la necesita')`,
      [linea.lineaId, usuarioId],
    );
    expect(await estadoLinea(linea.lineaId)).toBe("CANCELADA");

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Anulada despues de cancelar')`,
      [rows[0].id, usuarioId],
    );

    expect(await estadoLinea(linea.lineaId)).toBe("CANCELADA");
  });

  it("reabre tambien la cabecera al anular todas sus entregas", async () => {
    // La cabecera tenia el mismo hueco: sin ninguna linea con avance, ninguna
    // rama del IF se cumplia y la solicitud conservaba ENTREGADA.
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 20 });
    const linea = await crearSolicitudConLinea(insumo, 4, "Cabecera reabierta");

    await entregarContra(linea, insumo, 4);
    expect(await estadoSolicitud(linea.solicitudId)).toBe("ENTREGADA");

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Anulada')`,
      [rows[0].id, usuarioId],
    );

    expect(await estadoSolicitud(linea.solicitudId)).not.toBe("ENTREGADA");
  });

  it("la linea reabierta reaparece en la lista de espera", async () => {
    // La consecuencia visible del bug: la persona desaparecia de la vista que
    // usa la trabajadora social para saber a quien le falta su insumo.
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 5 });
    const linea = await crearSolicitudConLinea(insumo, 5, "Reaparece");

    await entregarContra(linea, insumo, 5);

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT id FROM public.entrega ORDER BY id DESC LIMIT 1`,
    );
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET activo = false WHERE id = $1`,
      [lote.loteId],
    );
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Anulada')`,
      [rows[0].id, usuarioId],
    );

    const { rows: espera } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.v_lista_espera
       WHERE detalle_solicitud_id = $1`,
      [linea.lineaId],
    );
    expect(espera[0].n).toBe("1");
  });
});

describe("recalculo de la cabecera en cascada", () => {
  async function entregarLinea(
    lineaId: number,
    personaId: number,
    insumo: InsumoCreado,
    cantidad: number,
  ): Promise<void> {
    await poolOwner.query(
      `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        lineaId,
        personaId,
        insumo.insumoId,
        cantidad,
        usuarioId,
        null,
        null,
        null,
      ],
    );
  }

  it("marca la solicitud como PARCIAL si solo avanza una linea", async () => {
    const insumoA = await crearInsumo(usuarioId, { nombre: "Insumo A" });
    const insumoB = await crearInsumo(usuarioId, { nombre: "Insumo B" });
    await crearLote(usuarioId, insumoA, { cantidad: 20 });
    await crearLote(usuarioId, insumoB, { cantidad: 20 });

    const primera = await crearSolicitudConLinea(insumoA, 5, "Dos insumos");
    const segunda = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.detalle_solicitud_apoyo
         (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
       VALUES ($1, $2, 5, 1, $3) RETURNING id`,
      [primera.solicitudId, insumoB.insumoId, usuarioId],
    );

    await entregarLinea(primera.lineaId, primera.personaId, insumoA, 5);

    expect(await estadoLinea(primera.lineaId)).toBe("ENTREGADA");
    expect(await estadoSolicitud(primera.solicitudId)).toBe(
      "PENDIENTE_ENTREGA_PARCIAL",
    );

    // Al cerrar la segunda linea, la cabecera se cierra sola.
    await entregarLinea(segunda.rows[0].id, primera.personaId, insumoB, 5);

    expect(await estadoSolicitud(primera.solicitudId)).toBe("ENTREGADA");
  });

  it("cierra la cabecera cuando su unica linea se completa", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 20 });
    const linea = await crearSolicitudConLinea(insumo, 4, "Una sola linea");

    await entregarLinea(linea.lineaId, linea.personaId, insumo, 4);

    expect(await estadoSolicitud(linea.solicitudId)).toBe("ENTREGADA");
  });

  it("cuenta las lineas canceladas como cerradas", async () => {
    // Cancelar una linea no debe dejar la solicitud abierta para siempre.
    const insumoA = await crearInsumo(usuarioId, { nombre: "Se entrega" });
    const insumoB = await crearInsumo(usuarioId, { nombre: "Se cancela" });
    await crearLote(usuarioId, insumoA, { cantidad: 20 });

    const primera = await crearSolicitudConLinea(insumoA, 3, "Mixta");
    const segunda = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.detalle_solicitud_apoyo
         (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
       VALUES ($1, $2, 3, 1, $3) RETURNING id`,
      [primera.solicitudId, insumoB.insumoId, usuarioId],
    );

    await entregarLinea(primera.lineaId, primera.personaId, insumoA, 3);
    await poolOwner.query(
      `CALL public.sp_cancelar_linea_solicitud($1, $2, 'No disponible')`,
      [segunda.rows[0].id, usuarioId],
    );

    expect(await estadoSolicitud(primera.solicitudId)).toBe("ENTREGADA");
  });
});
