import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface ContratoRow {
  id: number;
  detalle_entrega_id: number | null;
  contrato_anterior_id: number | null;
  fecha_inicio: Date;
  fecha_devolucion_pactada: Date;
  fecha_devolucion_real: Date | null;
  estado_id: number;
  /**
   * Por qué se anuló el contrato o por qué se dio el equipo por no devuelto.
   * Vacío mientras el préstamo sigue su curso normal.
   */
  motivo_cierre: string | null;
  activo: boolean;
}

const COLUMNAS = `id, detalle_entrega_id, contrato_anterior_id, fecha_inicio,
  fecha_devolucion_pactada, fecha_devolucion_real, estado_id, motivo_cierre,
  activo`;

async function idEstado(client: PoolClient, nombre: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `SELECT id FROM public.estado_contrato_prestamo WHERE nombre = $1`,
    [nombre],
  );
  return result.rows[0].id;
}

// ─────────────────────────────────────────────── lecturas

export async function buscarContratoPorId(
  id: number,
): Promise<ContratoRow | null> {
  const result = await pool.query<ContratoRow>(
    `SELECT ${COLUMNAS} FROM public.contrato_prestamo WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function buscarPersonaEInsumoDeContrato(id: number): Promise<{
  persona_id: number;
  persona_nombre_completo: string;
  insumo_nombre: string;
  cantidad_entregada: number;
} | null> {
  const result = await pool.query<{
    persona_id: number;
    persona_nombre_completo: string;
    insumo_nombre: string;
    cantidad_entregada: number;
  }>(
    `WITH RECURSIVE hacia_atras AS (
       SELECT id, detalle_entrega_id, contrato_anterior_id
       FROM public.contrato_prestamo WHERE id = $1
       UNION ALL
       SELECT cp.id, cp.detalle_entrega_id, cp.contrato_anterior_id
       FROM public.contrato_prestamo cp
       JOIN hacia_atras h ON h.contrato_anterior_id = cp.id
     )
     SELECT e.persona_id,
            p.nombres || ' ' || p.apellidos AS persona_nombre_completo,
            i.nombre AS insumo_nombre,
            de.cantidad_entregada
     FROM hacia_atras h
     JOIN public.detalle_entrega de ON de.id = h.detalle_entrega_id
     JOIN public.entrega e ON e.id = de.entrega_id
     JOIN public.persona p ON p.id = e.persona_id
     JOIN public.insumo i ON i.id = de.insumo_id
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Listado con el beneficiario y el insumo resueltos. Ninguno de los dos está en
 * `contrato_prestamo`: se alcanzan por detalle_entrega -> entrega -> persona y
 * detalle_entrega -> insumo. En una renovación esas
 * columnas son NULL, así que se sube por la cadena con un CTE recursivo hasta el
 * contrato raíz, que es el que sí tiene la entrega física.
 */
const CTE_RAIZ = `
  WITH RECURSIVE cadena AS (
    SELECT id, id AS raiz_id, detalle_entrega_id, contrato_anterior_id
    FROM public.contrato_prestamo
    WHERE detalle_entrega_id IS NOT NULL
    UNION ALL
    SELECT cp.id, c.raiz_id, c.detalle_entrega_id, cp.contrato_anterior_id
    FROM public.contrato_prestamo cp
    JOIN cadena c ON c.id = cp.contrato_anterior_id
  )`;

export async function listarContratos(params: {
  estado?: string;
  personaId?: number;
  incluirInactivos: boolean;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: Record<string, unknown>[] }> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (!params.incluirInactivos) condiciones.push(`cp.activo = true`);
  if (params.estado !== undefined) {
    valores.push(params.estado);
    condiciones.push(`ecp.nombre = $${valores.length}`);
  }
  if (params.personaId !== undefined) {
    valores.push(params.personaId);
    condiciones.push(`e.persona_id = $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const totalResult = await pool.query<{ n: number }>(
    `${CTE_RAIZ}
     SELECT count(*)::int AS n
     FROM public.contrato_prestamo cp
     JOIN public.estado_contrato_prestamo ecp ON ecp.id = cp.estado_id
     LEFT JOIN cadena ca ON ca.id = cp.id
     LEFT JOIN public.detalle_entrega de ON de.id = ca.detalle_entrega_id
     LEFT JOIN public.entrega e ON e.id = de.entrega_id
     ${where}`,
    valores,
  );

  const result = await pool.query(
    `${CTE_RAIZ}
     SELECT cp.id,
            cp.contrato_anterior_id,
            ca.detalle_entrega_id                    AS detalle_entrega_origen_id,
            cp.fecha_inicio,
            cp.fecha_devolucion_pactada,
            cp.fecha_devolucion_real,
            ecp.nombre                               AS estado,
            cp.activo,
            e.persona_id,
            p.nombres || ' ' || p.apellidos          AS persona_nombre_completo,
            i.nombre                                 AS insumo_nombre,
            de.cantidad_entregada,
            CASE
              WHEN cp.fecha_devolucion_real IS NOT NULL THEN 0
              WHEN cp.fecha_devolucion_pactada < CURRENT_DATE
                THEN CURRENT_DATE - cp.fecha_devolucion_pactada
              ELSE 0
            END::integer                             AS dias_de_retraso,
            COALESCE(m.multas_pendientes, 0)::integer AS multas_pendientes,
            COALESCE(m.monto_pendiente, 0)            AS monto_pendiente
     FROM public.contrato_prestamo cp
     JOIN public.estado_contrato_prestamo ecp ON ecp.id = cp.estado_id
     LEFT JOIN cadena ca ON ca.id = cp.id
     LEFT JOIN public.detalle_entrega de ON de.id = ca.detalle_entrega_id
     LEFT JOIN public.entrega e ON e.id = de.entrega_id
     LEFT JOIN public.persona p ON p.id = e.persona_id
     LEFT JOIN public.insumo i ON i.id = de.insumo_id
     LEFT JOIN (
       SELECT contrato_prestamo_id,
              count(*) FILTER (WHERE pagada = false) AS multas_pendientes,
              SUM(monto) FILTER (WHERE pagada = false) AS monto_pendiente
       FROM public.multa_prestamo WHERE activo = true
       GROUP BY contrato_prestamo_id
     ) m ON m.contrato_prestamo_id = cp.id
     ${where}
     ORDER BY cp.fecha_devolucion_pactada, cp.id
     LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, params.limite, params.desplazamiento],
  );

  return { total: totalResult.rows[0]?.n ?? 0, filas: result.rows };
}

/**
 * Contratos con la devolución atrasada: la fecha pactada ya pasó y no hay
 * devolución real registrada. Se calcula por fechas y no por `estado_id`,
 * porque nada en la base de datos mueve el estado a VENCIDO por sí solo.
 */
export async function listarContratosVencidos(): Promise<
  Record<string, unknown>[]
> {
  const result = await pool.query(
    `${CTE_RAIZ}
     SELECT cp.id,
            cp.fecha_inicio,
            cp.fecha_devolucion_pactada,
            (CURRENT_DATE - cp.fecha_devolucion_pactada)::integer AS dias_de_retraso,
            ecp.nombre AS estado,
            e.persona_id,
            p.nombres || ' ' || p.apellidos AS persona_nombre_completo,
            i.nombre AS insumo_nombre,
            de.cantidad_entregada,
            COALESCE(m.multas_pendientes, 0)::integer AS multas_pendientes
     FROM public.contrato_prestamo cp
     JOIN public.estado_contrato_prestamo ecp ON ecp.id = cp.estado_id
     LEFT JOIN cadena ca ON ca.id = cp.id
     LEFT JOIN public.detalle_entrega de ON de.id = ca.detalle_entrega_id
     LEFT JOIN public.entrega e ON e.id = de.entrega_id
     LEFT JOIN public.persona p ON p.id = e.persona_id
     LEFT JOIN public.insumo i ON i.id = de.insumo_id
     LEFT JOIN (
       SELECT contrato_prestamo_id, count(*)::int AS multas_pendientes
       FROM public.multa_prestamo WHERE activo = true AND pagada = false
       GROUP BY contrato_prestamo_id
     ) m ON m.contrato_prestamo_id = cp.id
     WHERE cp.activo = true
       AND cp.fecha_devolucion_real IS NULL
       AND cp.fecha_devolucion_pactada < CURRENT_DATE
       -- Una renovación deja el contrato anterior como EXTENDIDO: ese ya no se
       -- reclama, el vigente es el último de la cadena.
       AND ecp.nombre <> 'EXTENDIDO'
     ORDER BY cp.fecha_devolucion_pactada`,
  );
  return result.rows;
}

/** Cadena completa de renovaciones a la que pertenece un contrato. */
export async function listarCadenaDeRenovaciones(
  id: number,
): Promise<ContratoRow[]> {
  const result = await pool.query<ContratoRow>(
    `WITH RECURSIVE hacia_atras AS (
       SELECT ${COLUMNAS} FROM public.contrato_prestamo WHERE id = $1
       UNION
       SELECT cp.id, cp.detalle_entrega_id, cp.contrato_anterior_id, cp.fecha_inicio,
              cp.fecha_devolucion_pactada, cp.fecha_devolucion_real, cp.estado_id,
              cp.motivo_cierre, cp.activo
       FROM public.contrato_prestamo cp
       JOIN hacia_atras h ON h.contrato_anterior_id = cp.id
     ),
     hacia_adelante AS (
       SELECT ${COLUMNAS} FROM public.contrato_prestamo WHERE id = $1
       UNION
       SELECT cp.id, cp.detalle_entrega_id, cp.contrato_anterior_id, cp.fecha_inicio,
              cp.fecha_devolucion_pactada, cp.fecha_devolucion_real, cp.estado_id,
              cp.motivo_cierre, cp.activo
       FROM public.contrato_prestamo cp
       JOIN hacia_adelante h ON cp.contrato_anterior_id = h.id
     )
     SELECT * FROM hacia_atras
     UNION
     SELECT * FROM hacia_adelante
     ORDER BY fecha_inicio, id`,
    [id],
  );
  return result.rows;
}

/**
 * Contrato raíz de la cadena: el único que tiene `detalle_entrega_id` y por
 * tanto el que sp_registrar_devolucion_prestamo puede procesar, porque el SP
 * hace JOIN con detalle_entrega para devolver las unidades al lote.
 */
export async function buscarContratoRaiz(
  id: number,
): Promise<ContratoRow | null> {
  const result = await pool.query<ContratoRow>(
    `WITH RECURSIVE hacia_atras AS (
       SELECT ${COLUMNAS} FROM public.contrato_prestamo WHERE id = $1
       UNION ALL
       SELECT cp.id, cp.detalle_entrega_id, cp.contrato_anterior_id, cp.fecha_inicio,
              cp.fecha_devolucion_pactada, cp.fecha_devolucion_real, cp.estado_id,
              cp.motivo_cierre, cp.activo
       FROM public.contrato_prestamo cp
       JOIN hacia_atras h ON h.contrato_anterior_id = cp.id
     )
     SELECT * FROM hacia_atras WHERE detalle_entrega_id IS NOT NULL LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** El UNIQUE de detalle_entrega_id permite un solo contrato por renglón entregado. */
export async function existeContratoDeDetalleEntrega(
  detalleEntregaId: number,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.contrato_prestamo WHERE detalle_entrega_id = $1`,
    [detalleEntregaId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function existeRenovacionDe(id: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.contrato_prestamo WHERE contrato_anterior_id = $1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function buscarDetalleEntregaActivo(
  id: number,
): Promise<{ id: number; entrega_activa: boolean } | null> {
  const result = await pool.query<{ id: number; entrega_activa: boolean }>(
    `SELECT de.id, e.activo AS entrega_activa
     FROM public.detalle_entrega de
     JOIN public.entrega e ON e.id = de.entrega_id
     WHERE de.id = $1 AND de.activo = true`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function nombreEstado(id: number): Promise<string | null> {
  const estado = await prisma.estado_contrato_prestamo.findUnique({
    where: { id },
    select: { nombre: true },
  });
  return estado?.nombre ?? null;
}

// ─────────────────────────────────────────────── escrituras

/**
 * Registra un préstamo completo en un solo acto: la entrega del equipo y su
 * contrato.
 *
 * El préstamo no pasa por solicitud. No hay estudio previo que hacer —eso es
 * para decidir una donación— sino un acuerdo hablado que se formaliza con un
 * contrato firmado. Obligarlo a recorrer solicitud, aprobación, despacho y
 * después contrato era hacerle dar cuatro vueltas a un trámite de un paso.
 *
 * Es posible porque desde la migración 19 una entrega puede existir sin línea
 * de solicitud. La entrega se registra igual y aparece en Entregas, porque el
 * equipo salió de verdad y el inventario se descontó por FEFO como siempre.
 *
 * Todo en una transacción: si el contrato falla, la entrega no queda hecha y
 * el stock no se descuenta.
 */
export async function crearPrestamoDirecto(
  usuarioId: number,
  datos: {
    persona_id: number;
    insumo_id: number;
    fecha_devolucion_pactada: string;
    observaciones?: string | null;
  },
): Promise<{ contrato: ContratoRow; entrega_id: number }> {
  return withUserTransaction(usuarioId, async (client) => {
    const cabecera = await client.query<{ id: number }>(
      `SELECT public.fn_crear_entrega($1, $2, $3, NULL, NULL) AS id`,
      [datos.persona_id, usuarioId, datos.observaciones ?? null],
    );
    const entregaId = cabecera.rows[0].id;

    // Una unidad por contrato: un contrato ampara un equipo concreto, con su
    // fecha de devolución y sus multas. Dos sillas son dos préstamos.
    await client.query(
      `CALL public.sp_agregar_insumo_entrega($1, $2, 1, NULL)`,
      [entregaId, datos.insumo_id],
    );

    const renglon = await client.query<{ id: number }>(
      `SELECT id FROM public.detalle_entrega
       WHERE entrega_id = $1 AND insumo_id = $2`,
      [entregaId, datos.insumo_id],
    );

    const estadoVigente = await idEstado(client, "VIGENTE");
    const contrato = await client.query<ContratoRow>(
      `INSERT INTO public.contrato_prestamo
         (detalle_entrega_id, fecha_devolucion_pactada, estado_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNAS}`,
      [
        renglon.rows[0].id,
        datos.fecha_devolucion_pactada,
        estadoVigente,
        usuarioId,
      ],
    );

    return { contrato: contrato.rows[0], entrega_id: entregaId };
  });
}

export async function crearContrato(
  usuarioId: number,
  datos: {
    detalle_entrega_id: number;
    fecha_devolucion_pactada: string;
    fecha_inicio?: string;
  },
): Promise<ContratoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const estadoVigente = await idEstado(client, "VIGENTE");

    const campos = [
      "detalle_entrega_id",
      "fecha_devolucion_pactada",
      "estado_id",
    ];
    const valores: unknown[] = [
      datos.detalle_entrega_id,
      datos.fecha_devolucion_pactada,
      estadoVigente,
    ];

    if (datos.fecha_inicio !== undefined) {
      campos.push("fecha_inicio");
      valores.push(datos.fecha_inicio);
    }

    campos.push("created_by");
    valores.push(usuarioId);

    const placeholders = valores.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query<ContratoRow>(
      `INSERT INTO public.contrato_prestamo (${campos.join(", ")})
       VALUES (${placeholders})
       RETURNING ${COLUMNAS}`,
      valores,
    );
    return result.rows[0];
  });
}

/**
 * Renovación: contrato nuevo encadenado al anterior. No lleva
 * `detalle_entrega_id` (el CHECK contrato_origen_check lo prohíbe: el equipo
 * físico ya salió con la entrega del contrato raíz) y el anterior queda como
 * EXTENDIDO para que deje de aparecer entre los reclamables.
 */
export async function renovarContrato(
  usuarioId: number,
  contratoAnteriorId: number,
  fechaDevolucionPactada: string,
): Promise<ContratoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const estadoVigente = await idEstado(client, "VIGENTE");
    const estadoExtendido = await idEstado(client, "EXTENDIDO");

    const result = await client.query<ContratoRow>(
      `INSERT INTO public.contrato_prestamo
         (contrato_anterior_id, fecha_devolucion_pactada, estado_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNAS}`,
      [contratoAnteriorId, fechaDevolucionPactada, estadoVigente, usuarioId],
    );

    await client.query(
      `UPDATE public.contrato_prestamo
       SET estado_id = $1, updated_by = $2
       WHERE id = $3`,
      [estadoExtendido, usuarioId, contratoAnteriorId],
    );

    return result.rows[0];
  });
}

export async function editarContrato(
  usuarioId: number,
  id: number,
  fechaDevolucionPactada: string,
): Promise<ContratoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<ContratoRow>(
      `UPDATE public.contrato_prestamo
       SET fecha_devolucion_pactada = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${COLUMNAS}`,
      [fechaDevolucionPactada, usuarioId, id],
    );
    return result.rows[0];
  });
}

/**
 * Devolución. sp_registrar_devolucion_prestamo devuelve las unidades al lote de
 * origen y marca DEVUELTO, pero solo acepta el contrato que tiene la entrega
 * física. Si la devolución se registra sobre una renovación, se invoca el SP
 * sobre el contrato raíz (donde está el stock) y además se marca la renovación
 * como DEVUELTA, para que la cadena quede coherente.
 */
export async function registrarDevolucion(
  usuarioId: number,
  contratoId: number,
  contratoRaizId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(`CALL public.sp_registrar_devolucion_prestamo($1, $2)`, [
      contratoRaizId,
      usuarioId,
    ]);

    if (contratoId !== contratoRaizId) {
      const estadoDevuelto = await idEstado(client, "DEVUELTO");
      await client.query(
        `UPDATE public.contrato_prestamo
         SET fecha_devolucion_real = CURRENT_DATE, estado_id = $1, updated_by = $2
         WHERE id = $3`,
        [estadoDevuelto, usuarioId, contratoId],
      );
    }
  });
}

/**
 * Pone en VENCIDO los contratos cuya fecha pactada ya pasó y siguen sin
 * devolución. No hay job ni trigger que lo haga: se expone como acción
 * explícita para que la DMM la corra (o un cron del servidor la invoque).
 */
/**
 * Anula un préstamo registrado por error: deshace el contrato Y la entrega,
 * devolviendo el equipo al inventario.
 *
 * Es para el caso "me equivoqué al capturar", no para "la persona no
 * devolvió". La diferencia importa: aquí el equipo nunca salió de verdad —o
 * volvió enseguida— así que el stock tiene que restituirse. Darlo por perdido
 * es otra cosa y usa cerrarContratoNoDevuelto.
 *
 * Solo se permite si el préstamo no tuvo movimientos: sin devolución
 * registrada y sin multas pagadas. Si los tuvo, no fue un error de captura y
 * borrarlo perdería el rastro de algo que sí ocurrió.
 *
 * El orden importa: primero se desactiva el contrato y después el renglón,
 * porque sp_desactivar_detalle_entrega rechaza anular un renglón que tenga un
 * contrato vigente.
 */
export async function anularContratoPorError(
  usuarioId: number,
  contratoId: number,
  motivo: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    const { rows } = await client.query<{
      detalle_entrega_id: number | null;
      fecha_devolucion_real: Date | null;
      activo: boolean;
    }>(
      `SELECT detalle_entrega_id, fecha_devolucion_real, activo
       FROM public.contrato_prestamo WHERE id = $1`,
      [contratoId],
    );

    if (rows.length === 0) throw new Error("El contrato no existe.");
    const contrato = rows[0];

    if (!contrato.activo) {
      throw new Error("El contrato ya está anulado.");
    }
    if (contrato.fecha_devolucion_real !== null) {
      throw new Error(
        "Este préstamo ya tiene una devolución registrada, así que no fue un error de captura. Si el equipo no volvió, ciérrelo como no devuelto.",
      );
    }

    const { rows: pagadas } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.multa_prestamo
       WHERE contrato_prestamo_id = $1 AND pagada = true AND activo = true`,
      [contratoId],
    );
    if (Number(pagadas[0].n) > 0) {
      throw new Error(
        "Este préstamo tiene multas ya pagadas: no se puede anular como si nunca hubiera existido.",
      );
    }

    await client.query(
      `UPDATE public.contrato_prestamo
       SET activo = false,
           motivo_cierre = 'ANULADO POR ERROR DE REGISTRO: ' || $2,
           updated_by = $3
       WHERE id = $1`,
      [contratoId, motivo, usuarioId],
    );

    // Las multas del contrato anulado dejan de tener sentido: se cobraban por
    // un préstamo que no existió.
    await client.query(
      `UPDATE public.multa_prestamo
       SET activo = false, updated_by = $2
       WHERE contrato_prestamo_id = $1 AND activo = true`,
      [contratoId, usuarioId],
    );

    if (contrato.detalle_entrega_id !== null) {
      await client.query(
        `CALL public.sp_desactivar_detalle_entrega($1, $2, $3)`,
        [
          contrato.detalle_entrega_id,
          usuarioId,
          "Préstamo anulado por error de registro: " + motivo,
        ],
      );
    }
  });
}

/**
 * Cierra un préstamo cuyo equipo no volvió.
 *
 * El contrato se da por terminado pero el stock NO se restituye, porque el
 * equipo efectivamente no está. Anularlo como si nunca hubiera existido diría
 * que hay una silla disponible que nadie tiene.
 *
 * El contrato queda activo: es un hecho ocurrido que hay que poder consultar,
 * con sus multas si las tuvo.
 */
export async function cerrarContratoNoDevuelto(
  usuarioId: number,
  contratoId: number,
  motivo: string,
): Promise<ContratoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const estadoNoDevuelto = await idEstado(client, "NO_DEVUELTO");

    const { rows } = await client.query<ContratoRow>(
      `UPDATE public.contrato_prestamo
       SET estado_id = $2,
           motivo_cierre = $3,
           updated_by = $4
       WHERE id = $1 AND activo = true AND fecha_devolucion_real IS NULL
       RETURNING ${COLUMNAS}`,
      [contratoId, estadoNoDevuelto, motivo, usuarioId],
    );

    if (rows.length === 0) {
      throw new Error(
        "El contrato no existe, está anulado, o ya tiene una devolución registrada.",
      );
    }
    return rows[0];
  });
}

/** Nombre del tipo de multa que se aplica sola al vencer el plazo. */
const MULTA_POR_ATRASO = "ATRASO";

export async function marcarContratosVencidos(
  usuarioId: number,
): Promise<{ actualizados: number; multas: number }> {
  return withUserTransaction(usuarioId, async (client) => {
    const estadoVencido = await idEstado(client, "VENCIDO");
    const result = await client.query(
      `UPDATE public.contrato_prestamo cp
       SET estado_id = $1, updated_by = $2
       WHERE cp.activo = true
         AND cp.fecha_devolucion_real IS NULL
         AND cp.fecha_devolucion_pactada < CURRENT_DATE
         AND cp.estado_id <> $1
         AND cp.estado_id NOT IN (
           SELECT id FROM public.estado_contrato_prestamo
           -- NO_DEVUELTO es un final, no un atraso: volver a marcarlo como
           -- vencido le aplicaría otra multa en cada pasada.
           WHERE nombre IN ('EXTENDIDO', 'NO_DEVUELTO')
         )`,
      [estadoVencido, usuarioId],
    );

    /*
      La multa por atraso se aplica sola: es una consecuencia del calendario,
      no una decisión de nadie. Las de daño sí se registran a mano, porque
      alguien tiene que ver el equipo y valorarlo.

      El monto sale de `monto_sugerido` del catálogo y no de una constante en
      el código: cuando cambie la tarifa se edita desde Catálogos, sin tocar
      esto.

      Se aplica UNA sola vez por contrato —el NOT EXISTS— para que volver a
      pulsar el botón no acumule multas por el mismo atraso.
    */
    const multas = await client.query(
      `INSERT INTO public.multa_prestamo
         (contrato_prestamo_id, tipo_multa_id, monto, motivo, created_by)
       SELECT cp.id, tm.id, tm.monto_sugerido,
              'Aplicada automáticamente: la fecha de devolución pactada ('
                || to_char(cp.fecha_devolucion_pactada, 'DD/MM/YYYY')
                || ') ya pasó.',
              $1
       FROM public.contrato_prestamo cp
       CROSS JOIN public.tipo_multa_prestamo tm
       WHERE tm.nombre = $2
         AND tm.activo = true
         AND tm.monto_sugerido IS NOT NULL
         AND cp.activo = true
         AND cp.estado_id = $3
         AND cp.fecha_devolucion_real IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.multa_prestamo mp
           WHERE mp.contrato_prestamo_id = cp.id
             AND mp.tipo_multa_id = tm.id
             AND mp.activo = true
         )`,
      [usuarioId, MULTA_POR_ATRASO, estadoVencido],
    );

    return {
      actualizados: result.rowCount ?? 0,
      multas: multas.rowCount ?? 0,
    };
  });
}
