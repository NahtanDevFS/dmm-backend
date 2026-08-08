import type { Request, Response, NextFunction } from "express";
import { paginar } from "../../lib/paginacion.js";
import { pool } from "../../db/pool.js";
import {
  crearPersonaSchema,
  editarPersonaSchema,
  listarPersonasQuerySchema,
  agregarDiscapacidadSchema,
  vincularEncargadoSchema,
  agregarContactoSchema,
  editarContactoSchema,
} from "./persona.schema.js";
import {
  listarPersonas,
  buscarPersonaPorId,
  existeCuiDpiDuplicado,
  existeComunidadActiva,
  esMenorDeEdad,
  crearPersonaConRelaciones,
  editarPersona,
  cambiarEstadoPersona,
  listarDiscapacidadesDePersona,
  agregarDiscapacidadAPersona,
  quitarDiscapacidadDePersona,
  listarEncargadosDePersona,
  vincularEncargadoAPersonaExistente,
  desvincularEncargado,
  listarContactosDePersona,
  buscarContactoPorId,
  agregarContacto,
  editarContacto,
  eliminarContacto,
} from "./persona.repository.js";
import {
  existeTipoGeneroActivo,
  existeTipoParentescoActivo,
} from "../catalogos-lectura/catalogos-lectura.repository.js";

const FIRMA_ERROR_MENOR_SIN_ENCARGADO = "debe vincularse a un encargado";

function esErrorMenorSinEncargado(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(FIRMA_ERROR_MENOR_SIN_ENCARGADO)
  );
}

async function validarGeneroYComunidad(datos: {
  genero_id?: number | null;
  comunidad_id?: number | null;
}): Promise<string | null> {
  if (
    datos.genero_id !== undefined &&
    datos.genero_id !== null &&
    !(await existeTipoGeneroActivo(datos.genero_id))
  ) {
    return "El género indicado no existe o no está activo";
  }
  if (
    datos.comunidad_id !== undefined &&
    datos.comunidad_id !== null &&
    !(await existeComunidadActiva(datos.comunidad_id))
  ) {
    return "La comunidad indicada no existe o no está activa";
  }
  return null;
}

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsedQuery = listarPersonasQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsedQuery.error.flatten().fieldErrors,
      });
    }

    const { total, filas } = await listarPersonas(pool, {
      busqueda: parsedQuery.data.busqueda,
      comunidadId: parsedQuery.data.comunidadId,
      incluirInactivos: parsedQuery.data.incluirInactivos,
      limite: parsedQuery.data.limite,
      desplazamiento: parsedQuery.data.desplazamiento,
    });
    return res.status(200).json(paginar(filas, total, parsedQuery.data));
  } catch (error) {
    return next(error);
  }
}

export async function obtenerController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const persona = await buscarPersonaPorId(id);
    if (!persona) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    const [discapacidades, encargados, contactos] = await Promise.all([
      listarDiscapacidadesDePersona(id),
      listarEncargadosDePersona(id),
      listarContactosDePersona(id),
    ]);

    return res
      .status(200)
      .json({ ...persona, discapacidades, encargados, contactos });
  } catch (error) {
    return next(error);
  }
}

export async function crearController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearPersonaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const { discapacidadIds, encargados, contactos, ...datos } = parsed.data;

    if (datos.cui_dpi && (await existeCuiDpiDuplicado(datos.cui_dpi))) {
      return res.status(409).json({
        message: `Ya existe una persona registrada con el CUI/DPI "${datos.cui_dpi}"`,
      });
    }

    const errorCatalogo = await validarGeneroYComunidad(datos);
    if (errorCatalogo) {
      return res.status(400).json({ message: errorCatalogo });
    }

    // Validar tipoParentescoId de cada encargado antes de tocar la BD
    for (const encargado of encargados ?? []) {
      if (!(await existeTipoParentescoActivo(encargado.tipoParentescoId))) {
        return res.status(400).json({
          message: "El tipo de parentesco indicado no existe o no está activo",
        });
      }
    }

    if (
      esMenorDeEdad(datos.fecha_nacimiento) &&
      !datos.cui_dpi &&
      (!encargados || encargados.length === 0)
    ) {
      return res.status(400).json({
        message:
          "La persona es menor de edad y no tiene CUI/DPI: debe indicar al menos un encargado.",
      });
    }

    const nueva = await crearPersonaConRelaciones(
      req.usuario!.id,
      datos,
      discapacidadIds ?? [],
      encargados ?? [],
      contactos ?? [],
    );
    return res.status(201).json(nueva);
  } catch (error) {
    if (esErrorMenorSinEncargado(error)) {
      return res.status(400).json({
        message:
          "La persona es menor de edad y no tiene CUI/DPI: debe indicar al menos un encargado válido.",
      });
    }
    return next(error);
  }
}

export async function editarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = editarPersonaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const existente = await buscarPersonaPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    if (
      parsed.data.cui_dpi &&
      (await existeCuiDpiDuplicado(parsed.data.cui_dpi, id))
    ) {
      return res.status(409).json({
        message: `Ya existe una persona registrada con el CUI/DPI "${parsed.data.cui_dpi}"`,
      });
    }

    const errorCatalogo = await validarGeneroYComunidad(parsed.data);
    if (errorCatalogo) {
      return res.status(400).json({ message: errorCatalogo });
    }

    const actualizada = await editarPersona(req.usuario!.id, id, parsed.data);
    return res.status(200).json(actualizada);
  } catch (error) {
    if (esErrorMenorSinEncargado(error)) {
      return res.status(400).json({
        message:
          "Este cambio dejaría a la persona como menor de edad sin CUI/DPI y sin encargado vinculado. Agregue un encargado antes de guardar este cambio.",
      });
    }
    return next(error);
  }
}

export async function desactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const existente = await buscarPersonaPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    if (!existente.activo) {
      return res.status(200).json(existente); // idempotente
    }

    const actualizada = await cambiarEstadoPersona(req.usuario!.id, id, false);
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function reactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const existente = await buscarPersonaPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    const actualizada = await cambiarEstadoPersona(req.usuario!.id, id, true);
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function agregarDiscapacidadController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = agregarDiscapacidadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const persona = await buscarPersonaPorId(id);
    if (!persona) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    await agregarDiscapacidadAPersona(
      req.usuario!.id,
      id,
      parsed.data.discapacidadId,
    );
    const discapacidades = await listarDiscapacidadesDePersona(id);
    return res.status(200).json(discapacidades);
  } catch (error) {
    return next(error);
  }
}

export async function quitarDiscapacidadController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    const discapacidadId = Number(req.params.discapacidadId);
    if (!Number.isInteger(id) || !Number.isInteger(discapacidadId)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const persona = await buscarPersonaPorId(id);
    if (!persona) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    await quitarDiscapacidadDePersona(req.usuario!.id, id, discapacidadId);
    const discapacidades = await listarDiscapacidadesDePersona(id);
    return res.status(200).json(discapacidades);
  } catch (error) {
    return next(error);
  }
}

export async function vincularEncargadoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = vincularEncargadoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existeTipoParentescoActivo(parsed.data.tipoParentescoId))) {
      return res.status(400).json({
        message: "El tipo de parentesco indicado no existe o no está activo",
      });
    }

    const persona = await buscarPersonaPorId(id);
    if (!persona) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    await vincularEncargadoAPersonaExistente(req.usuario!.id, id, parsed.data);
    const encargados = await listarEncargadosDePersona(id);
    return res.status(200).json(encargados);
  } catch (error) {
    return next(error);
  }
}

export async function desvincularEncargadoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    const encargadoId = Number(req.params.encargadoId);
    if (!Number.isInteger(id) || !Number.isInteger(encargadoId)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const persona = await buscarPersonaPorId(id);
    if (!persona) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    await desvincularEncargado(req.usuario!.id, id, encargadoId);
    const encargados = await listarEncargadosDePersona(id);
    return res.status(200).json(encargados);
  } catch (error) {
    if (esErrorMenorSinEncargado(error)) {
      return res.status(400).json({
        message:
          "No se puede quitar este encargado: la persona es menor de edad, no tiene CUI/DPI, y quedaría sin ningún encargado vinculado.",
      });
    }
    return next(error);
  }
}

export async function agregarContactoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = agregarContactoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const persona = await buscarPersonaPorId(id);
    if (!persona) {
      return res.status(404).json({ message: "Persona no encontrada" });
    }

    await agregarContacto(req.usuario!.id, id, parsed.data);
    const contactos = await listarContactosDePersona(id);
    return res.status(201).json(contactos);
  } catch (error) {
    return next(error);
  }
}

export async function editarContactoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    const contactoId = Number(req.params.contactoId);
    if (!Number.isInteger(id) || !Number.isInteger(contactoId)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = editarContactoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const contacto = await buscarContactoPorId(contactoId);
    if (!contacto || contacto.persona_id !== id) {
      return res.status(404).json({ message: "Contacto no encontrado" });
    }

    const actualizado = await editarContacto(
      req.usuario!.id,
      contactoId,
      parsed.data,
    );
    return res.status(200).json(actualizado);
  } catch (error) {
    return next(error);
  }
}

export async function eliminarContactoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    const contactoId = Number(req.params.contactoId);
    if (!Number.isInteger(id) || !Number.isInteger(contactoId)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const contacto = await buscarContactoPorId(contactoId);
    if (!contacto || contacto.persona_id !== id) {
      return res.status(404).json({ message: "Contacto no encontrado" });
    }

    await eliminarContacto(req.usuario!.id, contactoId);
    const contactos = await listarContactosDePersona(id);
    return res.status(200).json(contactos);
  } catch (error) {
    return next(error);
  }
}
