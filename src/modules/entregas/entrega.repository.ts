import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface EntregaRow {
  id: number;
  persona_id: number;
  persona_receptor_id: number | null;
  tipo_parentesco_receptor_id: number | null;
  fecha_entrega: Date;
  usuario_entrega_id: number;
  observaciones: string | null;
  activo: boolean;
}

/** De qué lote salió una parte del renglón */
export interface LoteDeRenglon {
  id: number;
  detalle_inventario_lote_id: number;
  presentacion_despacho_id: number;
  cantidad_despacho_original: string;
  cantidad_entregada: number;
  activo: boolean;
  codigo_lote: string | null;
  /** Serie del fabricante, para el equipo donde cada unidad es una piezaidentificable */
  numero_serie: string | null;
  fecha_caducidad: string | null;
}

/** Un insumo entregado */
export interface DetalleEntregaRow {
  id: number;
  insumo_id: number;
  insumo_nombre: string;
  detalle_solicitud_id: number | null;
  solicitud_id: number | null;
  cantidad_entregada: number;
  activo: boolean;
  motivo_anulacion: string | null;
  fecha_anulacion: Date | null;
  tiene_prestamo: boolean;
  /** Si el insumo lleva serie por unidad: cambia cómo se rotula el lote */
  serie_por_unidad: boolean;
  /** Si ese préstamo ya se devolvió */
  prestamo_devuelto: boolean;
  lotes: LoteDeRenglon[];
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

const COLUMNAS_ENTREGA = `id, persona_id, persona_receptor_id,
  tipo_parentesco_receptor_id, fecha_entrega, usuario_entrega_id, observaciones, activo`;

// lecturas

export async function buscarEntregaPorId(
  id: number,
): Promise<EntregaRow | null> {
  const result = await pool.query<EntregaRow>(
    `SELECT ${COLUMNAS_ENTREGA} FROM public.entrega WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Listado con los nombres ya resueltos */
export async function listarEntregas(params: {
  personaId?: number;
  insumoId?: number;
  desde?: string;
  hasta?: string;
  incluirAnuladas: boolean;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: Record<string, unknown>[] }> {
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
      WHERE de2.entrega_id = e.id AND de2.insumo_id = $${valores.length}
    )`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

// Se cuentan entregas, no renglones: el listado agrupa por entrega, asi quecontar sobre el join daria un total inflado
  const totalResult = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.entrega e ${where}`,
    valores,
  );

  const result = await pool.query(
    `SELECT e.id,
            e.fecha_entrega,
            e.persona_id,
            p.nombres || ' ' || p.apellidos              AS persona_nombre_completo,
            e.persona_receptor_id,
            pr.nombres || ' ' || pr.apellidos            AS receptor_nombre_completo,
            tp.nombre                                    AS parentesco_receptor,
            u.username                                   AS entregado_por,
            e.observaciones,
            e.activo,
            COALESCE(SUM(de.cantidad_entregada) FILTER (WHERE de.activo), 0)::integer AS total_entregado,
            COALESCE(string_agg(DISTINCT i.nombre, ', ') FILTER (WHERE de.activo), '') AS insumos,
            -- Origen de la entrega. La regla de origen único garantiza que
            -- todos los renglones comparten solicitud, así que un MIN alcanza.
            MIN(dsa.solicitud_id)                        AS solicitud_id,
            COUNT(*) FILTER (WHERE NOT de.activo)::integer AS renglones_anulados
     FROM public.entrega e
     JOIN public.persona p        ON p.id = e.persona_id
     LEFT JOIN public.persona pr  ON pr.id = e.persona_receptor_id
     LEFT JOIN public.tipo_parentesco tp ON tp.id = e.tipo_parentesco_receptor_id
     JOIN public.usuario u        ON u.id = e.usuario_entrega_id
     LEFT JOIN public.detalle_entrega de ON de.entrega_id = e.id
     LEFT JOIN public.insumo i    ON i.id = de.insumo_id
     LEFT JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = de.detalle_solicitud_id
     ${where}
     GROUP BY e.id, p.nombres, p.apellidos, pr.nombres, pr.apellidos, tp.nombre, u.username
     ORDER BY e.fecha_entrega DESC, e.id DESC
     LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, params.limite, params.desplazamiento],
  );

  return { total: totalResult.rows[0]?.n ?? 0, filas: result.rows };
}

/** Renglones de la entrega: un insumo por fila, con el reparto por lotesanidado */
export async function listarDetallesDeEntrega(
  entregaId: number,
): Promise<DetalleEntregaRow[]> {
  const result = await pool.query<DetalleEntregaRow>(
    `SELECT de.id,
            de.insumo_id,
            i.nombre AS insumo_nombre,
            i.serie_por_unidad,
            de.detalle_solicitud_id,
            dsa.solicitud_id,
            de.cantidad_entregada,
            de.activo,
            de.motivo_anulacion,
            de.fecha_anulacion,
            EXISTS (SELECT 1 FROM public.contrato_prestamo cp
                     WHERE cp.detalle_entrega_id = de.id) AS tiene_prestamo,
            EXISTS (SELECT 1 FROM public.contrato_prestamo cp
                     WHERE cp.detalle_entrega_id = de.id
                       AND cp.fecha_devolucion_real IS NOT NULL)
              AS prestamo_devuelto,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', del.id,
                       'detalle_inventario_lote_id', del.detalle_inventario_lote_id,
                       'presentacion_despacho_id', del.presentacion_despacho_id,
                       'cantidad_despacho_original', del.cantidad_despacho_original,
                       'cantidad_entregada', del.cantidad_entregada,
                       'activo', del.activo,
                       'codigo_lote', rl.codigo_lote,
                       'numero_serie', dl.codigo_lote_fabricante,
                       'fecha_caducidad', dl.fecha_caducidad
                     ) ORDER BY del.id)
              FROM public.detalle_entrega_lote del
              JOIN public.detalle_inventario_lote dl ON dl.id = del.detalle_inventario_lote_id
              JOIN public.recepcion_donacion_lote rl ON rl.id = dl.recepcion_lote_id
              WHERE del.detalle_entrega_id = de.id
            ), '[]'::json) AS lotes
     FROM public.detalle_entrega de
     JOIN public.insumo i ON i.id = de.insumo_id
     LEFT JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = de.detalle_solicitud_id
     WHERE de.entrega_id = $1
     ORDER BY de.id`,
    [entregaId],
  );
  return result.rows;
}

/** Un renglón suelto, para validar antes de anularlo */
export async function buscarDetalleEntrega(
  id: number,
): Promise<{ id: number; entrega_id: number; activo: boolean } | null> {
  const result = await pool.query<{
    id: number;
    entrega_id: number;
    activo: boolean;
  }>(
    `SELECT id, entrega_id, activo FROM public.detalle_entrega WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Orden en que sp_registrar_entrega va a consumir los lotes */
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

// validaciones

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

/** Datos de la línea de solicitud necesarios para las reglas de despacho */
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

// escrituras

/** Registra la entrega completa: una cabecera y un renglón por insumo */
export async function registrarEntrega(
  usuarioId: number,
  datos: {
    persona_id: number;
    insumos: {
      insumo_id: number;
      cantidad: number;
      detalle_solicitud_id?: number | null;
    }[];
    persona_receptor_id?: number | null;
    tipo_parentesco_receptor_id?: number | null;
    observaciones?: string | null;
  },
): Promise<number> {
  return withUserTransaction(usuarioId, async (client) => {
    const cabecera = await client.query<{ id: number }>(
      `SELECT public.fn_crear_entrega($1, $2, $3, $4, $5) AS id`,
      [
        datos.persona_id,
        usuarioId,
        datos.observaciones ?? null,
        datos.persona_receptor_id ?? null,
        datos.tipo_parentesco_receptor_id ?? null,
      ],
    );
    const entregaId = cabecera.rows[0].id;

    for (const renglon of datos.insumos) {
      await client.query(
        `CALL public.sp_agregar_insumo_entrega($1, $2, $3, $4)`,
        [
          entregaId,
          renglon.insumo_id,
          renglon.cantidad,
          renglon.detalle_solicitud_id ?? null,
        ],
      );
    }

    return entregaId;
  });
}

/** Anulación de la entrega completa */
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

/** Anulación de un solo insumo, dejando el resto de la entrega en pie */
export async function anularDetalleEntrega(
  usuarioId: number,
  detalleId: number,
  motivo: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `CALL public.sp_desactivar_detalle_entrega($1, $2, $3)`,
      [detalleId, usuarioId, motivo],
    );
  });
}
