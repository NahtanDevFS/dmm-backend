import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  poolApp,
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
} from "../helpers/bd.js";
import { crearUsuario } from "../helpers/fixtures.js";

/**
 * Verifica que el rol de la aplicacion siga sin poder hacer lo que la
 * migracion 12 le quito.
 *
 * Estas restricciones son invisibles hasta que fallan, y un GRANT de mas
 * "para que deje de dar problemas" las revierte sin que nadie lo note. Aqui
 * ese aflojamiento aparece como prueba en rojo.
 *
 * Todo lo que se espera que FALLE se ejerce con `poolApp` (rol dmm_app), no
 * con `poolOwner`: probarlo con el dueno no demostraria nada.
 */

let usuarioId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("permisos");
}, 60_000);

afterAll(async () => {
  await cerrarPools();
});

describe("la aplicacion no puede borrar fisicamente", () => {
  it("no puede borrar filas de negocio", async () => {
    // Todo el sistema usa borrado logico (activo = false); ningun DELETE es
    // legitimo. Revocarlo convierte un borrado accidental o inyectado en un
    // error de privilegios.
    await expect(
      poolApp.query(`DELETE FROM public.persona WHERE id = -1`),
    ).rejects.toThrow(/permiso denegado|permission denied/i);
  });

  it("no puede borrar sesiones", async () => {
    // Son evidencia de acceso: nunca se eliminan, ni siquiera al cerrar sesion.
    await expect(
      poolApp.query(`DELETE FROM public.sesion WHERE id = -1`),
    ).rejects.toThrow(/permiso denegado|permission denied/i);
  });

  it("no puede vaciar tablas", async () => {
    await expect(
      poolApp.query(`TRUNCATE TABLE public.persona`),
    ).rejects.toThrow();
  });
});

describe("la bitacora de auditoria es inalterable desde la aplicacion", () => {
  it("no puede insertar entradas a mano", async () => {
    // Si pudiera, alguien con la cadena de conexion podria fabricar evidencia.
    await expect(
      poolApp.query(
        `INSERT INTO public.auditoria_log
           (tabla_afectada, registro_id, tipo_accion_id)
         VALUES ('persona', 1, 1)`,
      ),
    ).rejects.toThrow(/permiso denegado|permission denied/i);
  });

  it("no puede modificar ni borrar entradas existentes", async () => {
    await expect(
      poolApp.query(`UPDATE public.auditoria_log SET tabla_afectada = 'x'`),
    ).rejects.toThrow(/permiso denegado|permission denied/i);

    await expect(
      poolApp.query(`DELETE FROM public.auditoria_log WHERE id = -1`),
    ).rejects.toThrow(/permiso denegado|permission denied/i);
  });

  it("si puede leerla, porque GET /api/auditoria la consulta", async () => {
    const { rows } = await poolApp.query(
      `SELECT count(*)::text AS n FROM public.auditoria_log`,
    );
    expect(rows[0]).toBeDefined();
  });

  /**
   * La pieza que hace que todo lo anterior no rompa el sistema:
   * `fn_auditoria` es SECURITY DEFINER, asi que el trigger escribe con los
   * privilegios del propietario aunque quien dispare la escritura sea dmm_app.
   *
   * Sin esto, revocarle INSERT sobre auditoria_log dejaria al sistema sin
   * poder escribir NADA.
   */
  it("el trigger si deja rastro, aunque escriba la aplicacion", async () => {
    const cliente = await poolApp.connect();
    let discapacidadId: number;

    try {
      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.usuario_id', $1, true)", [
        String(usuarioId),
      ]);
      const { rows } = await cliente.query<{ id: number }>(
        `INSERT INTO public.discapacidad (nombre, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`ZZ permisos ${Date.now()}`, usuarioId],
      );
      discapacidadId = rows[0].id;
      await cliente.query("COMMIT");
    } finally {
      cliente.release();
    }

    const { rows } = await poolOwner.query<{ usuario_id: number }>(
      `SELECT usuario_id FROM public.auditoria_log
       WHERE tabla_afectada = 'discapacidad' AND registro_id = $1`,
      [discapacidadId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].usuario_id).toBe(usuarioId);
  });
});

/**
 * Comprobaciones de DDL.
 *
 * Se consultan los catalogos de Postgres en vez de INTENTAR la operacion.
 * La primera version de este archivo hacia `DROP TABLE public.sesion`
 * esperando que fallara; cuando la proteccion NO estaba, el test no reporto
 * el problema: lo causo, y borro la tabla de la base de pruebas.
 *
 * Una prueba de seguridad no debe depender de que la proteccion funcione para
 * no hacer dano.
 *
 * Es importante mirar la PROPIEDAD y no solo los privilegios: el dueno de una
 * tabla puede hacer DROP, ALTER y DISABLE TRIGGER sin importar cuantos REVOKE
 * se le apliquen. `has_table_privilege` devuelve false para un dueno y aun asi
 * el dueno puede tirar la tabla, asi que verificar solo GRANTs da una falsa
 * sensacion de seguridad.
 */
describe("la aplicacion no puede alterar el esquema", () => {
  it("no es propietaria de ninguna tabla", async () => {
    const { rows } = await poolOwner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tableowner = 'dmm_app'
       ORDER BY tablename`,
    );

    expect(
      rows.map((r) => r.tablename),
      "dmm_app es dueño de estas tablas y puede hacerles DROP/ALTER pese a los " +
        "REVOKE. Corrija con: ALTER TABLE public.<tabla> OWNER TO <dueño>;",
    ).toEqual([]);
  });

  it("no puede crear objetos en el esquema public", async () => {
    const { rows } = await poolOwner.query<{ puede_crear: boolean }>(
      `SELECT has_schema_privilege('dmm_app', 'public', 'CREATE') AS puede_crear`,
    );

    expect(
      rows[0].puede_crear,
      "dmm_app puede crear objetos en public. Corrija con: " +
        "REVOKE CREATE ON SCHEMA public FROM dmm_app;",
    ).toBe(false);
  });

  it("no puede desactivar los triggers de auditoria", async () => {
    // Sin esta restriccion, quien tenga la cadena de conexion podria apagar la
    // auditoria, operar sin rastro y volver a encenderla. Esta si se ejerce de
    // verdad porque no es destructiva: o falla, o se revierte con el ROLLBACK.
    const cliente = await poolApp.connect();
    try {
      await cliente.query("BEGIN");
      await expect(
        cliente.query(`ALTER TABLE public.persona DISABLE TRIGGER ALL`),
      ).rejects.toThrow();
    } finally {
      await cliente.query("ROLLBACK").catch(() => {});
      cliente.release();
    }
  });

  it("no tiene privilegio de DELETE sobre ninguna tabla", async () => {
    // Barre TODAS las tablas, no solo las dos que se prueban arriba: una tabla
    // nueva con GRANT de mas aparece aqui.
    const { rows } = await poolOwner.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND has_table_privilege('dmm_app', schemaname || '.' || tablename, 'DELETE')
       ORDER BY tablename`,
    );

    expect(
      rows.map((r) => r.tablename),
      "El sistema usa borrado logico en todas partes: ninguna tabla necesita DELETE.",
    ).toEqual([]);
  });

  it("fn_auditoria sigue siendo SECURITY DEFINER", async () => {
    // Si alguien la recrea sin este atributo, auditoria_log deja de poder
    // escribirse y TODA escritura del sistema falla.
    const { rows } = await poolOwner.query<{
      prosecdef: boolean;
      config: string[] | null;
    }>(
      `SELECT prosecdef, proconfig AS config
       FROM pg_proc WHERE proname = 'fn_auditoria'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    // El search_path fijado es obligatorio en SECURITY DEFINER: sin el, la
    // funcion es un vector de escalada de privilegios.
    expect(rows[0].config?.join(",") ?? "").toMatch(/search_path/);
  });
});

describe("la aplicacion si puede operar con normalidad", () => {
  it("inserta y actualiza datos de negocio", async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.usuario_id', $1, true)", [
        String(usuarioId),
      ]);

      const { rows } = await cliente.query<{ id: number }>(
        `INSERT INTO public.discapacidad (nombre, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`ZZ operacion ${Date.now()}`, usuarioId],
      );

      // El borrado logico, que es como el sistema "elimina".
      await cliente.query(
        `UPDATE public.discapacidad SET activo = false WHERE id = $1`,
        [rows[0].id],
      );
      await cliente.query("COMMIT");

      expect(rows[0].id).toBeGreaterThan(0);
    } finally {
      cliente.release();
    }
  });

  it("puede ejecutar los procedimientos de negocio", async () => {
    // No debe fallar por privilegios. Que falle por argumentos es otra cosa.
    await expect(
      poolApp.query(`CALL public.sp_procesar_donacion_pendientes(-1, -1)`),
    ).resolves.toBeDefined();
  });
});
