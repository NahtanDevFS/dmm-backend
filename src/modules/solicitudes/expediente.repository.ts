import { pool } from "../../db/pool.js";

/**
 * Todo lo que hay que saber de una solicitud para imprimirla como expediente.
 *
 * Se arma con consultas planas y no reutilizando los repositorios de cada
 * módulo porque aquí hace falta el dato ya resuelto —el nombre del municipio,
 * no su id— y porque el PDF necesita los formularios con sus campos Y sus
 * respuestas juntos, que ningún endpoint devuelve así.
 */

export interface CabeceraExpediente {
  solicitud_id: number;
  fecha_solicitud: Date;
  programa: string;
  estado: string;
  requiere_aprobacion: boolean;
  aprobada: boolean;
  fecha_aprobacion: Date | null;
  aprobado_por: string | null;
  observaciones_trabajo_social: string | null;

  persona_id: number;
  nombres: string;
  apellidos: string;
  cui_dpi: string | null;
  fecha_nacimiento: Date;
  genero: string | null;
  estado_civil: string | null;
  telefono: string | null;
  direccion: string | null;
  grado_academico: string | null;
  ocupacion: string | null;
  comunidad: string | null;
  municipio: string | null;
  departamento: string | null;
  municipio_nacimiento: string | null;
  departamento_nacimiento: string | null;
}

export interface LineaExpediente {
  detalle_solicitud_id: number;
  insumo: string;
  unidad: string;
  modalidad: string;
  estado: string;
  cantidad_requerida: number;
  cantidad_entregada: number;
  presentacion: string | null;
  cantidad_presentacion: string | null;
}

/** Un campo del formulario con lo que se respondió, o sin nada. */
export interface RespuestaExpediente {
  campo_id: number;
  etiqueta: string;
  grupo_repetible: string | null;
  orden: number;
  numero_fila: number | null;
  valor: string | null;
}

export interface FormularioExpediente {
  formulario_id: number;
  nombre: string;
  descripcion: string | null;
  completado: boolean;
  respuestas: RespuestaExpediente[];
}

export interface DocumentoExpediente {
  descripcion: string | null;
  formulario: string | null;
  ruta_archivo: string;
}

export interface EntregaExpediente {
  fecha_entrega: Date;
  insumo: string;
  /** Serie de la unidad entregada, en equipo identificable. */
  numero_serie: string | null;
  cantidad_entregada: number;
  entregado_por: string;
  receptor: string | null;
  activo: boolean;
}

export async function cabeceraExpediente(
  solicitudId: number,
): Promise<CabeceraExpediente | null> {
  const { rows } = await pool.query<CabeceraExpediente>(
    `SELECT sa.id AS solicitud_id, sa.fecha_solicitud, pr.nombre AS programa,
            es.nombre AS estado, sa.requiere_aprobacion, sa.aprobada,
            sa.fecha_aprobacion, ua.username AS aprobado_por,
            sa.observaciones_trabajo_social,

            p.id AS persona_id, p.nombres, p.apellidos, p.cui_dpi,
            p.fecha_nacimiento, tg.nombre AS genero, ec.nombre AS estado_civil,
            p.telefono, p.direccion,
            ga.nombre AS grado_academico, o.nombre AS ocupacion,
            c.nombre AS comunidad, m.nombre AS municipio,
            d.nombre AS departamento,
            mn.nombre AS municipio_nacimiento,
            dn.nombre AS departamento_nacimiento
     FROM public.solicitud_apoyo sa
     JOIN public.persona p ON p.id = sa.persona_id
     JOIN public.programa pr ON pr.id = sa.programa_id
     JOIN public.estado_solicitud_apoyo es ON es.id = sa.estado_id
     LEFT JOIN public.usuario ua ON ua.id = sa.aprobado_por
     LEFT JOIN public.tipo_genero tg ON tg.id = p.genero_id
     LEFT JOIN public.estado_civil ec ON ec.id = p.estado_civil_id
     LEFT JOIN public.grado_academico ga ON ga.id = p.grado_academico_id
     LEFT JOIN public.ocupacion o ON o.id = p.ocupacion_id
     LEFT JOIN public.comunidad c ON c.id = p.comunidad_id
     LEFT JOIN public.municipio m ON m.id = c.municipio_id
     LEFT JOIN public.departamento d ON d.id = m.departamento_id
     LEFT JOIN public.municipio mn ON mn.id = p.municipio_nacimiento_id
     LEFT JOIN public.departamento dn ON dn.id = mn.departamento_id
     WHERE sa.id = $1`,
    [solicitudId],
  );
  return rows[0] ?? null;
}

export async function lineasExpediente(
  solicitudId: number,
): Promise<LineaExpediente[]> {
  const { rows } = await pool.query<LineaExpediente>(
    `SELECT dsa.id AS detalle_solicitud_id, i.nombre AS insumo,
            um.nombre AS unidad, ms.nombre AS modalidad, es.nombre AS estado,
            dsa.cantidad_requerida, dsa.cantidad_entregada,
            up.nombre AS presentacion, dsa.cantidad_presentacion
     FROM public.detalle_solicitud_apoyo dsa
     JOIN public.insumo i ON i.id = dsa.insumo_id
     JOIN public.unidad_medida um ON um.id = i.unidad_medida_base_id
     JOIN public.modalidad_solicitud ms ON ms.id = dsa.modalidad_solicitud_id
     JOIN public.estado_solicitud_apoyo es ON es.id = dsa.estado_id
     LEFT JOIN public.presentacion_insumo pi ON pi.id = dsa.presentacion_solicitud_id
     LEFT JOIN public.unidad_medida up ON up.id = pi.unidad_medida_id
     WHERE dsa.solicitud_id = $1
     ORDER BY dsa.id`,
    [solicitudId],
  );
  return rows;
}

/**
 * Formularios exigidos por una línea, con TODOS sus campos y las respuestas
 * que haya.
 *
 * El LEFT JOIN sobre las respuestas es deliberado: un campo sin contestar
 * aparece igual, con valor nulo. Un expediente que omite lo que quedó vacío
 * disimula sus huecos, y lo que interesa al revisarlo es justamente verlos.
 */
export async function formulariosExpediente(
  detalleSolicitudId: number,
): Promise<FormularioExpediente[]> {
  const { rows } = await pool.query<{
    formulario_id: number;
    nombre: string;
    descripcion: string | null;
    completado: boolean;
    campo_id: number;
    etiqueta: string;
    grupo_repetible: string | null;
    orden: number;
    numero_fila: number | null;
    valor: string | null;
  }>(
    `SELECT ve.formulario_id, ve.formulario_nombre AS nombre,
            ve.formulario_descripcion AS descripcion, ve.completado,
            fc.id AS campo_id, fc.etiqueta, fc.grupo_repetible, fc.orden,
            r.numero_fila, r.valor_texto AS valor
     FROM public.v_formularios_exigidos_linea ve
     JOIN public.formulario_campo fc
       ON fc.formulario_id = ve.formulario_id AND fc.activo = true
     LEFT JOIN public.detalle_solicitud_formulario_respuesta r
       ON r.detalle_solicitud_formulario_id = ve.detalle_solicitud_formulario_id
      AND r.formulario_campo_id = fc.id
      AND r.activo = true
     WHERE ve.detalle_solicitud_id = $1
     ORDER BY ve.orden, fc.orden, r.numero_fila`,
    [detalleSolicitudId],
  );

  const porFormulario = new Map<number, FormularioExpediente>();
  for (const fila of rows) {
    let formulario = porFormulario.get(fila.formulario_id);
    if (!formulario) {
      formulario = {
        formulario_id: fila.formulario_id,
        nombre: fila.nombre,
        descripcion: fila.descripcion,
        completado: fila.completado,
        respuestas: [],
      };
      porFormulario.set(fila.formulario_id, formulario);
    }
    formulario.respuestas.push({
      campo_id: fila.campo_id,
      etiqueta: fila.etiqueta,
      grupo_repetible: fila.grupo_repetible,
      orden: fila.orden,
      numero_fila: fila.numero_fila,
      valor: fila.valor,
    });
  }

  return [...porFormulario.values()];
}

export async function documentosExpediente(
  solicitudId: number,
): Promise<DocumentoExpediente[]> {
  const { rows } = await pool.query<DocumentoExpediente>(
    `SELECT ds.descripcion, f.nombre AS formulario, ds.ruta_archivo
     FROM public.documento_solicitud ds
     LEFT JOIN public.formulario f ON f.id = ds.formulario_id
     WHERE ds.solicitud_id = $1 AND ds.activo = true
     ORDER BY ds.id`,
    [solicitudId],
  );
  return rows;
}

export async function entregasExpediente(
  solicitudId: number,
): Promise<EntregaExpediente[]> {
  const { rows } = await pool.query<EntregaExpediente>(
    `SELECT e.fecha_entrega, i.nombre AS insumo, de.cantidad_entregada,
            (SELECT dl.codigo_lote_fabricante
             FROM public.detalle_entrega_lote del
             JOIN public.detalle_inventario_lote dl
               ON dl.id = del.detalle_inventario_lote_id
             WHERE del.detalle_entrega_id = de.id
             ORDER BY del.id LIMIT 1) AS numero_serie,
            u.username AS entregado_por,
            CASE WHEN pr.id IS NULL THEN NULL
                 ELSE pr.nombres || ' ' || pr.apellidos END AS receptor,
            (de.activo AND e.activo) AS activo
     FROM public.detalle_entrega de
     JOIN public.entrega e ON e.id = de.entrega_id
     JOIN public.insumo i ON i.id = de.insumo_id
     JOIN public.usuario u ON u.id = e.usuario_entrega_id
     JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = de.detalle_solicitud_id
     LEFT JOIN public.persona pr ON pr.id = e.persona_receptor_id
     WHERE dsa.solicitud_id = $1
     ORDER BY e.fecha_entrega, de.id`,
    [solicitudId],
  );
  return rows;
}
