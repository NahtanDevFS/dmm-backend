import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface SolicitudRow {
  id: number;
  persona_id: number;
  programa_id: number;
  fecha_solicitud: Date;
  requiere_aprobacion: boolean;
  aprobada: boolean;
  estado_id: number;
  fecha_aprobacion: Date | null;
  aprobado_por: number | null;
  observaciones_trabajo_social: string | null;
  activo: boolean;
}

export interface LineaSolicitudRow {
  id: number;
  solicitud_id: number;
  insumo_id: number;
  cantidad_requerida: number;
  cantidad_entregada: number;
  estado_id: number;
  fecha_asignacion: Date | null;
  receta_medica_id: number | null;
  activo: boolean;
}

const COLUMNAS_SOLICITUD = `id, persona_id, programa_id, fecha_solicitud,
  requiere_aprobacion, aprobada, estado_id, fecha_aprobacion, aprobado_por,
  observaciones_trabajo_social, activo`;

const COLUMNAS_LINEA = `id, solicitud_id, insumo_id, cantidad_requerida,
  cantidad_entregada, estado_id, fecha_asignacion, receta_medica_id, activo`;

// ─────────────────────────────────────────────── lecturas

export async function buscarSolicitudPorId(
  id: number,
): Promise<SolicitudRow | null> {
  const result = await pool.query<SolicitudRow>(
    `SELECT ${COLUMNAS_SOLICITUD} FROM public.solicitud_apoyo WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listarLineasDeSolicitud(
  solicitudId: number,
  incluirInactivas: boolean,
): Promise<LineaSolicitudRow[]> {
  const result = await pool.query<LineaSolicitudRow>(
    `SELECT ${COLUMNAS_LINEA}
     FROM public.detalle_solicitud_apoyo
     WHERE solicitud_id = $1 ${incluirInactivas ? "" : "AND activo = true"}
     ORDER BY id`,
    [solicitudId],
  );
  return result.rows;
}

export async function buscarLineaPorId(
  id: number,
): Promise<LineaSolicitudRow | null> {
  const result = await pool.query<LineaSolicitudRow>(
    `SELECT ${COLUMNAS_LINEA} FROM public.detalle_solicitud_apoyo WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Listado sobre v_solicitudes_activas: una fila por línea pendiente, con los
 * nombres ya resueltos. La vista excluye líneas ENTREGADA y CANCELADA.
 */
export async function listarSolicitudesActivas(params: {
  personaId?: number;
  programaId?: number;
  estadoLinea?: string;
  soloPendientesAprobacion: boolean;
}): Promise<Record<string, unknown>[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (params.personaId !== undefined) {
    valores.push(params.personaId);
    condiciones.push(`persona_id = $${valores.length}`);
  }
  if (params.programaId !== undefined) {
    valores.push(params.programaId);
    condiciones.push(`programa_nombre = (SELECT nombre FROM public.programa WHERE id = $${valores.length})`);
  }
  if (params.estadoLinea !== undefined) {
    valores.push(params.estadoLinea);
    condiciones.push(`estado_linea = $${valores.length}`);
  }
  if (params.soloPendientesAprobacion) {
    condiciones.push(`requiere_aprobacion = true AND aprobada = false`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM public.v_solicitudes_activas ${where}
     ORDER BY fecha_solicitud DESC, solicitud_id DESC, detalle_solicitud_id`,
    valores,
  );
  return result.rows;
}

/** Lista de espera: líneas en PENDIENTE_ADQUISICION o PENDIENTE_ENTREGA_PARCIAL. */
export async function listarListaEspera(
  insumoNombre?: string,
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `SELECT * FROM public.v_lista_espera
     ${insumoNombre ? "WHERE insumo_nombre ILIKE $1" : ""}`,
    insumoNombre ? [`%${insumoNombre}%`] : [],
  );
  return result.rows;
}

// ─────────────────────────────────────────────── validaciones de FK activas

export async function existePersonaActiva(id: number): Promise<boolean> {
  const persona = await prisma.persona.findUnique({
    where: { id },
    select: { activo: true },
  });
  return persona?.activo === true;
}

export async function existeProgramaActivo(id: number): Promise<boolean> {
  const programa = await prisma.programa.findUnique({
    where: { id },
    select: { activo: true },
  });
  return programa?.activo === true;
}

export async function buscarInsumoActivo(
  id: number,
): Promise<{ nombre: string } | null> {
  const insumo = await prisma.insumo.findUnique({
    where: { id },
    select: { nombre: true, activo: true },
  });
  return insumo?.activo === true ? { nombre: insumo.nombre } : null;
}

export async function existeRecetaDeSolicitud(
  recetaId: number,
  solicitudId: number,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.receta_medica
     WHERE id = $1 AND solicitud_id = $2 AND activo = true`,
    [recetaId, solicitudId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ─────────────────────────────────────────────── escrituras

async function idEstado(client: PoolClient, nombre: string): Promise<number> {
  const result = await client.query<{ id: number }>(
    `SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = $1`,
    [nombre],
  );
  return result.rows[0].id;
}

/**
 * Deriva el estado de la cabecera a partir del estado que los triggers
 * asignaron a sus líneas.
 *
 * La base de datos no define el estado inicial de la cabecera: `estado_id` es
 * NOT NULL sin default, `trg_estado_inicial_linea_solicitud` solo actúa sobre
 * las líneas, y `fn_recalcular_cabecera_solicitud` sale temprano mientras no
 * haya entregas. Así que le toca al backend, con el criterio mínimo: si alguna
 * línea todavía necesita adquisición, el trámite está en PENDIENTE_ADQUISICION;
 * si todas tienen stock reservado, en PENDIENTE_ENTREGA.
 */
async function sincronizarEstadoCabecera(
  client: PoolClient,
  solicitudId: number,
  usuarioId: number,
): Promise<void> {
  await client.query(
    `UPDATE public.solicitud_apoyo sa
     SET estado_id = CASE
           WHEN EXISTS (
             SELECT 1 FROM public.detalle_solicitud_apoyo d
             JOIN public.estado_solicitud_apoyo e ON e.id = d.estado_id
             WHERE d.solicitud_id = sa.id AND d.activo = true
               AND e.nombre = 'PENDIENTE_ADQUISICION'
           )
           THEN (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ADQUISICION')
           ELSE (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA')
         END,
         updated_by = $2
     WHERE sa.id = $1
       -- No se pisan los estados terminales ni los de avance, que los fija
       -- fn_recalcular_cabecera_solicitud o el rechazo.
       AND sa.estado_id IN (
         SELECT id FROM public.estado_solicitud_apoyo
         WHERE nombre IN ('PENDIENTE_ADQUISICION', 'PENDIENTE_ENTREGA')
       )`,
    [solicitudId, usuarioId],
  );
}

/**
 * Cabecera + líneas en una sola transacción. El estado de cada línea lo pone
 * trg_estado_inicial_linea_solicitud según el stock disponible, y
 * trg_validar_stock_linea_solicitud puede abortar la transacción completa si el
 * insumo bloquea solicitudes sin stock: en ese caso no queda una cabecera
 * huérfana.
 */
export async function crearSolicitudConLineas(
  usuarioId: number,
  datos: {
    persona_id: number;
    programa_id: number;
    fecha_solicitud?: string;
    requiere_aprobacion?: boolean;
    observaciones_trabajo_social?: string | null;
    lineas: Array<{ insumo_id: number; cantidad_requerida: number }>;
  },
): Promise<{ solicitud: SolicitudRow; lineas: LineaSolicitudRow[] }> {
  return withUserTransaction(usuarioId, async (client) => {
    const estadoInicial = await idEstado(client, "PENDIENTE_ADQUISICION");

    const campos = [
      "persona_id",
      "programa_id",
      "requiere_aprobacion",
      "observaciones_trabajo_social",
      "estado_id",
    ];
    const valores: unknown[] = [
      datos.persona_id,
      datos.programa_id,
      datos.requiere_aprobacion ?? false,
      datos.observaciones_trabajo_social ?? null,
      estadoInicial,
    ];

    if (datos.fecha_solicitud !== undefined) {
      campos.push("fecha_solicitud");
      valores.push(datos.fecha_solicitud);
    }

    campos.push("created_by");
    valores.push(usuarioId);

    const placeholders = valores.map((_, i) => `$${i + 1}`).join(", ");
    const cabecera = await client.query<SolicitudRow>(
      `INSERT INTO public.solicitud_apoyo (${campos.join(", ")})
       VALUES (${placeholders})
       RETURNING ${COLUMNAS_SOLICITUD}`,
      valores,
    );
    const solicitudId = cabecera.rows[0].id;

    for (const linea of datos.lineas) {
      // estado_id se envía solo porque la columna es NOT NULL: el trigger
      // BEFORE INSERT lo sobrescribe según el stock real del insumo.
      await client.query(
        `INSERT INTO public.detalle_solicitud_apoyo
           (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          solicitudId,
          linea.insumo_id,
          linea.cantidad_requerida,
          estadoInicial,
          usuarioId,
        ],
      );
    }

    await sincronizarEstadoCabecera(client, solicitudId, usuarioId);

    const solicitud = await client.query<SolicitudRow>(
      `SELECT ${COLUMNAS_SOLICITUD} FROM public.solicitud_apoyo WHERE id = $1`,
      [solicitudId],
    );
    const lineas = await client.query<LineaSolicitudRow>(
      `SELECT ${COLUMNAS_LINEA} FROM public.detalle_solicitud_apoyo
       WHERE solicitud_id = $1 ORDER BY id`,
      [solicitudId],
    );

    return { solicitud: solicitud.rows[0], lineas: lineas.rows };
  });
}

export async function editarSolicitud(
  usuarioId: number,
  id: number,
  datos: Record<string, unknown>,
): Promise<SolicitudRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of [
      "programa_id",
      "requiere_aprobacion",
      "observaciones_trabajo_social",
    ] as const) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;
    valores.push(id);

    const result = await client.query<SolicitudRow>(
      `UPDATE public.solicitud_apoyo SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS_SOLICITUD}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function agregarLinea(
  usuarioId: number,
  solicitudId: number,
  datos: { insumo_id: number; cantidad_requerida: number },
): Promise<LineaSolicitudRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const estadoInicial = await idEstado(client, "PENDIENTE_ADQUISICION");
    const result = await client.query<LineaSolicitudRow>(
      `INSERT INTO public.detalle_solicitud_apoyo
         (solicitud_id, insumo_id, cantidad_requerida, estado_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNAS_LINEA}`,
      [
        solicitudId,
        datos.insumo_id,
        datos.cantidad_requerida,
        estadoInicial,
        usuarioId,
      ],
    );
    await sincronizarEstadoCabecera(client, solicitudId, usuarioId);
    return result.rows[0];
  });
}

export async function editarLinea(
  usuarioId: number,
  id: number,
  datos: { cantidad_requerida?: number; receta_medica_id?: number | null },
): Promise<LineaSolicitudRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of ["cantidad_requerida", "receta_medica_id"] as const) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;
    valores.push(id);

    const result = await client.query<LineaSolicitudRow>(
      `UPDATE public.detalle_solicitud_apoyo SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS_LINEA}`,
      valores,
    );
    return result.rows[0];
  });
}

/**
 * Aprobación. No toca `estado_id`: `aprobada` es una columna propia y el estado
 * refleja el avance del despacho, que lo administran los triggers. El CHECK de
 * la tabla exige que aprobada/fecha_aprobacion/aprobado_por se muevan juntos.
 */
export async function aprobarSolicitud(
  usuarioId: number,
  id: number,
): Promise<SolicitudRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<SolicitudRow>(
      `UPDATE public.solicitud_apoyo
       SET aprobada = true,
           fecha_aprobacion = CURRENT_DATE,
           aprobado_por = $1,
           updated_by = $1
       WHERE id = $2
       RETURNING ${COLUMNAS_SOLICITUD}`,
      [usuarioId, id],
    );
    return result.rows[0];
  });
}

/**
 * Rechazo. Cancela las líneas pendientes con sp_cancelar_solicitud_completa
 * (que registra el motivo en observaciones_trabajo_social) y después fija la
 * cabecera en RECHAZADA.
 *
 * El orden importa: el SP termina llamando a fn_recalcular_cabecera_solicitud,
 * que al ver todas las líneas cerradas pondría la cabecera en ENTREGADA. El
 * UPDATE posterior corrige eso, porque un trámite rechazado no se entregó.
 */
export async function rechazarSolicitud(
  usuarioId: number,
  id: number,
  motivo: string,
): Promise<SolicitudRow> {
  return withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `CALL public.sp_cancelar_solicitud_completa($1, $2, $3)`,
      [id, usuarioId, `Solicitud RECHAZADA: ${motivo}`],
    );

    const result = await client.query<SolicitudRow>(
      `UPDATE public.solicitud_apoyo
       SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'RECHAZADA'),
           updated_by = $1
       WHERE id = $2
       RETURNING ${COLUMNAS_SOLICITUD}`,
      [usuarioId, id],
    );
    return result.rows[0];
  });
}

export async function cancelarLinea(
  usuarioId: number,
  lineaId: number,
  motivo?: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(`CALL public.sp_cancelar_linea_solicitud($1, $2, $3)`, [
      lineaId,
      usuarioId,
      motivo ?? null,
    ]);
  });
}

export async function cancelarSolicitudCompleta(
  usuarioId: number,
  solicitudId: number,
  motivo?: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `CALL public.sp_cancelar_solicitud_completa($1, $2, $3)`,
      [solicitudId, usuarioId, motivo ?? null],
    );
  });
}
