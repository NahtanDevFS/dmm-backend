import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  levantarServidor,
  bajarServidor,
  sesionComo,
  pedir,
  type Sesion,
} from "../helpers/servidor.js";
import {
  resetBaseDePruebas,
  cerrarPools,
  poolOwner,
  idCatalogo,
} from "../helpers/bd.js";

// Las cuentas ADMINISTRADOR solo son visibles entre administradores (decisión
// funcional de QA-03). Para la Directora no existen: no se listan, su ficha
// responde 404 como un id inexistente, no puede modificarlas y tampoco puede
// asignar el rol ADMINISTRADOR a nadie.

let admin: Sesion;
let directora: Sesion;
let otroAdminId: number;
let empleadoId: number;
let rolAdmin: number;
let rolEmpleado: number;

async function crear(username: string, rolId: number): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.usuario (username, password_hash, rol_id, activo)
     VALUES ($1, 'x', $2, true) RETURNING id`,
    [username, rolId],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
  admin = await sesionComo("ADMINISTRADOR");
  directora = await sesionComo("DIRECTORA");
  rolAdmin = await idCatalogo("rol", "ADMINISTRADOR");
  rolEmpleado = await idCatalogo("rol", "EMPLEADO_DMM");
  otroAdminId = await crear("test_oculto_admin", rolAdmin);
  empleadoId = await crear("test_oculto_empleado", rolEmpleado);
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

const usernames = (cuerpo: { datos: { username: string }[] }) =>
  cuerpo.datos.map((u) => u.username);

describe("para la Directora", () => {
  it("el listado no incluye administradores", async () => {
    const r = await pedir("GET", "/api/usuarios?incluirInactivos=true&limite=100", directora);
    expect(r.status).toBe(200);
    expect(usernames(r.cuerpo)).toContain("test_oculto_empleado");
    expect(usernames(r.cuerpo)).not.toContain("test_oculto_admin");
    expect(usernames(r.cuerpo)).not.toContain(admin.username);
  });

  it("la lista de roles no ofrece ADMINISTRADOR", async () => {
    const r = await pedir("GET", "/api/roles", directora);
    expect(r.status).toBe(200);
    expect(r.cuerpo.map((x: { nombre: string }) => x.nombre)).not.toContain(
      "ADMINISTRADOR",
    );
  });

  it("un administrador responde 404, igual que un id inexistente", async () => {
    const oculto = await pedir("GET", `/api/usuarios/${otroAdminId}`, directora);
    const inexistente = await pedir("GET", "/api/usuarios/999999", directora);
    expect(oculto.status).toBe(404);
    expect(oculto.cuerpo).toEqual(inexistente.cuerpo);
  });

  it("no puede editar, desactivar ni restablecer la contraseña de un administrador", async () => {
    const ruta = `/api/usuarios/${otroAdminId}`;
    expect((await pedir("PATCH", ruta, directora, { rol_id: rolEmpleado })).status).toBe(404);
    expect((await pedir("PATCH", `${ruta}/desactivar`, directora)).status).toBe(404);
    expect(
      (await pedir("PATCH", `${ruta}/password`, directora, { password_nueva: "Nueva12345" })).status,
    ).toBe(404);

    const { rows } = await poolOwner.query<{ rol_id: number; activo: boolean }>(
      `SELECT rol_id, activo FROM public.usuario WHERE id = $1`,
      [otroAdminId],
    );
    expect(rows[0]).toEqual({ rol_id: rolAdmin, activo: true });
  });

  it("no puede asignar el rol ADMINISTRADOR", async () => {
    const creado = await pedir("POST", "/api/usuarios", directora, {
      username: "test_oculto_nuevo",
      password: "Prueba12345",
      rol_id: rolAdmin,
      nombre_completo: "Intento de administrador",
    });
    expect(creado.status).toBe(403);

    const promovido = await pedir("PATCH", `/api/usuarios/${empleadoId}`, directora, {
      rol_id: rolAdmin,
    });
    expect(promovido.status).toBe(403);
  });

  it("sigue gestionando a los demás usuarios", async () => {
    const r = await pedir("PATCH", `/api/usuarios/${empleadoId}`, directora, {
      nombre_completo: "Empleada Editada",
    });
    expect(r.status).toBe(200);
  });
});

describe("para un Administrador", () => {
  it("ve a los demás administradores y el rol ADMINISTRADOR", async () => {
    const lista = await pedir("GET", "/api/usuarios?limite=100", admin);
    expect(usernames(lista.cuerpo)).toContain("test_oculto_admin");

    const ficha = await pedir("GET", `/api/usuarios/${otroAdminId}`, admin);
    expect(ficha.status).toBe(200);

    const roles = await pedir("GET", "/api/roles", admin);
    expect(roles.cuerpo.map((x: { nombre: string }) => x.nombre)).toContain(
      "ADMINISTRADOR",
    );
  });
});

describe("auditoría", () => {
  // La Directora no ve lo técnico: lo que toca a los administradores (lo que
  // hicieron, los cambios a sus cuentas, sus sesiones) ni lo que no tiene
  // autor (migraciones, SQL manual). El administrador lo ve todo. Los registros
  // no se borran: es solo un filtro de lectura.
  const tablas = (cuerpo: { datos: { tabla_afectada: string; registro_id: number; usuario_id: number | null }[] }) =>
    cuerpo.datos;

  let programaAdmin: number;
  let programaDirectora: number;

  beforeAll(async () => {
    const a = await pedir("POST", "/api/programas", admin, { nombre: "Programa del admin (auditoría)" });
    const d = await pedir("POST", "/api/programas", directora, { nombre: "Programa de la directora (auditoría)" });
    expect(a.status).toBe(201);
    expect(d.status).toBe(201);
    programaAdmin = a.cuerpo.id;
    programaDirectora = d.cuerpo.id;

    // Un cambio de la Directora sobre la cuenta del empleado: con autor
    const e = await pedir("PATCH", `/api/usuarios/${empleadoId}`, directora, {
      nombre_completo: "Empleado editado por la directora",
    });
    expect(e.status).toBe(200);
  });

  it("la Directora no ve lo que hizo un administrador, pero sí lo suyo", async () => {
    const r = await pedir("GET", "/api/auditoria?tabla=programa&limite=100", directora);
    expect(r.status).toBe(200);
    const ids = tablas(r.cuerpo).map((f) => f.registro_id);
    expect(ids).toContain(programaDirectora);
    expect(ids).not.toContain(programaAdmin);
    expect(tablas(r.cuerpo).some((f) => f.usuario_id === admin.usuarioId)).toBe(false);
  });

  it("el administrador sigue viéndolo todo", async () => {
    const r = await pedir("GET", "/api/auditoria?tabla=programa&limite=100", admin);
    const ids = tablas(r.cuerpo).map((f) => f.registro_id);
    expect(ids).toContain(programaAdmin);
    expect(ids).toContain(programaDirectora);
  });

  it("la Directora no ve los cambios a cuentas de administrador ni sus sesiones", async () => {
    const usuarios = await pedir("GET", "/api/auditoria?tabla=usuario&limite=100", directora);
    const idsUsuario = tablas(usuarios.cuerpo).map((f) => f.registro_id);
    expect(idsUsuario).toContain(empleadoId);
    expect(idsUsuario).not.toContain(otroAdminId);
    expect(idsUsuario).not.toContain(admin.usuarioId);

    const historial = await pedir("GET", `/api/auditoria/usuario/${otroAdminId}`, directora);
    expect(historial.status).toBe(200);
    expect(historial.cuerpo.total).toBe(0);

    const sesiones = await pedir("GET", "/api/auditoria?tabla=sesion&limite=100", directora);
    const deAdmin = tablas(sesiones.cuerpo).filter((f) => {
      const v = (f as unknown as { valores_nuevos: { usuario_id?: number } | null }).valores_nuevos;
      return v?.usuario_id === admin.usuarioId;
    });
    expect(deAdmin).toHaveLength(0);
  });

  it("la Directora no ve lo que no tiene autor (migraciones, SQL manual)", async () => {
    // Un cambio hecho por fuera de la aplicación, como una migración
    const { rows } = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.programa (nombre) VALUES ('Programa cargado por SQL') RETURNING id`,
    );
    const porSql = rows[0].id;

    const directa = await pedir("GET", "/api/auditoria?tabla=programa&limite=100", directora);
    expect(tablas(directa.cuerpo).map((f) => f.registro_id)).not.toContain(porSql);
    expect(tablas(directa.cuerpo).some((f) => f.usuario_id === null)).toBe(false);

    const delAdmin = await pedir("GET", "/api/auditoria?tabla=programa&limite=100", admin);
    expect(tablas(delAdmin.cuerpo).map((f) => f.registro_id)).toContain(porSql);
  });

  it("el administrador sí ve el historial de otra cuenta de administrador", async () => {
    const historial = await pedir("GET", `/api/auditoria/usuario/${otroAdminId}`, admin);
    expect(historial.cuerpo.total).toBeGreaterThan(0);
  });
});
