import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

/** Límites de peticiones (RNF-SEG, checklist de seguridad) */

/** La clave combina IP y usuario intentado */
function claveLogin(req: Request): string {
  const usuario =
    typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase().slice(0, 50)
      : "sin-usuario";
  return `${ipKeyGenerator(req.ip ?? "")}:${usuario}`;
}

export const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: claveLogin,
// Un login correcto no gasta cuota: quien sabe su contraseña no debe quedarbloqueado por haberse equivocado antes
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message:
      "Demasiados intentos de inicio de sesión. Espere unos minutos e intente de nuevo.",
  },
});

/** Límite general, holgado a propósito: la DMM son unas pocas computadoras y elfrontend hace varias peticiones por pantalla */
export const limiteGeneral = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Demasiadas peticiones. Espere un momento e intente de nuevo.",
  },
});
