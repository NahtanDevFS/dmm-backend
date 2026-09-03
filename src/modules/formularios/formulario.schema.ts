import { z } from "zod";

/* ═══════════════════════════ Administración de formularios ═══════════════════════════ */

export const crearFormularioSchema = z.object({
  nombre: z
    .string({ error: "El nombre del formulario es requerido" })
    .trim()
    .min(1, "El nombre del formulario es requerido")
    .max(150),
  descripcion: z.string().trim().max(2000).nullable().optional(),
});

export const editarFormularioSchema = z.object({
  nombre: z.string().trim().min(1).max(150).optional(),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  activo: z.boolean().optional(),
});

/**
 * Un campo usa exactamente un mecanismo de opciones: catalogo_id (catálogo
 * reutilizable) u opciones_propias (lista de etiquetas propia de este
 * campo). El refine replica en el borde lo que los triggers de la base ya
 * exigen, para devolver un 400 claro antes de tocarla en vez de dejar que
 * la base rechace con un mensaje pensado para otro contexto.
 */
export const agregarCampoFormularioSchema = z
  .object({
    etiqueta: z
      .string({ error: "La etiqueta del campo es requerida" })
      .trim()
      .min(1, "La etiqueta del campo es requerida")
      .max(200),
    tipo_dato_id: z
      .number({ error: "tipo_dato_id es requerido" })
      .int()
      .positive(),
    catalogo_id: z.number().int().positive().nullable().optional(),
    // Solo se usa cuando catalogo_id es null: las opciones propias de este campo.
    opciones_propias: z.array(z.string().trim().min(1).max(150)).optional(),
    obligatorio: z.boolean().default(false),
    orden: z.number().int().nonnegative(),
    grupo_repetible: z.string().trim().max(100).nullable().optional(),
    ayuda: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (d) =>
      !(
        d.catalogo_id != null &&
        d.opciones_propias &&
        d.opciones_propias.length > 0
      ),
    {
      message:
        "Un campo no puede tener catalogo_id y opciones_propias a la vez: elija un solo mecanismo de opciones",
      path: ["catalogo_id"],
    },
  );

export const editarCampoFormularioSchema = z.object({
  etiqueta: z.string().trim().min(1).max(200).optional(),
  obligatorio: z.boolean().optional(),
  orden: z.number().int().nonnegative().optional(),
  ayuda: z.string().trim().max(2000).nullable().optional(),
  activo: z.boolean().optional(),
});

export const asignarFormularioCategoriaSchema = z.object({
  categoria_insumo_id: z.number().int().positive(),
  formulario_id: z.number().int().positive(),
  orden: z.number().int().min(0).optional(),
  /**
   * A qué modalidad aplica el formulario. Ausente o null significa que
   * aplica a todas, que es el comportamiento de siempre y el valor con el
   * que quedaron las asignaciones anteriores a la migración 20.
   */
  modalidad_solicitud_id: z.number().int().positive().nullable().optional(),
});

/** Filtros del listado de asignaciones para la pantalla de Catálogos. */
export const listarAsignacionesQuerySchema = z.object({
  categoriaId: z.coerce.number().int().positive().optional(),
});

/** Para anticipar los formularios de un insumo antes de crear la línea. */
export const formulariosDeInsumoQuerySchema = z.object({
  modalidadId: z.coerce.number().int().positive().optional(),
});

/* ═══════════════════════════ Respuestas de una línea de solicitud ═══════════════════════════ */

const respuestaSchema = z.object({
  formulario_campo_id: z.number().int().positive(),
  // Filas de un grupo_repetible (grupo familiar, egresos): 1 para la
  // primera repetición, 2 para la segunda, etc. Campos sueltos siempre 1.
  numero_fila: z.number().int().positive().default(1),
  valor_texto: z.string().trim().max(4000).nullable(),
});

export const guardarRespuestasSchema = z.object({
  completado: z.boolean().default(false),
  respuestas: z
    .array(respuestaSchema)
    .min(1, "Debe enviar al menos una respuesta"),
});
