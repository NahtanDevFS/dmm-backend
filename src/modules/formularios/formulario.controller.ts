import type { Request, Response, NextFunction } from "express";
import {
  crearFormularioSchema,
  editarFormularioSchema,
  agregarCampoFormularioSchema,
  editarCampoFormularioSchema,
  asignarFormularioCategoriaSchema,
  listarAsignacionesQuerySchema,
  formulariosDeInsumoQuerySchema,
  guardarRespuestasSchema,
} from "./formulario.schema.js";
import {
  listarCatalogos,
  listarValoresDeCatalogo,
  listarTiposDatoCampo,
  listarFormularios,
  buscarFormularioPorId,
  buscarFormularioConCampos,
  listarOpcionesDeCampo,
  crearFormulario,
  editarFormulario,
  agregarCampoFormulario,
  editarCampoFormulario,
  agregarOpcionCampo,
  asignarFormularioACategoria,
  listarAsignaciones,
  listarFormulariosDeInsumo,
  quitarFormularioDeCategoria,
  listarFormulariosDeLinea,
  buscarDetalleFormulario,
  listarRespuestas,
  guardarRespuestasFormulario,
} from "./formulario.repository.js";
import {
  traducirErrorPostgres,
  type ContextoError,
} from "../../lib/errores/postgres.js";

function idDesdeParam(valor: string | string[] | undefined): number | null {
  if (typeof valor !== "string") return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ═══════════════════════════ Catálogos reutilizables ═══════════════════════════ */

export async function listarCatalogosController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarCatalogos());
  } catch (error) {
    return next(error);
  }
}

export async function listarValoresCatalogoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const catalogoId = idDesdeParam(req.params.id);
    if (!catalogoId) {
      return res.status(400).json({ message: "Id de catálogo inválido" });
    }
    return res.status(200).json(await listarValoresDeCatalogo(catalogoId));
  } catch (error) {
    return next(error);
  }
}

export async function listarTiposDatoController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarTiposDatoCampo());
  } catch (error) {
    return next(error);
  }
}

/* ═══════════════════════════ Formularios: lectura ═══════════════════════════ */

export async function listarFormulariosController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarFormularios());
  } catch (error) {
    return next(error);
  }
}

export async function obtenerFormularioController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = idDesdeParam(req.params.id);
    if (!id)
      return res.status(400).json({ message: "Id de formulario inválido" });

    const formulario = await buscarFormularioConCampos(id);
    if (!formulario) {
      return res.status(404).json({ message: "El formulario no existe" });
    }
    return res.status(200).json(formulario);
  } catch (error) {
    return next(error);
  }
}

export async function listarOpcionesCampoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const campoId = idDesdeParam(req.params.campoId);
    if (!campoId)
      return res.status(400).json({ message: "Id de campo inválido" });
    return res.status(200).json(await listarOpcionesDeCampo(campoId));
  } catch (error) {
    return next(error);
  }
}

/* ═══════════════════════════ Formularios: administración (DIRECCION) ═══════════════════════════ */

export async function crearFormularioController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearFormularioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const formulario = await crearFormulario(req.usuario!.id, parsed.data);
    return res.status(201).json(formulario);
  } catch (error) {
    const contexto: ContextoError = {};
    const traducido = traducirErrorPostgres(error, contexto);
    if (traducido)
      return res.status(traducido.status).json({ message: traducido.message });
    return next(error);
  }
}

export async function editarFormularioController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = idDesdeParam(req.params.id);
    if (!id)
      return res.status(400).json({ message: "Id de formulario inválido" });

    const existente = await buscarFormularioPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "El formulario no existe" });
    }

    const parsed = editarFormularioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const formulario = await editarFormulario(req.usuario!.id, id, parsed.data);
    return res.status(200).json(formulario);
  } catch (error) {
    const traducido = traducirErrorPostgres(error);
    if (traducido)
      return res.status(traducido.status).json({ message: traducido.message });
    return next(error);
  }
}

export async function agregarCampoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const formularioId = idDesdeParam(req.params.id);
    if (!formularioId) {
      return res.status(400).json({ message: "Id de formulario inválido" });
    }
    if (!(await buscarFormularioPorId(formularioId))) {
      return res.status(404).json({ message: "El formulario no existe" });
    }

    const parsed = agregarCampoFormularioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const campo = await agregarCampoFormulario(req.usuario!.id, {
      formularioId,
      etiqueta: parsed.data.etiqueta,
      tipoDatoId: parsed.data.tipo_dato_id,
      catalogoId: parsed.data.catalogo_id ?? null,
      obligatorio: parsed.data.obligatorio,
      orden: parsed.data.orden,
      grupoRepetible: parsed.data.grupo_repetible ?? null,
      ayuda: parsed.data.ayuda ?? null,
    });

    // Opciones propias del campo, si el formulario no usa un catálogo
    // reutilizable. Se agregan una por una, en el orden recibido.
    if (
      parsed.data.catalogo_id == null &&
      parsed.data.opciones_propias?.length
    ) {
      for (let i = 0; i < parsed.data.opciones_propias.length; i++) {
        await agregarOpcionCampo(req.usuario!.id, {
          formularioCampoId: campo.id,
          etiqueta: parsed.data.opciones_propias[i],
          orden: i + 1,
        });
      }
    }

    return res.status(201).json(campo);
  } catch (error) {
    // fn_validar_catalogo_campo_formulario / fn_validar_opciones_campo_formulario
    // (P0001) llegan aquí si, pese a la validación de schema, algo se coló.
    const traducido = traducirErrorPostgres(error);
    if (traducido)
      return res.status(traducido.status).json({ message: traducido.message });
    return next(error);
  }
}

export async function editarCampoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const campoId = idDesdeParam(req.params.campoId);
    if (!campoId)
      return res.status(400).json({ message: "Id de campo inválido" });

    const parsed = editarCampoFormularioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    await editarCampoFormulario(req.usuario!.id, campoId, parsed.data);
    return res.status(200).json({ message: "Campo actualizado" });
  } catch (error) {
    const traducido = traducirErrorPostgres(error);
    if (traducido)
      return res.status(traducido.status).json({ message: traducido.message });
    return next(error);
  }
}

/**
 * Las asignaciones categoría → formulario, con su modalidad. Alimenta la
 * pantalla de Catálogos, que hasta ahora no existía: configurar un
 * formulario exigía insertar filas por SQL a mano.
 */
export async function listarAsignacionesController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarAsignacionesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    return res
      .status(200)
      .json(await listarAsignaciones(parsed.data.categoriaId));
  } catch (error) {
    return next(error);
  }
}

/**
 * Qué formularios va a exigir un insumo. Se consulta al armar la solicitud,
 * para poder avisarlo con la persona todavía presente.
 */
export async function formulariosDeInsumoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const insumoId = idDesdeParam(req.params.insumoId);
    if (!insumoId) {
      return res.status(400).json({ message: "Id de insumo inválido" });
    }
    const parsed = formulariosDeInsumoQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    return res
      .status(200)
      .json(await listarFormulariosDeInsumo(insumoId, parsed.data.modalidadId));
  } catch (error) {
    return next(error);
  }
}

export async function asignarFormularioCategoriaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = asignarFormularioCategoriaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const asignacion = await asignarFormularioACategoria(req.usuario!.id, {
      categoriaInsumoId: parsed.data.categoria_insumo_id,
      formularioId: parsed.data.formulario_id,
      orden: parsed.data.orden,
      modalidadSolicitudId: parsed.data.modalidad_solicitud_id,
    });
    return res.status(201).json(asignacion);
  } catch (error) {
    const traducido = traducirErrorPostgres(error);
    if (traducido)
      return res.status(traducido.status).json({ message: traducido.message });
    return next(error);
  }
}

export async function quitarFormularioCategoriaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const categoriaId = idDesdeParam(req.params.categoriaId);
    const formularioId = idDesdeParam(req.params.formularioId);
    if (!categoriaId || !formularioId) {
      return res.status(400).json({ message: "Ids inválidos" });
    }
    await quitarFormularioDeCategoria(
      req.usuario!.id,
      categoriaId,
      formularioId,
    );
    return res
      .status(200)
      .json({ message: "Formulario desvinculado de la categoría" });
  } catch (error) {
    return next(error);
  }
}

/* ═══════════════════════════ Respuestas de una línea de solicitud ═══════════════════════════ */

export async function listarFormulariosDeLineaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const detalleId = idDesdeParam(req.params.detalleId);
    if (!detalleId) {
      return res
        .status(400)
        .json({ message: "Id de línea de solicitud inválido" });
    }
    return res.status(200).json(await listarFormulariosDeLinea(detalleId));
  } catch (error) {
    return next(error);
  }
}

export async function obtenerRespuestasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const detalleId = idDesdeParam(req.params.detalleId);
    const formularioId = idDesdeParam(req.params.formularioId);
    if (!detalleId || !formularioId) {
      return res.status(400).json({ message: "Ids inválidos" });
    }

    const detalleFormulario = await buscarDetalleFormulario(
      detalleId,
      formularioId,
    );
    if (!detalleFormulario) {
      // Formulario exigido pero todavía sin empezar a llenar: no es un
      // error, es el estado inicial válido. El frontend distingue "vacío"
      // de "no existe" por este 200 con arreglo vacío.
      return res.status(200).json({ detalle: null, respuestas: [] });
    }

    const respuestas = await listarRespuestas(detalleFormulario.id);
    return res.status(200).json({ detalle: detalleFormulario, respuestas });
  } catch (error) {
    return next(error);
  }
}

export async function guardarRespuestasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const detalleId = idDesdeParam(req.params.detalleId);
    const formularioId = idDesdeParam(req.params.formularioId);
    if (!detalleId || !formularioId) {
      return res.status(400).json({ message: "Ids inválidos" });
    }

    if (!(await buscarFormularioPorId(formularioId))) {
      return res.status(404).json({ message: "El formulario no existe" });
    }

    const parsed = guardarRespuestasSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const resultado = await guardarRespuestasFormulario(req.usuario!.id, {
      detalleSolicitudId: detalleId,
      formularioId,
      completado: parsed.data.completado,
      respuestas: parsed.data.respuestas.map((r) => ({
        formularioCampoId: r.formulario_campo_id,
        numeroFila: r.numero_fila,
        valorTexto: r.valor_texto,
      })),
    });

    return res.status(200).json(resultado);
  } catch (error) {
    const traducido = traducirErrorPostgres(error);
    if (traducido)
      return res.status(traducido.status).json({ message: traducido.message });
    return next(error);
  }
}
