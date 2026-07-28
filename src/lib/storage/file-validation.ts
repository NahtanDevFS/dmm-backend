import { fileTypeFromBuffer } from "file-type";

export const TIPOS_PERMITIDOS = {
  "image/jpeg": { extension: "jpg", esImagen: true },
  "image/png": { extension: "png", esImagen: true },
  "image/webp": { extension: "webp", esImagen: true },
  "application/pdf": { extension: "pdf", esImagen: false },
} as const;

export type MimeTypePermitido = keyof typeof TIPOS_PERMITIDOS;

export const TAMANO_MAXIMO_BYTES = 8 * 1024 * 1024; // 8 MB

export class ArchivoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchivoInvalidoError";
  }
}

export async function validarTipoArchivoReal(buffer: Buffer): Promise<{
  mimeType: MimeTypePermitido;
  extension: string;
  esImagen: boolean;
}> {
  const detectado = await fileTypeFromBuffer(buffer);

  if (!detectado || !(detectado.mime in TIPOS_PERMITIDOS)) {
    throw new ArchivoInvalidoError(
      "El archivo no es una imagen (JPG/PNG/WEBP) ni un PDF válido.",
    );
  }

  const mimeType = detectado.mime as MimeTypePermitido;
  return { mimeType, ...TIPOS_PERMITIDOS[mimeType] };
}
