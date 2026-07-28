import type { Request, Response, NextFunction } from "express";
import { crearDocumentoPersonaSchema } from "./documento-persona.schema.js";
import {
  listarDocumentosDePersona,
  buscarDocumentoPorId,
  crearDocumentoPersona,
  eliminarDocumentoPersona,
} from "./documento-persona.repository.js";
import { buscarPersonaPorId } from "./persona.repository.js";
import { existeTipoDocumentoPersonaActivo } from "../catalogos-lectura/catalogos-lectura.repository.js";
import {
  guardarArchivo,
  ArchivoInvalidoError,
} from "../../lib/storage/storage.service.js";

export async function listarDocumentosController(
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

    const documentos = await listarDocumentosDePersona(id);
    return res.status(200).json(documentos);
  } catch (error) {
    return next(error);
  }
}

export async function subirDocumentoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Debe adjuntar un archivo" });
    }

    const parsed = crearDocumentoPersonaSchema.safeParse(req.body);
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

    if (
      !(await existeTipoDocumentoPersonaActivo(parsed.data.tipoDocumentoId))
    ) {
      return res.status(400).json({
        message: "El tipo de documento indicado no existe o no está activo",
      });
    }

    const guardado = await guardarArchivo(
      req.file.buffer,
      "documentos-persona",
    );

    const nuevo = await crearDocumentoPersona(req.usuario!.id, {
      personaId: id,
      tipoDocumentoId: parsed.data.tipoDocumentoId,
      numeroDocumento: parsed.data.numeroDocumento,
      rutaArchivo: guardado.rutaRelativa,
      observaciones: parsed.data.observaciones,
    });

    return res.status(201).json(nuevo);
  } catch (error) {
    if (error instanceof ArchivoInvalidoError) {
      return res.status(400).json({ message: error.message });
    }
    return next(error);
  }
}

export async function eliminarDocumentoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    const documentoId = Number(req.params.documentoId);
    if (!Number.isInteger(id) || !Number.isInteger(documentoId)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const documento = await buscarDocumentoPorId(documentoId);
    if (!documento || documento.persona_id !== id) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    await eliminarDocumentoPersona(req.usuario!.id, documentoId);
    const documentos = await listarDocumentosDePersona(id);
    return res.status(200).json(documentos);
  } catch (error) {
    return next(error);
  }
}
