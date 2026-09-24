import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";
import type { PoolClient } from "pg";
import { patronContiene } from "../../lib/busqueda.js";

/** `password_hash` no aparece en ninguna de estas consultas a propósito: nuncadebe salir del backend, ni siquiera hacia un ADMINISTRADOR */
export interface UsuarioRow {
  id: number;
  /** Identificador de acceso: ASCII, sin tildes ni espacios */
  username: string;
  /** El nombre de la persona, como se escribe */
  nombre_completo: string | null;
  rol_id: number;
  /** Programa del que esta usuaria es encargada */
  programa_id: number | null;
  ultimo_login: Date | null;
  activo: boolean;
}

const COLUMNAS =
  "id, username, nombre_completo, rol_id, programa_id, ultimo_login, activo";

export interface RolRow {
  id: number;
  nombre: string;
  descripcion: string | null;
}

export async function listarUsuarios(params: {
  rolId?: number;
  busqueda?: string;
  incluirInactivos: boolean;
  /** Para quien no es ADMINISTRADOR: las cuentas de administración no existen para él */
  ocultarAdministradores: boolean;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: Record<string, unknown>[] }> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (!params.incluirInactivos) condiciones.push(`u.activo = true`);
  if (params.ocultarAdministradores) {
    condiciones.push(`r.nombre <> 'ADMINISTRADOR'`);
  }
  if (params.rolId !== undefined) {
    valores.push(params.rolId);
    condiciones.push(`u.rol_id = $${valores.length}`);
  }
  if (params.busqueda !== undefined) {
    valores.push(patronContiene(params.busqueda));
    condiciones.push(`u.username ILIKE $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const totalResult = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id ${where}`,
    valores,
  );

  const result = await pool.query(
    `SELECT u.id, u.username, u.nombre_completo, u.rol_id, r.nombre AS rol_nombre,
            u.programa_id, pr.nombre AS programa_nombre,
            u.ultimo_login, u.activo
     FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id
     LEFT JOIN public.programa pr ON pr.id = u.programa_id
     ${where}
     ORDER BY u.username
     LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, params.limite, params.desplazamiento],
  );

  return { total: totalResult.rows[0]?.n ?? 0, filas: result.rows };
}

export async function buscarUsuarioPorId(
  id: number,
): Promise<UsuarioRow | null> {
  const result = await pool.query<UsuarioRow>(
    `SELECT ${COLUMNAS} FROM public.usuario WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Nombre del rol del usuario, o null si el usuario no existe */
export async function buscarRolDeUsuario(id: number): Promise<string | null> {
  const result = await pool.query<{ nombre: string }>(
    `SELECT r.nombre FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id
     WHERE u.id = $1`,
    [id],
  );
  return result.rows[0]?.nombre ?? null;
}

/** Solo para verificar la contraseña actual; el hash no sale de este módulo */
export async function buscarHashDeUsuario(id: number): Promise<string | null> {
  const result = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM public.usuario WHERE id = $1`,
    [id],
  );
  return result.rows[0]?.password_hash ?? null;
}

export async function existeUsername(
  username: string,
  excluirId?: number,
): Promise<boolean> {
  const usuario = await prisma.usuario.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!usuario) return false;
  if (excluirId !== undefined && usuario.id === excluirId) return false;
  return true;
}

/** Nombre del rol si existe y está activo; null en otro caso */
export async function buscarRolActivo(id: number): Promise<string | null> {
  const rol = await prisma.rol.findUnique({
    where: { id },
    select: { activo: true, nombre: true },
  });
  return rol?.activo === true ? rol.nombre : null;
}

/** `rol` es de solo lectura por diseño: los permisos están codificados en elbackend (requireRole en cada ruta), así que un rol creado desde una pantallade catálogos no tendría ningún permiso real */
export async function listarRoles(
  incluirAdministrador: boolean,
): Promise<RolRow[]> {
  return prisma.rol.findMany({
    where: {
      activo: true,
      ...(incluirAdministrador ? {} : { nombre: { not: "ADMINISTRADOR" } }),
    },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, descripcion: true },
  });
}

/** Quitarle a alguien su condición de ADMINISTRADOR activo cuando es el último: el status lo traduce errorHandler a 409 */
export class UltimoAdministradorError extends Error {
  status = 409;
}

/** Lanza si el usuario `id` es el único ADMINISTRADOR activo. Mira el rol del usuario afectado, no el de quien hace el cambio, y bloquea las filas de los administradores activos: así dos cambios simultáneos no pueden retirar cada uno "al otro" y dejar el sistema sin ninguno */
async function asegurarQueNoEsElUltimoAdministrador(
  client: PoolClient,
  id: number,
  mensaje: string,
): Promise<void> {
  const result = await client.query<{ id: number }>(
    `SELECT u.id
     FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id
     WHERE u.activo = true AND r.nombre = 'ADMINISTRADOR'
     FOR UPDATE OF u`,
  );
  const administradores = result.rows.map((r) => r.id);
  if (administradores.length === 1 && administradores[0] === id) {
    throw new UltimoAdministradorError(mensaje);
  }
}

export async function crearUsuario(
  usuarioId: number,
  datos: {
    username: string;
    passwordHash: string;
    rol_id: number;
    nombre_completo: string;
    programa_id?: number | null;
  },
): Promise<UsuarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<UsuarioRow>(
      `INSERT INTO public.usuario
         (username, password_hash, rol_id, nombre_completo, programa_id,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNAS}`,
      [
        datos.username,
        datos.passwordHash,
        datos.rol_id,
        datos.nombre_completo,
        datos.programa_id ?? null,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

export async function editarUsuario(
  usuarioId: number,
  id: number,
  datos: {
    username?: string;
    rol_id?: number;
    nombre_completo?: string;
    programa_id?: number | null;
  },
): Promise<UsuarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    if (datos.rol_id !== undefined) {
      const nuevoRol = await client.query<{ nombre: string }>(
        "SELECT nombre FROM public.rol WHERE id = $1",
        [datos.rol_id],
      );
      if (nuevoRol.rows[0]?.nombre !== "ADMINISTRADOR") {
        await asegurarQueNoEsElUltimoAdministrador(
          client,
          id,
          "No se puede cambiar el rol del único administrador activo del sistema.",
        );
      }
    }

    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of [
      "username",
      "nombre_completo",
      "rol_id",
      "programa_id",
    ] as const) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;
    valores.push(id);

    const result = await client.query<UsuarioRow>(
      `UPDATE public.usuario SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS}`,
      valores,
    );
    return result.rows[0];
  });
}

/** Cambiar la contraseña revoca las demás sesiones del usuario: si la contraseñase cambió porque estaba comprometida, dejar sesiones abiertas con la anterioranularía el propósito */
export async function actualizarPassword(
  usuarioId: number,
  idAfectado: number,
  passwordHash: string,
  sesionVigenteId?: string,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.usuario
       SET password_hash = $1, updated_by = $2
       WHERE id = $3`,
      [passwordHash, usuarioId, idAfectado],
    );

    await client.query(
      `UPDATE public.sesion
       SET revocada_en = CURRENT_TIMESTAMP, updated_by = $1
       WHERE usuario_id = $2
         AND revocada_en IS NULL
         ${sesionVigenteId !== undefined ? "AND id <> $3" : ""}`,
      sesionVigenteId !== undefined
        ? [usuarioId, idAfectado, sesionVigenteId]
        : [usuarioId, idAfectado],
    );
  });
}

/** Desactivar revoca todas las sesiones del usuario */
export async function cambiarEstadoUsuario(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<UsuarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    if (!nuevoEstado) {
      await asegurarQueNoEsElUltimoAdministrador(
        client,
        id,
        "No se puede desactivar al único administrador activo del sistema.",
      );
    }

    const result = await client.query<UsuarioRow>(
      `UPDATE public.usuario SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${COLUMNAS}`,
      [nuevoEstado, usuarioId, id],
    );

    if (!nuevoEstado) {
      await client.query(
        `UPDATE public.sesion
         SET revocada_en = CURRENT_TIMESTAMP, updated_by = $1
         WHERE usuario_id = $2 AND revocada_en IS NULL`,
        [usuarioId, id],
      );
    }

    return result.rows[0];
  });
}
