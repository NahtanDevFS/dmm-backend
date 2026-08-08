import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

/**
 * Límites de peticiones (RNF-SEG, checklist de seguridad).
 *
 * El objetivo real aquí es el login: sin límite, `POST /api/auth/login` es un
 * oráculo de fuerza bruta contra bcrypt. Y como cada intento cuesta un hash de
 * coste 12 (~250 ms de CPU), un atacante también puede saturar el servidor con
 * peticiones concurrentes, así que el límite protege dos cosas a la vez.
 */

/**
 * La clave combina IP y usuario intentado. Solo por IP, toda la municipalidad
 * comparte una salida NAT y un empleado equivocándose bloquearía a los demás;
 * solo por usuario, un atacante rota nombres y nunca topa el límite.
 *
 * `ipKeyGenerator` es de express-rate-limit: normaliza IPv6 para que no se pueda
 * evadir el límite cambiando de dirección dentro del mismo prefijo.
 */
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
  // Un login correcto no gasta cuota: quien sabe su contraseña no debe quedar
  // bloqueado por haberse equivocado antes.
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message:
      "Demasiados intentos de inicio de sesión. Espere unos minutos e intente de nuevo.",
  },
});

/**
 * Límite general, holgado a propósito: la DMM son unas pocas computadoras y el
 * frontend hace varias peticiones por pantalla. Está para frenar un bucle
 * descontrolado o un escaneo, no para regular el uso normal.
 */
export const limiteGeneral = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Demasiadas peticiones. Espere un momento e intente de nuevo.",
  },
});
