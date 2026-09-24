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

export const INTENTOS_CAMBIO_PASSWORD = 5;
const VENTANA_CAMBIO_PASSWORD_MS = 15 * 60 * 1000;

/** Intentos de adivinar la contraseña actual desde una sesión ya abierta (alguien que encuentra la computadora sin bloquear). Se cuenta por usuario y no por sesión, para que abrir otra no reinicie la cuota. Solo cuenta cuando la contraseña actual es incorrecta: el controlador lo marca en res.locals, y un error de formato en la nueva no gasta intentos */
export const limiteCambioPassword = rateLimit({
  windowMs: VENTANA_CAMBIO_PASSWORD_MS,
  limit: INTENTOS_CAMBIO_PASSWORD,
  keyGenerator: (req) => `usuario:${req.usuario!.id}`,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.locals.passwordActualIncorrecta !== true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    const reinicio = req.rateLimit?.resetTime;
    const minutos = reinicio
      ? Math.max(1, Math.ceil((reinicio.getTime() - Date.now()) / 60_000))
      : VENTANA_CAMBIO_PASSWORD_MS / 60_000;
    res.status(429).json({
      code: "CAMBIO_PASSWORD_BLOQUEADO",
      intentos_restantes: 0,
      message: `Agotó los ${INTENTOS_CAMBIO_PASSWORD} intentos para cambiar su contraseña. Podrá intentarlo de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}.`,
    });
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
