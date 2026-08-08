import type { Request, Response, NextFunction } from "express";
import {
  buscarSesionPorToken,
  actualizarUltimaActividad,
} from "../modules/auth/session.repository.js";
import prisma from "../db/prisma.js";
import { sesionInactiva } from "../modules/auth/session.utils.js";
import { COOKIE_NAME } from "../modules/auth/auth.controller.js";

/** Cada cuánto se refresca `ultima_actividad` como máximo. */
const LATIDO_MINIMO_MS = 60_000;

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token || typeof token !== "string") {
      return res.status(401).json({ message: "No ha iniciado sesión" });
    }

    const sesion = await buscarSesionPorToken(token);

    if (!sesion) {
      return res.status(401).json({ message: "Sesión inválida" });
    }

    if (sesion.revocada_en) {
      return res.status(401).json({ message: "La sesión ha sido cerrada" });
    }

    if (sesion.expira_en.getTime() < Date.now()) {
      return res.status(401).json({
        message: "La sesión ha expirado, inicie sesión nuevamente",
      });
    }

    if (sesionInactiva(sesion.ultima_actividad)) {
      return res.status(401).json({
        message: "La sesión expiró por inactividad, inicie sesión nuevamente",
      });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: sesion.usuario_id },
      include: { rol_usuario_rol_idTorol: true },
    });

    if (!usuario || !usuario.activo) {
      return res.status(403).json({
        message: "Su cuenta ha sido suspendida. Contacte al administrador",
      });
    }

    req.usuario = {
      id: usuario.id,
      username: usuario.username,
      rol: usuario.rol_usuario_rol_idTorol.nombre,
    };
    req.sesion = { id: sesion.id };

    /**
     * El latido no se escribe en cada petición. Sin este freno, cada `GET` de
     * un catálogo dispara un UPDATE con su transacción, y como `sesion` está
     * auditada, también una fila en `auditoria_log`: más de la mitad de la
     * bitácora era este latido.
     *
     * El precio es que `ultima_actividad` puede quedar hasta un minuto
     * desactualizada, así que en el peor caso la sesión expira a los 29 minutos
     * de inactividad en vez de a los 30. Contra una ventana de media hora es
     * irrelevante.
     */
    if (
      Date.now() - sesion.ultima_actividad.getTime() >
      LATIDO_MINIMO_MS
    ) {
      actualizarUltimaActividad(sesion.id, usuario.id).catch((err) => {
        console.error("Error actualizando ultima_actividad de sesion:", err);
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}
