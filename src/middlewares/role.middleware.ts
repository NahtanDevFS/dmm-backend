import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Rol } from "../config/roles.js";

/*
Los middlewares que produce este archivo se marcan con una propiedad para
que la guarda de arranque (src/lib/rutas-protegidas.ts) pueda reconocerlos
al recorrer el arbol de rutas.
*/
export interface HandlerConPermisos extends RequestHandler {
  /* Roles que este requireRole deja pasar*/
  rolesPermitidos?: readonly string[];
  /*Motivo por el que la ruta esta exenta de declarar roles*/
  motivoSinRol?: string;
}

/*
Acepta tanto `requireRole(...ROLES)` como `requireRole(ROLES)`, para que los
conjuntos de src/config/roles.ts se pasen sin desestructurar
*/
export function requireRole(
  ...roles: Array<Rol | string | readonly (Rol | string)[]>
): HandlerConPermisos {
  const permitidos = roles.flat() as string[];

  if (permitidos.length === 0) {
    throw new Error(
      "requireRole se invoco sin ningun rol: eso bloquearia a todo el mundo. " +
        "Use un conjunto de src/config/roles.ts.",
    );
  }

  const handler: HandlerConPermisos = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (!req.usuario) {
      return res.status(401).json({ message: "No ha iniciado sesión" });
    }

    if (!permitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        message: "No tiene permisos para realizar esta acción",
      });
    }

    return next();
  };

  handler.rolesPermitidos = permitidos;
  return handler;
}

/*
Declara que una ruta es deliberadamente accesible sin restriccion de rol, y
obliga a escribir el motivo en el mismo sitio donde se declara la ruta.
Es la unica forma de que la guarda de arranque acepte una ruta sin
requireRole. No hace nada en tiempo de ejecucion: existe para que la
decision quede visible en la revision del codigo y no en una lista aparte
que nadie vuelve a mirar.
 */
export function permitirSinRol(motivo: string): HandlerConPermisos {
  if (!motivo?.trim()) {
    throw new Error("permitirSinRol exige un motivo escrito.");
  }

  const handler: HandlerConPermisos = (_req, _res, next) => next();
  handler.motivoSinRol = motivo;
  return handler;
}
