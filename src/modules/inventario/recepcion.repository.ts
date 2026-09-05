import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface RecepcionRow {
  id: number;
  codigo_lote: string | null;
  fecha_recepcion: Date;
  institucion_id: number;
  observaciones_generales: string | null;
  activo: boolean;
}

export interface LoteInventarioRow {
  id: number;
  insumo_id: number;
  recepcion_lote_id: number;
  presentacion_recepcion_id: number;
  marca_id: number | null;
  cantidad_recepcion_original: string;
  unidades_por_presentacion_lote: string;
  cantidad_inicial: number;
  cantidad_disponible: number;
  codigo_lote_fabricante: string | null;
  fecha_caducidad: Date | null;
  observaciones: string | null;
  activo: boolean;
}

export interface SemaforoRow {
  detalle_inventario_lote_id: number;
  insumo_id: number;
  insumo_nombre: string;
  codigo_lote: string | null;
  fecha_caducidad: Date | null;
  fecha_recepcion: Date;
  cantidad_disponible: number;
  cantidad_inicial: number;
  semaforo: string;
  /** Código impreso por el fabricante, distinto del código del envío. */
  codigo_lote_fabricante: string | null;
  /** En qué presentación llegó este lote (caja, quintal, unidad). */
  presentacion_nombre: string;
  institucion_nombre: string;
}

const SELECT_RECEPCION = {
  id: true,
  codigo_lote: true,
  fecha_recepcion: true,
  institucion_id: true,
  observaciones_generales: true,
  activo: true,
} as const;

const RETURNING_RECEPCION = Object.keys(SELECT_RECEPCION).join(", ");

const COLUMNAS_LOTE = `id, insumo_id, recepcion_lote_id, presentacion_recepcion_id,
  marca_id, cantidad_recepcion_original, unidades_por_presentacion_lote,
  cantidad_inicial, cantidad_disponible, codigo_lote_fabricante,
  fecha_caducidad, observaciones, activo`;

export async function listarRecepciones(params: {
  institucionId?: number;
  incluirInactivas: boolean;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: RecepcionRow[] }> {
  const { institucionId, incluirInactivas } = params;
  const where = {
    ...(incluirInactivas ? {} : { activo: true }),
    ...(institucionId !== undefined ? { institucion_id: institucionId } : {}),
  };

  const [total, filas] = await Promise.all([
    prisma.recepcion_donacion_lote.count({ where }),
    prisma.recepcion_donacion_lote.findMany({
      where,
      orderBy: [{ fecha_recepcion: "desc" }, { id: "desc" }],
      select: SELECT_RECEPCION,
      take: params.limite,
      skip: params.desplazamiento,
    }),
  ]);

  return { total, filas };
}

export async function buscarRecepcionPorId(
  id: number,
): Promise<RecepcionRow | null> {
  return prisma.recepcion_donacion_lote.findUnique({
    where: { id },
    select: SELECT_RECEPCION,
  });
}

export async function existeInstitucionActiva(id: number): Promise<boolean> {
  const inst = await prisma.institucion_donante.findUnique({
    where: { id },
    select: { activo: true },
  });
  return inst?.activo === true;
}

export async function buscarInsumoActivo(
  id: number,
): Promise<{ nombre: string; serie_por_unidad: boolean } | null> {
  const insumo = await prisma.insumo.findUnique({
    where: { id },
    select: { nombre: true, activo: true, serie_por_unidad: true },
  });
  return insumo?.activo === true
    ? { nombre: insumo.nombre, serie_por_unidad: insumo.serie_por_unidad }
    : null;
}

export async function existeMarcaActiva(id: number): Promise<boolean> {
  const marca = await prisma.marca_insumo.findUnique({
    where: { id },
    select: { activo: true },
  });
  return marca?.activo === true;
}

/**
 * La presentación se consulta con `pg` porque el índice único parcial
 * idx_presentacion_default_unica hace que Prisma modele
 * insumo→presentaciones como 1:1 en lugar de 1:N.
 */
export async function buscarPresentacionActiva(
  id: number,
): Promise<{ id: number; insumo_id: number; unidad_nombre: string } | null> {
  const result = await pool.query<{
    id: number;
    insumo_id: number;
    unidad_nombre: string;
  }>(
    `SELECT p.id, p.insumo_id, u.nombre AS unidad_nombre
     FROM public.presentacion_insumo p
     JOIN public.unidad_medida u ON u.id = p.unidad_medida_id
     WHERE p.id = $1 AND p.activo = true`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function crearRecepcion(
  usuarioId: number,
  datos: {
    institucion_id: number;
    codigo_lote?: string | null;
    fecha_recepcion?: string;
    observaciones_generales?: string | null;
  },
): Promise<RecepcionRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const campos = ["institucion_id", "codigo_lote", "observaciones_generales"];
    const valores: unknown[] = [
      datos.institucion_id,
      datos.codigo_lote ?? null,
      datos.observaciones_generales ?? null,
    ];

    // fecha_recepcion tiene default CURRENT_DATE: solo se envía si el usuario
    // registra una donación recibida en una fecha anterior.
    if (datos.fecha_recepcion !== undefined) {
      campos.push("fecha_recepcion");
      valores.push(datos.fecha_recepcion);
    }

    campos.push("created_by");
    valores.push(usuarioId);

    const placeholders = valores.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query<RecepcionRow>(
      `INSERT INTO public.recepcion_donacion_lote (${campos.join(", ")})
       VALUES (${placeholders})
       RETURNING ${RETURNING_RECEPCION}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function editarRecepcion(
  usuarioId: number,
  id: number,
  datos: Record<string, unknown>,
): Promise<RecepcionRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of [
      "institucion_id",
      "codigo_lote",
      "fecha_recepcion",
      "observaciones_generales",
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

    const result = await client.query<RecepcionRow>(
      `UPDATE public.recepcion_donacion_lote
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${RETURNING_RECEPCION}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoRecepcion(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<RecepcionRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<RecepcionRow>(
      `UPDATE public.recepcion_donacion_lote
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${RETURNING_RECEPCION}`,
      [nuevoEstado, usuarioId, id],
    );
    return result.rows[0];
  });
}

export async function listarLotesDeRecepcion(
  recepcionId: number,
  incluirInactivos: boolean,
): Promise<LoteInventarioRow[]> {
  const result = await pool.query<LoteInventarioRow>(
    `SELECT ${COLUMNAS_LOTE}
     FROM public.detalle_inventario_lote
     WHERE recepcion_lote_id = $1 ${incluirInactivos ? "" : "AND activo = true"}
     ORDER BY id`,
    [recepcionId],
  );
  return result.rows;
}

export async function buscarLotePorId(
  id: number,
): Promise<LoteInventarioRow | null> {
  const result = await pool.query<LoteInventarioRow>(
    `SELECT ${COLUMNAS_LOTE} FROM public.detalle_inventario_lote WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Inserta el renglón de inventario y procesa la lista de espera en la misma
 * transacción.
 *
 * `cantidad_inicial` y `cantidad_disponible` se envían en 0 solo porque las
 * columnas son NOT NULL: trg_calcular_recepcion_lote (BEFORE INSERT) las
 * sobrescribe con FLOOR(cantidad_recepcion_original * unidades_por_presentacion_lote).
 *
 * sp_procesar_donacion_pendientes NO es automático: hay que invocarlo tras cada
 * inserción para que las líneas de solicitud en PENDIENTE_ADQUISICION pasen a
 * PENDIENTE_ENTREGA si el stock recién ingresado alcanza. Va dentro de la misma
 * transacción para que el lote y la reasignación de la lista de espera sean
 * atómicos y queden auditados con el mismo app.usuario_id.
 */
export async function crearLoteYProcesarPendientes(
  usuarioId: number,
  recepcionId: number,
  datos: {
    insumo_id: number;
    presentacion_recepcion_id: number;
    cantidad_recepcion_original: number;
    unidades_por_presentacion_lote: number;
    marca_id?: number | null;
    codigo_lote_fabricante?: string | null;
    fecha_caducidad?: string | null;
    observaciones?: string | null;
  },
): Promise<LoteInventarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<LoteInventarioRow>(
      `INSERT INTO public.detalle_inventario_lote
         (insumo_id, recepcion_lote_id, presentacion_recepcion_id, marca_id,
          cantidad_recepcion_original, unidades_por_presentacion_lote,
          codigo_lote_fabricante, fecha_caducidad, observaciones,
          cantidad_inicial, cantidad_disponible, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, $10)
       RETURNING ${COLUMNAS_LOTE}`,
      [
        datos.insumo_id,
        recepcionId,
        datos.presentacion_recepcion_id,
        datos.marca_id ?? null,
        datos.cantidad_recepcion_original,
        datos.unidades_por_presentacion_lote,
        datos.codigo_lote_fabricante ?? null,
        datos.fecha_caducidad ?? null,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );

    await client.query(`CALL public.sp_procesar_donacion_pendientes($1, $2)`, [
      datos.insumo_id,
      recepcionId,
    ]);

    return result.rows[0];
  });
}

/**
 * Registra varias unidades identificables de un mismo insumo, una fila por
 * número de serie.
 *
 * Es el ingreso de equipo: cinco sillas de ruedas son cinco unidades con cinco
 * series, no un lote de cinco. Sin esto, el código de fabricante —que la base
 * exige— se llenaba con la serie de una sola de ellas, y al prestar no había
 * forma de saber cuál se llevó la persona.
 *
 * Todas van en una transacción: si la tercera serie está repetida, no queda
 * ninguna registrada. Mejor eso que dos unidades cargadas y tres perdidas
 * sin que nadie sepa cuáles fueron.
 */
export async function crearUnidadesSerializadas(
  usuarioId: number,
  recepcionId: number,
  datos: {
    insumo_id: number;
    presentacion_recepcion_id: number;
    marca_id?: number | null;
    fecha_caducidad?: string | null;
    observaciones?: string | null;
    series: string[];
  },
): Promise<LoteInventarioRow[]> {
  return withUserTransaction(usuarioId, async (client) => {
    const creados: LoteInventarioRow[] = [];

    for (const serie of datos.series) {
      const result = await client.query<LoteInventarioRow>(
        `INSERT INTO public.detalle_inventario_lote
           (insumo_id, recepcion_lote_id, presentacion_recepcion_id, marca_id,
            cantidad_recepcion_original, unidades_por_presentacion_lote,
            codigo_lote_fabricante, fecha_caducidad, observaciones,
            cantidad_inicial, cantidad_disponible, created_by)
         VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $7, 0, 0, $8)
         RETURNING ${COLUMNAS_LOTE}`,
        [
          datos.insumo_id,
          recepcionId,
          datos.presentacion_recepcion_id,
          datos.marca_id ?? null,
          serie.trim(),
          datos.fecha_caducidad ?? null,
          datos.observaciones ?? null,
          usuarioId,
        ],
      );
      creados.push(result.rows[0]);
    }

    // Una vez, al final: las líneas en espera se resuelven con el stock total
    // ingresado, no unidad por unidad.
    await client.query(`CALL public.sp_procesar_donacion_pendientes($1, $2)`, [
      datos.insumo_id,
      recepcionId,
    ]);

    return creados;
  });
}

/**
 * `sp_dar_baja_insumo_vencido` hace su propio `set_config('app.usuario_id')`,
 * pero se invoca igual dentro de withUserTransaction para que el resto de la
 * transacción quede auditada de forma consistente.
 */
export async function darBajaLote(
  usuarioId: number,
  loteId: number,
  motivo: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(`CALL public.sp_dar_baja_insumo_vencido($1, $2, $3)`, [
      loteId,
      usuarioId,
      motivo,
    ]);
  });
}

export async function listarSemaforoInventario(params: {
  insumoId?: number;
  semaforo?: string;
}): Promise<SemaforoRow[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (params.insumoId !== undefined) {
    valores.push(params.insumoId);
    condiciones.push(`v.insumo_id = $${valores.length}`);
  }
  if (params.semaforo !== undefined) {
    valores.push(params.semaforo);
    condiciones.push(`v.semaforo = $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  /**
   * Se parte de la vista y se le agregan por join los datos que no expone:
   * de qué presentación se recibió el lote, con qué código de fabricante y de
   * qué institución vino.
   *
   * Van aquí y no dentro de la vista para no tener que migrarla: la vista
   * calcula el semáforo, que es su razón de ser, y estos son datos de
   * contexto que solo necesita esta pantalla. El alias `v` mantiene los
   * nombres de columna intactos, así que el ORDER BY de abajo sigue igual.
   */
  const result = await pool.query<SemaforoRow>(
    `SELECT v.detalle_inventario_lote_id, v.insumo_id, v.insumo_nombre,
            v.codigo_lote, v.fecha_caducidad, v.fecha_recepcion,
            v.cantidad_disponible, v.cantidad_inicial, v.semaforo,
            dl.codigo_lote_fabricante,
            um.nombre AS presentacion_nombre,
            ins.nombre AS institucion_nombre
     FROM public.v_semaforo_inventario v
     JOIN public.detalle_inventario_lote dl
       ON dl.id = v.detalle_inventario_lote_id
     JOIN public.presentacion_insumo pi ON pi.id = dl.presentacion_recepcion_id
     JOIN public.unidad_medida um ON um.id = pi.unidad_medida_id
     JOIN public.recepcion_donacion_lote rl ON rl.id = dl.recepcion_lote_id
     JOIN public.institucion_donante ins ON ins.id = rl.institucion_id
     ${where}
     ORDER BY CASE v.semaforo
                WHEN 'VENCIDO'  THEN 1
                WHEN 'ROJO'     THEN 2
                WHEN 'AMARILLO' THEN 3
                WHEN 'VERDE'    THEN 4
                ELSE 5
              END,
              v.fecha_caducidad NULLS LAST,
              v.insumo_nombre`,
    valores,
  );
  return result.rows;
}

export async function tieneLotesActivos(
  recepcionId: number,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.detalle_inventario_lote
     WHERE recepcion_lote_id = $1 AND activo = true
     LIMIT 1`,
    [recepcionId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function withReadClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
