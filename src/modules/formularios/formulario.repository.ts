import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

/**
 * Formularios configurables (migración 15): qué formulario exige una
 * categoría de insumo, de qué campos se compone cada uno, y las respuestas
 * capturadas para una línea de solicitud concreta.
 *
 * Todo aquí usa SQL crudo, no Prisma: estas tablas se crearon directo en la
 * base y prisma/schema.prisma todavía no las conoce (hace falta `prisma db
 * pull` en un entorno con acceso real a la base antes de poder usarlas desde
 * el cliente generado). El patrón —pool para lecturas, withUserTransaction
 * para escrituras que necesitan auditoría— es el mismo que ya usan
 * receta-medica.repository.ts y entrega.repository.ts para sus tramos de
 * SQL directo.
 */

/* ═══════════════════════════ Tipos ═══════════════════════════ */

export interface CatalogoRow {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface CatalogoValorRow {
  id: number;
  catalogo_id: number;
  etiqueta: string;
  orden: number;
  activo: boolean;
}

export interface TipoDatoCampoRow {
  id: number;
  nombre: string;
}

export interface FormularioRow {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
}

export interface FormularioCampoRow {
  id: number;
  formulario_id: number;
  etiqueta: string;
  tipo_dato_id: number;
  tipo_dato_nombre: string;
  catalogo_id: number | null;
  obligatorio: boolean;
  orden: number;
  grupo_repetible: string | null;
  ayuda: string | null;
  activo: boolean;
}

export interface FormularioCampoOpcionRow {
  id: number;
  formulario_campo_id: number;
  etiqueta: string;
  orden: number;
  activo: boolean;
}

/** Un formulario con sus campos ya resueltos, listo para que el frontend lo renderice. */
export interface FormularioConCampos extends FormularioRow {
  campos: FormularioCampoRow[];
}

export interface CategoriaInsumoFormularioRow {
  id: number;
  categoria_insumo_id: number;
  formulario_id: number;
  orden: number;
  activo: boolean;
}

export interface DetalleSolicitudFormularioRow {
  id: number;
  detalle_solicitud_id: number;
  formulario_id: number;
  completado: boolean;
  activo: boolean;
}

export interface RespuestaRow {
  id: number;
  detalle_solicitud_formulario_id: number;
  formulario_campo_id: number;
  numero_fila: number;
  valor_texto: string | null;
  activo: boolean;
}

/* ═══════════════════════════ Catálogos reutilizables (lectura) ═══════════════════════════ */

export async function listarCatalogos(): Promise<CatalogoRow[]> {
  const { rows } = await pool.query<CatalogoRow>(
    `SELECT id, nombre, activo FROM public.catalogo
     WHERE activo = true ORDER BY nombre ASC`,
  );
  return rows;
}

export async function listarValoresDeCatalogo(
  catalogoId: number,
): Promise<CatalogoValorRow[]> {
  const { rows } = await pool.query<CatalogoValorRow>(
    `SELECT id, catalogo_id, etiqueta, orden, activo
     FROM public.catalogo_valor
     WHERE catalogo_id = $1 AND activo = true
     ORDER BY orden ASC`,
    [catalogoId],
  );
  return rows;
}

export async function listarTiposDatoCampo(): Promise<TipoDatoCampoRow[]> {
  const { rows } = await pool.query<TipoDatoCampoRow>(
    `SELECT id, nombre FROM public.tipo_dato_campo_formulario
     WHERE activo = true ORDER BY id ASC`,
  );
  return rows;
}

/* ═══════════════════════════ Formularios (lectura) ═══════════════════════════ */

export async function listarFormularios(): Promise<FormularioRow[]> {
  const { rows } = await pool.query<FormularioRow>(
    `SELECT id, nombre, descripcion, activo FROM public.formulario
     WHERE activo = true ORDER BY nombre ASC`,
  );
  return rows;
}

export async function buscarFormularioPorId(
  id: number,
): Promise<FormularioRow | null> {
  const { rows } = await pool.query<FormularioRow>(
    `SELECT id, nombre, descripcion, activo FROM public.formulario WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Un formulario con sus campos, listo para el frontend: cada campo ya trae
 * el nombre de su tipo de dato resuelto (no solo el id), para que el
 * cliente sepa qué control renderizar sin una consulta aparte.
 */
export async function buscarFormularioConCampos(
  id: number,
): Promise<FormularioConCampos | null> {
  const formulario = await buscarFormularioPorId(id);
  if (!formulario) return null;

  const { rows: campos } = await pool.query<FormularioCampoRow>(
    `SELECT fc.id, fc.formulario_id, fc.etiqueta, fc.tipo_dato_id,
            tdc.nombre AS tipo_dato_nombre, fc.catalogo_id, fc.obligatorio,
            fc.orden, fc.grupo_repetible, fc.ayuda, fc.activo
     FROM public.formulario_campo fc
     JOIN public.tipo_dato_campo_formulario tdc ON tdc.id = fc.tipo_dato_id
     WHERE fc.formulario_id = $1 AND fc.activo = true
     ORDER BY fc.orden ASC`,
    [id],
  );

  return { ...formulario, campos };
}

export async function listarOpcionesDeCampo(
  formularioCampoId: number,
): Promise<FormularioCampoOpcionRow[]> {
  const { rows } = await pool.query<FormularioCampoOpcionRow>(
    `SELECT id, formulario_campo_id, etiqueta, orden, activo
     FROM public.formulario_campo_opcion
     WHERE formulario_campo_id = $1 AND activo = true
     ORDER BY orden ASC`,
    [formularioCampoId],
  );
  return rows;
}

/**
 * Formularios que exige la categoría de un insumo. Es lo que consulta el
 * flujo de solicitudes para saber si una línea nueva necesita formularios
 * antes de poder aprobarse.
 */
export async function listarFormulariosDeCategoria(
  categoriaInsumoId: number,
): Promise<FormularioRow[]> {
  const { rows } = await pool.query<FormularioRow>(
    `SELECT f.id, f.nombre, f.descripcion, f.activo
     FROM public.categoria_insumo_formulario cif
     JOIN public.formulario f ON f.id = cif.formulario_id
     WHERE cif.categoria_insumo_id = $1 AND cif.activo = true AND f.activo = true
     ORDER BY cif.orden ASC`,
    [categoriaInsumoId],
  );
  return rows;
}

/** Igual que arriba, pero resuelta a partir del insumo (categoria_id vive en insumo). */
export async function listarFormulariosDeInsumo(
  insumoId: number,
): Promise<FormularioRow[]> {
  const { rows } = await pool.query<FormularioRow>(
    `SELECT f.id, f.nombre, f.descripcion, f.activo
     FROM public.insumo i
     JOIN public.categoria_insumo_formulario cif ON cif.categoria_insumo_id = i.categoria_id
     JOIN public.formulario f ON f.id = cif.formulario_id
     WHERE i.id = $1 AND cif.activo = true AND f.activo = true
     ORDER BY cif.orden ASC`,
    [insumoId],
  );
  return rows;
}

/* ═══════════════════════════ Formularios (administración — DIRECCION) ═══════════════════════════ */

export async function crearFormulario(
  usuarioId: number,
  datos: { nombre: string; descripcion?: string | null },
): Promise<FormularioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const { rows } = await client.query<FormularioRow>(
      `INSERT INTO public.formulario (nombre, descripcion, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, descripcion, activo`,
      [datos.nombre, datos.descripcion ?? null, usuarioId],
    );
    return rows[0];
  });
}

export async function editarFormulario(
  usuarioId: number,
  id: number,
  datos: { nombre?: string; descripcion?: string | null; activo?: boolean },
): Promise<FormularioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const { rows } = await client.query<FormularioRow>(
      `UPDATE public.formulario SET
         nombre = COALESCE($1, nombre),
         descripcion = COALESCE($2, descripcion),
         activo = COALESCE($3, activo),
         updated_by = $4
       WHERE id = $5
       RETURNING id, nombre, descripcion, activo`,
      [
        datos.nombre ?? null,
        datos.descripcion ?? null,
        datos.activo ?? null,
        usuarioId,
        id,
      ],
    );
    return rows[0];
  });
}

/**
 * Agrega un campo a un formulario. catalogo_id y con_opciones_propias son
 * mutuamente excluyentes (lo exige fn_validar_catalogo_campo_formulario /
 * fn_validar_opciones_campo_formulario en la base); este repository no
 * duplica esa validación, deja que el trigger la haga cumplir.
 */
export async function agregarCampoFormulario(
  usuarioId: number,
  datos: {
    formularioId: number;
    etiqueta: string;
    tipoDatoId: number;
    catalogoId?: number | null;
    obligatorio: boolean;
    orden: number;
    grupoRepetible?: string | null;
    ayuda?: string | null;
  },
): Promise<FormularioCampoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.formulario_campo
         (formulario_id, etiqueta, tipo_dato_id, catalogo_id, obligatorio,
          orden, grupo_repetible, ayuda, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        datos.formularioId,
        datos.etiqueta,
        datos.tipoDatoId,
        datos.catalogoId ?? null,
        datos.obligatorio,
        datos.orden,
        datos.grupoRepetible ?? null,
        datos.ayuda ?? null,
        usuarioId,
      ],
    );

    const { rows: campo } = await client.query<FormularioCampoRow>(
      `SELECT fc.id, fc.formulario_id, fc.etiqueta, fc.tipo_dato_id,
              tdc.nombre AS tipo_dato_nombre, fc.catalogo_id, fc.obligatorio,
              fc.orden, fc.grupo_repetible, fc.ayuda, fc.activo
       FROM public.formulario_campo fc
       JOIN public.tipo_dato_campo_formulario tdc ON tdc.id = fc.tipo_dato_id
       WHERE fc.id = $1`,
      [rows[0].id],
    );
    return campo[0];
  });
}

export async function editarCampoFormulario(
  usuarioId: number,
  id: number,
  datos: {
    etiqueta?: string;
    obligatorio?: boolean;
    orden?: number;
    ayuda?: string | null;
    activo?: boolean;
  },
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.formulario_campo SET
         etiqueta = COALESCE($1, etiqueta),
         obligatorio = COALESCE($2, obligatorio),
         orden = COALESCE($3, orden),
         ayuda = COALESCE($4, ayuda),
         activo = COALESCE($5, activo),
         updated_by = $6
       WHERE id = $7`,
      [
        datos.etiqueta ?? null,
        datos.obligatorio ?? null,
        datos.orden ?? null,
        datos.ayuda ?? null,
        datos.activo ?? null,
        usuarioId,
        id,
      ],
    );
  });
}

export async function agregarOpcionCampo(
  usuarioId: number,
  datos: { formularioCampoId: number; etiqueta: string; orden: number },
): Promise<FormularioCampoOpcionRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const { rows } = await client.query<FormularioCampoOpcionRow>(
      `INSERT INTO public.formulario_campo_opcion
         (formulario_campo_id, etiqueta, orden, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, formulario_campo_id, etiqueta, orden, activo`,
      [datos.formularioCampoId, datos.etiqueta, datos.orden, usuarioId],
    );
    return rows[0];
  });
}

export async function asignarFormularioACategoria(
  usuarioId: number,
  datos: { categoriaInsumoId: number; formularioId: number; orden?: number },
): Promise<CategoriaInsumoFormularioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const { rows } = await client.query<CategoriaInsumoFormularioRow>(
      `INSERT INTO public.categoria_insumo_formulario
         (categoria_insumo_id, formulario_id, orden, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (categoria_insumo_id, formulario_id)
       DO UPDATE SET activo = true, orden = EXCLUDED.orden, updated_by = $4
       RETURNING id, categoria_insumo_id, formulario_id, orden, activo`,
      [
        datos.categoriaInsumoId,
        datos.formularioId,
        datos.orden ?? 0,
        usuarioId,
      ],
    );
    return rows[0];
  });
}

export async function quitarFormularioDeCategoria(
  usuarioId: number,
  categoriaInsumoId: number,
  formularioId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.categoria_insumo_formulario
       SET activo = false, updated_by = $1
       WHERE categoria_insumo_id = $2 AND formulario_id = $3`,
      [usuarioId, categoriaInsumoId, formularioId],
    );
  });
}

/* ═══════════════════════════ Respuestas de una línea de solicitud ═══════════════════════════ */

/**
 * Los formularios que le corresponden a una línea, con su estado de avance
 * (completado o no) si ya se instanció detalle_solicitud_formulario para
 * ella, o null si todavía no se ha empezado a llenar.
 */
export interface FormularioDeLineaRow extends FormularioRow {
  detalle_solicitud_formulario_id: number | null;
  completado: boolean | null;
}

export async function listarFormulariosDeLinea(
  detalleSolicitudId: number,
): Promise<FormularioDeLineaRow[]> {
  const { rows } = await pool.query<FormularioDeLineaRow>(
    `SELECT f.id, f.nombre, f.descripcion, f.activo,
            dsf.id AS detalle_solicitud_formulario_id, dsf.completado
     FROM public.detalle_solicitud_apoyo dsa
     JOIN public.insumo i ON i.id = dsa.insumo_id
     JOIN public.categoria_insumo_formulario cif
       ON cif.categoria_insumo_id = i.categoria_id AND cif.activo = true
     JOIN public.formulario f ON f.id = cif.formulario_id AND f.activo = true
     LEFT JOIN public.detalle_solicitud_formulario dsf
       ON dsf.formulario_id = f.id
      AND dsf.detalle_solicitud_id = dsa.id
      AND dsf.activo = true
     WHERE dsa.id = $1
     ORDER BY cif.orden ASC`,
    [detalleSolicitudId],
  );
  return rows;
}

/**
 * true si la línea tiene al menos un formulario exigido por su categoría
 * que todavía no está completo (o ni siquiera se ha empezado). Es lo que
 * bloquea la aprobación de la solicitud (RF-PRO, ver solicitud.controller).
 */
export async function tieneFormulariosPendientes(
  detalleSolicitudId: number,
): Promise<boolean> {
  const formularios = await listarFormulariosDeLinea(detalleSolicitudId);
  return formularios.some((f) => f.completado !== true);
}

export async function buscarDetalleFormulario(
  detalleSolicitudId: number,
  formularioId: number,
): Promise<DetalleSolicitudFormularioRow | null> {
  const { rows } = await pool.query<DetalleSolicitudFormularioRow>(
    `SELECT id, detalle_solicitud_id, formulario_id, completado, activo
     FROM public.detalle_solicitud_formulario
     WHERE detalle_solicitud_id = $1 AND formulario_id = $2 AND activo = true`,
    [detalleSolicitudId, formularioId],
  );
  return rows[0] ?? null;
}

export async function listarRespuestas(
  detalleSolicitudFormularioId: number,
): Promise<RespuestaRow[]> {
  const { rows } = await pool.query<RespuestaRow>(
    `SELECT id, detalle_solicitud_formulario_id, formulario_campo_id,
            numero_fila, valor_texto, activo
     FROM public.detalle_solicitud_formulario_respuesta
     WHERE detalle_solicitud_formulario_id = $1 AND activo = true
     ORDER BY formulario_campo_id ASC, numero_fila ASC`,
    [detalleSolicitudFormularioId],
  );
  return rows;
}

/**
 * Guarda (crea o sustituye) todas las respuestas de un formulario para una
 * línea, en una sola transacción: crea detalle_solicitud_formulario si no
 * existe, borra las respuestas previas de esos campos y escribe las nuevas.
 * Sustituir en vez de UPDATE campo por campo es más simple y evita dejar
 * respuestas huérfanas de una fila de grupo_repetible que el usuario quitó.
 */
export async function guardarRespuestasFormulario(
  usuarioId: number,
  datos: {
    detalleSolicitudId: number;
    formularioId: number;
    completado: boolean;
    respuestas: Array<{
      formularioCampoId: number;
      numeroFila: number;
      valorTexto: string | null;
    }>;
  },
): Promise<DetalleSolicitudFormularioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const { rows: existente } = await client.query<{ id: number }>(
      `SELECT id FROM public.detalle_solicitud_formulario
       WHERE detalle_solicitud_id = $1 AND formulario_id = $2`,
      [datos.detalleSolicitudId, datos.formularioId],
    );

    let detalleFormularioId: number;
    if (existente.length > 0) {
      detalleFormularioId = existente[0].id;
      await client.query(
        `UPDATE public.detalle_solicitud_formulario
         SET completado = $1, activo = true, updated_by = $2
         WHERE id = $3`,
        [datos.completado, usuarioId, detalleFormularioId],
      );
      await client.query(
        `UPDATE public.detalle_solicitud_formulario_respuesta
         SET activo = false, updated_by = $1
         WHERE detalle_solicitud_formulario_id = $2`,
        [usuarioId, detalleFormularioId],
      );
    } else {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO public.detalle_solicitud_formulario
           (detalle_solicitud_id, formulario_id, completado, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          datos.detalleSolicitudId,
          datos.formularioId,
          datos.completado,
          usuarioId,
        ],
      );
      detalleFormularioId = rows[0].id;
    }

    for (const r of datos.respuestas) {
      await client.query(
        `INSERT INTO public.detalle_solicitud_formulario_respuesta
           (detalle_solicitud_formulario_id, formulario_campo_id, numero_fila,
            valor_texto, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (detalle_solicitud_formulario_id, formulario_campo_id, numero_fila)
         DO UPDATE SET valor_texto = EXCLUDED.valor_texto, activo = true, updated_by = $5`,
        [
          detalleFormularioId,
          r.formularioCampoId,
          r.numeroFila,
          r.valorTexto,
          usuarioId,
        ],
      );
    }

    const { rows: resultado } =
      await client.query<DetalleSolicitudFormularioRow>(
        `SELECT id, detalle_solicitud_id, formulario_id, completado, activo
       FROM public.detalle_solicitud_formulario WHERE id = $1`,
        [detalleFormularioId],
      );
    return resultado[0];
  });
}
