import multer from "multer";
import { TAMANO_MAXIMO_BYTES } from "./file-validation.js";

export const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_BYTES },
});
