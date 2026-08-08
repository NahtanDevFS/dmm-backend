import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

/**
 * `password_hash` no aparece en ninguna de estas consultas a propósito: nunca
 * debe salir del backend, ni siquiera hacia un ADMINISTRADOR.
 */
export interface UsuarioRow {
  id: number;
  username: string;
  rol_id: number;
  ultimo_login: Date | null;
  activo: boolean;
}

const COLUMNAS = "id, username, rol_id, ultimo_login, activo";

export interface RolRow {
  id: number;
  nombre: string;
  descripcion: string | null;
}

export async function listarUsuarios(params: {
  rolId?: number;
  busqueda?: string;
  incluirInactivos: boolean;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: Record<string, unknown>[] }> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (!params.incluirInactivos) condiciones.push(`u.activo = true`);
  if (params.rolId !== undefined) {
    valores.push(params.rolId);
    condiciones.push(`u.rol_id = $${valores.length}`);
  }
  if (params.busqueda !== undefined) {
    valores.push(`%${params.busqueda}%`);
    condiciones.push(`u.username ILIKE $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const totalResult = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id ${where}`,
    valores,
  );

  const result = await pool.query(
    `SELECT u.id, u.username, u.rol_id, r.nombre AS rol_nombre,
            u.ultimo_login, u.activo
     FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id
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

/** Solo para verificar la contraseña actual; el hash no sale de este módulo. */
export async function buscarHashDeUsuario(
  id: number,
): Promise<string | null> {
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

export async function existeRolActivo(id: number): Promise<boolean> {
  const rol = await prisma.rol.findUnique({
    where: { id },
    select: { activo: true },
  });
  return rol?.activo === true;
}

/**
 * `rol` es de solo lectura por diseño: los permisos están codificados en el
 * backend (requireRole en cada ruta), así que un rol creado desde una pantalla
 * de catálogos no tendría ningún permiso real. Esta lista existe únicamente
 * para poblar el select al crear o editar un usuario.
 */
export async function listarRoles(): Promise<RolRow[]> {
  return prisma.rol.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, descripcion: true },
  });
}

/** Cuántos ADMINISTRADOR activos quedan, sin contar al usuario indicado. */
export async function contarOtrosAdministradoresActivos(
  excluirId: number,
): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM public.usuario u
     JOIN public.rol r ON r.id = u.rol_id
     WHERE u.activo = true AND r.nombre = 'ADMINISTRADOR' AND u.id <> $1`,
    [excluirId],
  );
  return result.rows[0]?.n ?? 0;
}

export async function crearUsuario(
  usuarioId: number,
  datos: { username: string; passwordHash: string; rol_id: number },
): Promise<UsuarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<UsuarioRow>(
      `INSERT INTO public.usuario (username, password_hash, rol_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNAS}`,
      [datos.username, datos.passwordHash, datos.rol_id, usuarioId],
    );
    return result.rows[0];
  });
}

export async function editarUsuario(
  usuarioId: number,
  id: number,
  datos: { username?: string; rol_id?: number },
): Promise<UsuarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of ["username", "rol_id"] as const) {
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

/**
 * Cambiar la contraseña revoca las demás sesiones del usuario: si la contraseña
 * se cambió porque estaba comprometida, dejar sesiones abiertas con la anterior
 * anularía el propósito. Se conserva la sesión indicada en `sesionVigenteId`
 * (la del propio usuario que hace el cambio) para no cerrarle la suya.
 */
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

/**
 * Desactivar revoca todas las sesiones del usuario. requireAuth ya rechaza a un
 * usuario inactivo, pero dejar las filas sin revocar daría una lectura falsa de
 * "sesiones activas" en auditoría.
 */
export async function cambiarEstadoUsuario(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<UsuarioRow> {
  return withUserTransaction(usuarioId, async (client) => {
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
