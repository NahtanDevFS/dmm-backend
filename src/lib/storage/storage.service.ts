import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  validarTipoArchivoReal,
  ArchivoInvalidoError,
  TAMANO_MAXIMO_BYTES,
} from "./file-validation.js";

const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads"),
);

export type CategoriaArchivo =
  | "documentos-persona"
  | "evidencia-entrega"
  | "recetas-medicas"
  | "documentos-recepcion"
  | "contratos-prestamo"
  | "evidencia-contrato-prestamo"
  // Legajo escaneado de una solicitud: formularios firmados, constancias.
  | "documentos-solicitud";

export interface ArchivoGuardado {
  rutaRelativa: string;
  mimeType: string;
  tamanoBytes: number;
}

export async function guardarArchivo(
  buffer: Buffer,
  categoria: CategoriaArchivo,
): Promise<ArchivoGuardado> {
  if (buffer.byteLength > TAMANO_MAXIMO_BYTES) {
    throw new ArchivoInvalidoError(
      `El archivo excede el tamaño máximo permitido (${TAMANO_MAXIMO_BYTES / (1024 * 1024)} MB).`,
    );
  }

  const { mimeType, extension, esImagen } =
    await validarTipoArchivoReal(buffer);

  let bufferFinal = buffer;
  if (esImagen) {
    bufferFinal = await sharp(buffer)
      .rotate() // respeta la orientación EXIF antes de descartar metadatos
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  const nombreArchivo = `${randomUUID()}.${esImagen ? "jpg" : extension}`;
  const carpetaDestino = path.join(UPLOADS_DIR, categoria);
  await mkdir(carpetaDestino, { recursive: true });

  const rutaAbsoluta = path.join(carpetaDestino, nombreArchivo);
  await writeFile(rutaAbsoluta, bufferFinal);

  const rutaRelativa = path.posix.join(categoria, nombreArchivo);

  return {
    rutaRelativa,
    mimeType: esImagen ? "image/jpeg" : mimeType,
    tamanoBytes: bufferFinal.byteLength,
  };
}

export { ArchivoInvalidoError };
