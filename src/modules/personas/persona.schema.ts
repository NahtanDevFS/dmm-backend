import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

const nombresSchema = z
  .string()
  .trim()
  .min(1, "El nombre es requerido")
  .max(100);
const apellidosSchema = z
  .string()
  .trim()
  .min(1, "El apellido es requerido")
  .max(100);

const fechaNacimientoSchema = z
  .string()
  .refine(
    (val) => !Number.isNaN(Date.parse(val)),
    "Fecha de nacimiento inválida",
  )
  .refine((val) => {
    const fecha = new Date(val);
    const hoy = new Date();
    return fecha <= hoy;
  }, "La fecha de nacimiento no puede ser futura")
  .refine((val) => {
    const fecha = new Date(val);
    const limite = new Date();
    limite.setFullYear(limite.getFullYear() - 120);
    return fecha > limite;
  }, "La fecha de nacimiento no es válida (más de 120 años)");

const cuiDpiSchema = z
  .string()
  .trim()
  .max(13, "El CUI/DPI no puede exceder 13 caracteres")
  .nullable()
  .optional();

const datosBasePersonaSchema = z.object({
  cui_dpi: cuiDpiSchema,
  nombres: nombresSchema,
  apellidos: apellidosSchema,
  fecha_nacimiento: fechaNacimientoSchema,
  genero_id: z.number().int().positive().nullable().optional(),
  comunidad_id: z.number().int().positive().nullable().optional(),
  telefono: z.string().trim().max(20).nullable().optional(),
});

const encargadoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("existente"),
    personaId: z.number().int().positive(),
    tipoParentescoId: z.number().int().positive(),
  }),
  z.object({
    tipo: z.literal("nuevo"),
    tipoParentescoId: z.number().int().positive(),
  }),
]);

const contactoReferenciaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre del contacto es requerido")
    .max(150),
  telefono: z.string().trim().max(20).nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
});

export const crearPersonaSchema = datosBasePersonaSchema.extend({
  discapacidadIds: z.array(z.number().int().positive()).optional(),
  encargados: z.array(encargadoSchema).optional(),
  contactos: z.array(contactoReferenciaSchema).optional(),
});

export const editarPersonaSchema = datosBasePersonaSchema.partial();

export const listarPersonasQuerySchema = z.object({
  busqueda: z.string().trim().min(1).optional(),
  comunidadId: z.coerce.number().int().positive().optional(),
  incluirInactivos: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ...paginacionShape,
});

export const agregarDiscapacidadSchema = z.object({
  discapacidadId: z.number().int().positive(),
});

export const vincularEncargadoSchema = encargadoSchema;

export const agregarContactoSchema = contactoReferenciaSchema;
export const editarContactoSchema = contactoReferenciaSchema.partial();
