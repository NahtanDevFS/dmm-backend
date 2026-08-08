import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface EntregaRow {
  id: number;
  detalle_solicitud_id: number | null;
  persona_id: number;
  persona_receptor_id: number | null;
  tipo_parentesco_receptor_id: number | null;
  fecha_entrega: Date;
  usuario_entrega_id: number;
  observaciones: string | null;
  activo: boolean;
}

export interface DetalleEntregaRow {
  id: number;
  detalle_inventario_lote_id: number;
  presentacion_despacho_id: number;
  cantidad_despacho_original: string;
  cantidad_entregada: number;
  activo: boolean;
  insumo_nombre: string;
  codigo_lote: string | null;
  fecha_caducidad: Date | null;
}

export interface LineaSolicitudParaEntrega {
  id: number;
  solicitud_id: number;
  insumo_id: number;
  cantidad_requerida: number;
  cantidad_entregada: number;
  estado_nombre: string;
  requiere_aprobacion: boolean;
  aprobada: boolean;
  persona_id: number;
}

const COLUMNAS_ENTREGA = `id, detalle_solicitud_id, persona_id, persona_receptor_id,
  tipo_parentesco_receptor_id, fecha_entrega, usuario_entrega_id, observaciones, activo`;

// ─────────────────────────────────────────────── lecturas

export async function buscarEntregaPorId(
  id: number,
): Promise<EntregaRow | null> {
  const result = await pool.query<EntregaRow>(
    `SELECT ${COLUMNAS_ENTREGA} FROM public.entrega WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Listado con los nombres ya resueltos. No hay vista para esto, así que se
 * arma la consulta aquí: el insumo de una entrega no está en `entrega`, se
 * alcanza por detalle_entrega -> detalle_inventario_lote -> insumo.
 */
export async function listarEntregas(params: {
  personaId?: number;
  insumoId?: number;
  desde?: string;
  hasta?: string;
  incluirAnuladas: boolean;
}): Promise<Record<string, unknown>[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (!params.incluirAnuladas) condiciones.push(`e.activo = true`);
  if (params.personaId !== undefined) {
    valores.push(params.personaId);
    condiciones.push(`e.persona_id = $${valores.length}`);
  }
  if (params.desde !== undefined) {
    valores.push(params.desde);
    condiciones.push(`e.fecha_entrega >= $${valores.length}::date`);
  }
  if (params.hasta !== undefined) {
    valores.push(params.hasta);
    condiciones.push(`e.fecha_entrega <= $${valores.length}::date`);
  }
  if (params.insumoId !== undefined) {
    valores.push(params.insumoId);
    condiciones.push(`EXISTS (
      SELECT 1 FROM public.detalle_entrega de2
      JOIN public.detalle_inventario_lote dl2 ON dl2.id = de2.detalle_inventario_lote_id
      WHERE de2.entrega_id = e.id AND dl2.insumo_id = $${valores.length}
    )`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT e.id,
            e.fecha_entrega,
            e.persona_id,
            p.nombres || ' ' || p.apellidos              AS persona_nombre_completo,
            e.persona_receptor_id,
            pr.nombres || ' ' || pr.apellidos            AS receptor_nombre_completo,
            tp.nombre                                    AS parentesco_receptor,
            e.detalle_solicitud_id,
            u.username                                   AS entregado_por,
            e.observaciones,
            e.activo,
            COALESCE(SUM(de.cantidad_entregada) FILTER (WHERE de.activo), 0)::integer AS total_entregado,
            COALESCE(string_agg(DISTINCT i.nombre, ', ') FILTER (WHERE de.activo), '') AS insumos
     FROM public.entrega e
     JOIN public.persona p        ON p.id = e.persona_id
     LEFT JOIN public.persona pr  ON pr.id = e.persona_receptor_id
     LEFT JOIN public.tipo_parentesco tp ON tp.id = e.tipo_parentesco_receptor_id
     JOIN public.usuario u        ON u.id = e.usuario_entrega_id
     LEFT JOIN public.detalle_entrega de ON de.entrega_id = e.id
     LEFT JOIN public.detalle_inventario_lote dl ON dl.id = de.detalle_inventario_lote_id
     LEFT JOIN public.insumo i    ON i.id = dl.insumo_id
     ${where}
     GROUP BY e.id, p.nombres, p.apellidos, pr.nombres, pr.apellidos, tp.nombre, u.username
     ORDER BY e.fecha_entrega DESC, e.id DESC`,
    valores,
  );
  return result.rows;
}

/** Renglones de la entrega: de qué lote salió cada cantidad. */
export async function listarDetallesDeEntrega(
  entregaId: number,
): Promise<DetalleEntregaRow[]> {
  const result = await pool.query<DetalleEntregaRow>(
    `SELECT de.id, de.detalle_inventario_lote_id, de.presentacion_despacho_id,
            de.cantidad_despacho_original, de.cantidad_entregada, de.activo,
            i.nombre AS insumo_nombre, rl.codigo_lote, dl.fecha_caducidad
     FROM public.detalle_entrega de
     JOIN public.detalle_inventario_lote dl ON dl.id = de.detalle_inventario_lote_id
     JOIN public.insumo i ON i.id = dl.insumo_id
     JOIN public.recepcion_donacion_lote rl ON rl.id = dl.recepcion_lote_id
     WHERE de.entrega_id = $1
     ORDER BY de.id`,
    [entregaId],
  );
  return result.rows;
}

/**
 * Orden en que sp_registrar_entrega va a consumir los lotes. Se expone tal cual
 * la vista, sin reordenar: `orden_fifo` es caducidad, o fecha de recepción más
 * 100 años cuando el lote no caduca (FEFO con fallback a FIFO).
 */
export async function listarLotesFifo(
  insumoId: number,
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(
    `SELECT detalle_inventario_lote_id, codigo_lote, fecha_caducidad,
            fecha_recepcion, cantidad_disponible, orden_fifo
     FROM public.v_inventario_lote_fifo
     WHERE insumo_id = $1 AND activo = true AND cantidad_disponible > 0
     ORDER BY orden_fifo ASC`,
    [insumoId],
  );
  return result.rows;
}

// ─────────────────────────────────────────────── validaciones

export async function existePersonaActiva(id: number): Promise<boolean> {
  const persona = await prisma.persona.findUnique({
    where: { id },
    select: { activo: true },
  });
  return persona?.activo === true;
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

export async function existeTipoParentescoActivo(id: number): Promise<boolean> {
  const tipo = await prisma.tipo_parentesco.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}

export async function existeTipoEvidenciaActivo(id: number): Promise<boolean> {
  const tipo = await prisma.tipo_evidencia_entrega.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}

/** Datos de la línea de solicitud necesarios para las reglas de despacho. */
export async function buscarLineaParaEntrega(
  id: number,
): Promise<LineaSolicitudParaEntrega | null> {
  const result = await pool.query<LineaSolicitudParaEntrega>(
    `SELECT d.id, d.solicitud_id, d.insumo_id, d.cantidad_requerida,
            d.cantidad_entregada, e.nombre AS estado_nombre,
            s.requiere_aprobacion, s.aprobada, s.persona_id
     FROM public.detalle_solicitud_apoyo d
     JOIN public.estado_solicitud_apoyo e ON e.id = d.estado_id
     JOIN public.solicitud_apoyo s ON s.id = d.solicitud_id
     WHERE d.id = $1 AND d.activo = true`,
    [id],
  );
  return result.rows[0] ?? null;
}

// ─────────────────────────────────────────────── escrituras

/**
 * Registra la entrega invocando sp_registrar_entrega. El SP crea la cabecera,
 * recorre v_inventario_lote_fifo en orden y va insertando un detalle_entrega por
 * lote; los triggers hacen el resto: fn_calcular_cantidad_entregada convierte la
 * presentación, fn_descontar_inventario descuenta con FOR UPDATE y
 * fn_actualizar_linea_desde_entrega recalcula la línea y la cabecera de la
 * solicitud. El backend no reimplementa nada de eso.
 *
 * El procedimiento no devuelve el id de la entrega creada, así que se lee con
 * currval() de la secuencia: es por sesión, así que no lo afectan inserciones
 * concurrentes de otras transacciones.
 */
export async function registrarEntrega(
  usuarioId: number,
  datos: {
    persona_id: number;
    insumo_id: number;
    cantidad: number;
    detalle_solicitud_id?: number | null;
    persona_receptor_id?: number | null;
    tipo_parentesco_receptor_id?: number | null;
    observaciones?: string | null;
  },
): Promise<number> {
  return withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        datos.detalle_solicitud_id ?? null,
        datos.persona_id,
        datos.insumo_id,
        datos.cantidad,
        usuarioId,
        datos.observaciones ?? null,
        datos.persona_receptor_id ?? null,
        datos.tipo_parentesco_receptor_id ?? null,
      ],
    );

    const result = await client.query<{ id: string }>(
      `SELECT currval('entrega_id_seq') AS id`,
    );
    return Number(result.rows[0].id);
  });
}

/**
 * Anulación. El UPDATE de `entrega.activo` dispara trg_restaurar_inventario,
 * que devuelve las cantidades a cada lote. El SP desactiva los detalles
 * *después* de ese UPDATE justamente para que el trigger todavía los vea
 * activos y pueda restaurarlos.
 */
export async function anularEntrega(
  usuarioId: number,
  entregaId: number,
  motivo: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(`CALL public.sp_desactivar_entrega($1, $2, $3)`, [
      entregaId,
      usuarioId,
      motivo,
    ]);
  });
}
