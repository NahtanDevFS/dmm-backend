import type { Request, Response, NextFunction } from "express";

export function requireRole(...rolesPermitidos: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario) {
      return res.status(401).json({ message: "No ha iniciado sesión" });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        message: "No tiene permisos para realizar esta acción",
      });
    }

    return next();
  };
}
