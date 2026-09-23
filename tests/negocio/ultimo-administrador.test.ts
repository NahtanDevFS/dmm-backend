import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
  idCatalogo,
} from "../helpers/bd.js";
import {
  editarUsuario,
  cambiarEstadoUsuario,
  UltimoAdministradorError,
} from "../../src/modules/usuarios/usuario.repository.js";

/**
 * Regla del último administrador (QA-03): nunca puede quedar el sistema sin un
 * ADMINISTRADOR activo, ni por cambio de rol ni por desactivación.
 *
 * Antes la guarda miraba el rol de QUIEN hacía el cambio: un Administrador ya
 * contaba como "otro administrador" (la condición nunca se cumplía) y una
 * Directora ni siquiera entraba en ella, así que podía degradar al único
 * Administrador. Aquí se llama directo al repositorio, que es donde vive ahora
 * la comprobación, dentro de la misma transacción que el UPDATE.
 */

let rolAdmin: number;
let rolDirectora: number;
let rolEmpleado: number;
let directora: number;
let adminsPrevios: number[] = [];

async function crear(sufijo: string, rolId: number): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.usuario (username, password_hash, rol_id, activo)
     VALUES ($1, 'x', $2, true) RETURNING id`,
    [`test_qa03_${sufijo}`, rolId],
  );
  return rows[0].id;
}

async function rolYEstado(id: number) {
  const { rows } = await poolOwner.query<{ rol_id: number; activo: boolean }>(
    `SELECT rol_id, activo FROM public.usuario WHERE id = $1`,
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  await resetBaseDePruebas();
  rolAdmin = await idCatalogo("rol", "ADMINISTRADOR");
  rolDirectora = await idCatalogo("rol", "DIRECTORA");
  rolEmpleado = await idCatalogo("rol", "EMPLEADO_DMM");
  const { rows } = await poolOwner.query<{ id: number }>(
    `SELECT id FROM public.usuario WHERE rol_id = $1 AND activo = true`,
    [rolAdmin],
  );
  adminsPrevios = rows.map((r) => r.id);
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `DELETE FROM public.usuario WHERE username LIKE 'test\\_qa03\\_%' ESCAPE '\\'`,
  );
  // Parte de cero administradores activos: cada caso crea los que necesita
  await poolOwner.query(
    `UPDATE public.usuario SET activo = false WHERE rol_id = $1`,
    [rolAdmin],
  );
  directora = await crear("directora", rolDirectora);
});

afterAll(async () => {
  // Las demás suites no deben heredar la base sin administradores
  await poolOwner.query(
    `DELETE FROM public.usuario WHERE username LIKE 'test\\_qa03\\_%' ESCAPE '\\'`,
  );
  await poolOwner.query(
    `UPDATE public.usuario SET activo = true WHERE id = ANY($1::int[])`,
    [adminsPrevios],
  );
  await cerrarPools();
});

describe("cambio de rol", () => {
  it("una Directora no puede degradar al único Administrador", async () => {
    const admin = await crear("admin", rolAdmin);

    await expect(
      editarUsuario(directora, admin, { rol_id: rolEmpleado }),
    ).rejects.toBeInstanceOf(UltimoAdministradorError);
    expect((await rolYEstado(admin)).rol_id).toBe(rolAdmin);
  });

  it("con dos administradores sí se puede degradar a uno", async () => {
    const a = await crear("admin_a", rolAdmin);
    await crear("admin_b", rolAdmin);

    await editarUsuario(directora, a, { rol_id: rolEmpleado });
    expect((await rolYEstado(a)).rol_id).toBe(rolEmpleado);
  });

  it("editar al único administrador sin quitarle el rol está permitido", async () => {
    const admin = await crear("admin", rolAdmin);

    await editarUsuario(directora, admin, {
      rol_id: rolAdmin,
      nombre_completo: "Nombre Nuevo",
    });
    expect((await rolYEstado(admin)).rol_id).toBe(rolAdmin);
  });

  it("dos degradaciones simultáneas no dejan el sistema sin administradores", async () => {
    // Sin bloqueo, cada transacción vería al "otro" administrador todavía
    // activo y las dos pasarían la comprobación.
    const a = await crear("admin_a", rolAdmin);
    const b = await crear("admin_b", rolAdmin);

    const resultados = await Promise.allSettled([
      editarUsuario(directora, a, { rol_id: rolEmpleado }),
      editarUsuario(directora, b, { rol_id: rolEmpleado }),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === "rejected");
    expect((rechazo as PromiseRejectedResult).reason).toBeInstanceOf(
      UltimoAdministradorError,
    );
    const roles = [(await rolYEstado(a)).rol_id, (await rolYEstado(b)).rol_id];
    expect(roles).toContain(rolAdmin);
  });
});

describe("desactivación", () => {
  it("no se puede desactivar al único administrador", async () => {
    const admin = await crear("admin", rolAdmin);

    await expect(
      cambiarEstadoUsuario(directora, admin, false),
    ).rejects.toBeInstanceOf(UltimoAdministradorError);
    expect((await rolYEstado(admin)).activo).toBe(true);
  });

  it("desactivar a un empleado no depende de cuántos administradores haya", async () => {
    // Antes se contaban los administradores sin mirar el rol del objetivo: con
    // cero administradores activos no se podía desactivar a nadie.
    const empleado = await crear("empleado", rolEmpleado);

    await cambiarEstadoUsuario(directora, empleado, false);
    expect((await rolYEstado(empleado)).activo).toBe(false);
  });
});
