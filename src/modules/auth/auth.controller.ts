import type { Request, Response, NextFunction } from "express";
import {
  login,
  logout,
  usuarioDeSesion,
  CredencialesInvalidasError,
  UsuarioInactivoError,
} from "./auth.service.js";
import { loginSchema } from "./auth.schema.js";
import { SESION_DURACION_MAXIMA_HORAS } from "./session.utils.js";

const COOKIE_NAME = "dmm_session";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: SESION_DURACION_MAXIMA_HORAS * 60 * 60 * 1000,
    path: "/",
  };
}

export async function loginController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Usuario y contraseña son requeridos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const resultado = await login({
      username: parsed.data.username,
      password: parsed.data.password,
      ipOrigen: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });

    res.cookie(COOKIE_NAME, resultado.token, cookieOptions());

    return res.status(200).json({
      usuario: resultado.usuario,
    });
  } catch (error) {
    if (error instanceof CredencialesInvalidasError) {
      return res.status(401).json({ message: error.message });
    }
    if (error instanceof UsuarioInactivoError) {
      return res.status(403).json({ message: error.message });
    }
    return next(error);
  }
}

export async function logoutController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
// Req
    if (req.sesion && req.usuario) {
      await logout({
        sesionId: req.sesion.id,
        usuarioId: req.usuario.id,
      });
    }

    res.clearCookie(COOKIE_NAME, cookieOptions());
    return res.status(200).json({ message: "Sesión cerrada" });
  } catch (error) {
    return next(error);
  }
}

/** Devuelve la sesión vigente */
export async function meController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const usuario = await usuarioDeSesion(req.usuario!.id);
    return res.status(200).json({ usuario: usuario ?? req.usuario });
  } catch (error) {
    return next(error);
  }
}

export { COOKIE_NAME };
