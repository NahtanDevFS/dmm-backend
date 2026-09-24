import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { paginar } from "../../lib/paginacion.js";
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
  buscarRolActivo,
  buscarRolDeUsuario,
  listarRoles,
  crearUsuario,
  editarUsuario,
  actualizarPassword,
  cambiarEstadoUsuario,
} from "./usuario.repository.js";
import { BCRYPT_ROUNDS } from "../../config/seguridad.js";
import { ROL } from "../../config/roles.js";

/** Las cuentas ADMINISTRADOR solo existen para otros administradores: a la Directora no se le listan, no puede abrirlas ni modificarlas, y tampoco asignar ese rol */
function veAdministradores(req: Request): boolean {
  return req.usuario!.rol === ROL.ADMINISTRADOR;
}

const NO_PUEDE_ASIGNAR_ADMIN =
  "Solo un administrador puede asignar el rol ADMINISTRADOR.";

async function resolverUsuario(
  req: Request,
): Promise<
  { ok: true; id: number } | { ok: false; status: number; message: string }
> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, message: "Id inválido" };
  }
  const rol = await buscarRolDeUsuario(id);
  // Un administrador oculto responde igual que uno inexistente: un 403
  // confirmaría que ese id es una cuenta de administración
  if (
    rol === null ||
    (rol === ROL.ADMINISTRADOR && !veAdministradores(req))
  ) {
    return { ok: false, status: 404, message: "Usuario no encontrado" };
  }
  return { ok: true, id };
}

// roles

export async function listarRolesController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarRoles(veAdministradores(req)));
  } catch (error) {
    return next(error);
  }
}

// usuarios

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
    const { total, filas } = await listarUsuarios({
      rolId: parsed.data.rolId,
      busqueda: parsed.data.busqueda,
      incluirInactivos: parsed.data.incluirInactivos,
      ocultarAdministradores: !veAdministradores(req),
      limite: parsed.data.limite,
      desplazamiento: parsed.data.desplazamiento,
    });
    return res.status(200).json(paginar(filas, total, parsed.data));
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

    const rol = await buscarRolActivo(parsed.data.rol_id);
    if (rol === null) {
      return res
        .status(400)
        .json({ message: "El rol indicado no existe o no está activo" });
    }
    if (rol === ROL.ADMINISTRADOR && !veAdministradores(req)) {
      return res.status(403).json({ message: NO_PUEDE_ASIGNAR_ADMIN });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    const nuevo = await crearUsuario(req.usuario!.id, {
      username: parsed.data.username,
      passwordHash,
      rol_id: parsed.data.rol_id,
      nombre_completo: parsed.data.nombre_completo,
      programa_id: parsed.data.programa_id,
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

    // programa_id en null sí es un cambio: quita el programa asignado
    const camposEditables = [
      "username",
      "rol_id",
      "nombre_completo",
      "programa_id",
    ] as const;
    if (camposEditables.every((campo) => parsed.data[campo] === undefined)) {
      return res.status(400).json({ message: "No hay nada que actualizar" });
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
      const rol = await buscarRolActivo(parsed.data.rol_id);
      if (rol === null) {
        return res
          .status(400)
          .json({ message: "El rol indicado no existe o no está activo" });
      }
      if (rol === ROL.ADMINISTRADOR && !veAdministradores(req)) {
        return res.status(403).json({ message: NO_PUEDE_ASIGNAR_ADMIN });
      }

// Cambiarse el rol a uno mismo es la forma más fácil de perder el accesode administración sin querer
      if (ruta.id === req.usuario!.id) {
        return res.status(409).json({
          message:
            "No puede cambiar su propio rol. Pida a otro administrador que lo haga.",
        });
      }
// Que no sea el último administrador se comprueba en editarUsuario, dentro de la transacción
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

// cambiarEstadoUsuario rechaza con 409 si es el último administrador activo
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

// contraseñas

/** Cambio de la contraseña propia: cualquier usuario autenticado */
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
// 400 y no 401: la sesión sigue siendo válida, solo el dato del formulario está mal. El frontend trata todo 401 como sesión expirada y sacaba al usuario por un error de tecleo
      // Solo este caso gasta un intento de limiteCambioPassword
      res.locals.passwordActualIncorrecta = true;
      const restantes = req.rateLimit?.remaining;
      return res.status(400).json({
        code: "CURRENT_PASSWORD_INVALID",
        intentos_restantes: restantes,
        message:
          restantes === undefined
            ? "La contraseña actual no es correcta"
            : restantes === 0
              ? "La contraseña actual no es correcta. Era su último intento: deberá esperar 15 minutos para volver a intentarlo."
              : `La contraseña actual no es correcta. Le quedan ${restantes} intento${restantes === 1 ? "" : "s"}.`,
      });
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
// Se conserva la sesión desde la que se hace el cambio y se revocan las demás
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

/** Reseteo por administrador: no requiere la contraseña actual */
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
// Sin sesión a conservar: al usuario afectado se le cierran todas
    await actualizarPassword(req.usuario!.id, ruta.id, passwordHash);

    return res.status(200).json({
      message:
        "Contraseña restablecida. Se cerraron todas las sesiones del usuario.",
    });
  } catch (error) {
    return next(error);
  }
}
