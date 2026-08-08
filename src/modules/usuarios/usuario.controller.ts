import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import {
  crearUsuarioSchema,
  editarUsuarioSchema,
  cambiarPasswordPropiaSchema,
  resetearPasswordSchema,
  listarUsuariosQuerySchema,
} from "./usuario.schema.js";
import {
  listarUsuarios,
  buscarUsuarioPorId,
  buscarHashDeUsuario,
  existeUsername,
  existeRolActivo,
  listarRoles,
  contarOtrosAdministradoresActivos,
  crearUsuario,
  editarUsuario,
  actualizarPassword,
  cambiarEstadoUsuario,
} from "./usuario.repository.js";

/** Mismo coste que usa el resto del sistema para los hashes existentes. */
const BCRYPT_ROUNDS = 12;

async function resolverUsuario(
  req: Request,
): Promise<
  { ok: true; id: number } | { ok: false; status: number; message: string }
> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, message: "Id inválido" };
  }
  const usuario = await buscarUsuarioPorId(id);
  if (!usuario) {
    return { ok: false, status: 404, message: "Usuario no encontrado" };
  }
  return { ok: true, id };
}

// ─────────────────────────────────────────────── roles

export async function listarRolesController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarRoles());
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── usuarios

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarUsuariosQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    return res.status(200).json(
      await listarUsuarios({
        rolId: parsed.data.rolId,
        busqueda: parsed.data.busqueda,
        incluirInactivos: parsed.data.incluirInactivos,
      }),
    );
  } catch (error) {
    return next(error);
  }
}

export async function obtenerController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverUsuario(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res.status(200).json(await buscarUsuarioPorId(ruta.id));
  } catch (error) {
    return next(error);
  }
}

export async function crearController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearUsuarioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (await existeUsername(parsed.data.username)) {
      return res.status(409).json({
        message: `Ya existe un usuario con el nombre "${parsed.data.username}"`,
      });
    }

    if (!(await existeRolActivo(parsed.data.rol_id))) {
      return res
        .status(400)
        .json({ message: "El rol indicado no existe o no está activo" });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    const nuevo = await crearUsuario(req.usuario!.id, {
      username: parsed.data.username,
      passwordHash,
      rol_id: parsed.data.rol_id,
    });
    return res.status(201).json(nuevo);
  } catch (error) {
    return next(error);
  }
}

export async function editarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverUsuario(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarUsuarioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (
      parsed.data.username === undefined &&
      parsed.data.rol_id === undefined
    ) {
      return res
        .status(400)
        .json({ message: "No hay nada que actualizar" });
    }

    if (
      parsed.data.username !== undefined &&
      (await existeUsername(parsed.data.username, ruta.id))
    ) {
      return res.status(409).json({
        message: `Ya existe un usuario con el nombre "${parsed.data.username}"`,
      });
    }

    if (parsed.data.rol_id !== undefined) {
      if (!(await existeRolActivo(parsed.data.rol_id))) {
        return res
          .status(400)
          .json({ message: "El rol indicado no existe o no está activo" });
      }

      // Cambiarse el rol a uno mismo es la forma más fácil de perder el acceso
      // de administración sin querer.
      if (ruta.id === req.usuario!.id) {
        return res.status(409).json({
          message:
            "No puede cambiar su propio rol. Pida a otro administrador que lo haga.",
        });
      }

      // Y si es el último administrador, cambiarle el rol dejaría el sistema sin
      // nadie que pueda gestionar usuarios.
      if (
        req.usuario!.rol === "ADMINISTRADOR" &&
        (await contarOtrosAdministradoresActivos(ruta.id)) === 0
      ) {
        return res.status(409).json({
          message:
            "No se puede cambiar el rol del único administrador activo del sistema.",
        });
      }
    }

    const actualizado = await editarUsuario(
      req.usuario!.id,
      ruta.id,
      parsed.data,
    );
    return res.status(200).json(actualizado);
  } catch (error) {
    return next(error);
  }
}

export async function desactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverUsuario(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    if (ruta.id === req.usuario!.id) {
      return res
        .status(409)
        .json({ message: "No puede desactivar su propio usuario" });
    }

    const usuario = (await buscarUsuarioPorId(ruta.id))!;
    if (!usuario.activo) {
      return res.status(200).json(usuario); // idempotente
    }

    if ((await contarOtrosAdministradoresActivos(ruta.id)) === 0) {
      return res.status(409).json({
        message:
          "No se puede desactivar al único administrador activo del sistema.",
      });
    }

    return res
      .status(200)
      .json(await cambiarEstadoUsuario(req.usuario!.id, ruta.id, false));
  } catch (error) {
    return next(error);
  }
}

export async function reactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverUsuario(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res
      .status(200)
      .json(await cambiarEstadoUsuario(req.usuario!.id, ruta.id, true));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── contraseñas

/** Cambio de la contraseña propia: cualquier usuario autenticado. */
export async function cambiarPasswordPropiaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = cambiarPasswordPropiaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const hashActual = await buscarHashDeUsuario(req.usuario!.id);
    if (
      hashActual === null ||
      !(await bcrypt.compare(parsed.data.password_actual, hashActual))
    ) {
      return res
        .status(401)
        .json({ message: "La contraseña actual no es correcta" });
    }

    if (parsed.data.password_nueva === parsed.data.password_actual) {
      return res.status(400).json({
        message: "La contraseña nueva debe ser distinta de la actual",
      });
    }

    const passwordHash = await bcrypt.hash(
      parsed.data.password_nueva,
      BCRYPT_ROUNDS,
    );
    // Se conserva la sesión desde la que se hace el cambio y se revocan las demás.
    await actualizarPassword(
      req.usuario!.id,
      req.usuario!.id,
      passwordHash,
      req.sesion!.id,
    );

    return res.status(200).json({
      message:
        "Contraseña actualizada. Se cerraron las demás sesiones abiertas de su usuario.",
    });
  } catch (error) {
    return next(error);
  }
}

/** Reseteo por administrador: no requiere la contraseña actual. */
export async function resetearPasswordController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverUsuario(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = resetearPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const passwordHash = await bcrypt.hash(
      parsed.data.password_nueva,
      BCRYPT_ROUNDS,
    );
    // Sin sesión a conservar: al usuario afectado se le cierran todas.
    await actualizarPassword(req.usuario!.id, ruta.id, passwordHash);

    return res.status(200).json({
      message:
        "Contraseña restablecida. Se cerraron todas las sesiones del usuario.",
    });
  } catch (error) {
    return next(error);
  }
}
