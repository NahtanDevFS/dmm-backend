import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
  idCatalogo,
} from "../helpers/bd.js";
import {
  crearUsuario,
  crearPersona,
  crearInsumo,
  crearLote,
  type InsumoCreado,
} from "../helpers/fixtures.js";

// Estado de la cabecera cuando hay líneas canceladas (migración 33).
//
// fn_recalcular_cabecera_solicitud cerraba como ENTREGADA toda solicitud con
// sus líneas entregadas o canceladas, aunque no se hubiera entregado nada: una
// solicitud cuya única línea se canceló quedaba «ENTREGADA». Y una línea
// cancelada contaba como avance (PENDIENTE_ENTREGA_PARCIAL).

let usuarioId: number;
let programaId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("cabecera_cancelada");
  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa cabecera', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

afterAll(async () => {
  await cerrarPools();
});

/** Solicitud con una línea por insumo; devuelve sus ids. */
async function solicitudCon(
  ...insumos: InsumoCreado[]
): Promise<{ solicitud: number; persona: number; lineas: number[] }> {
  const persona = await crearPersona(usuarioId, { nombres: "Cabecera" });
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.solicitud_apoyo (persona_id, programa_id, estado_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [persona, programaId, await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ADQUISICION"), usuarioId],
  );
  const lineas: number[] = [];
  for (const insumo of insumos) {
    const linea = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.detalle_solicitud_apoyo
         (solicitud_id, insumo_id, cantidad_requerida, estado_id, modalidad_solicitud_id, created_by)
       VALUES ($1, $2, 2, 1, $3, $4) RETURNING id`,
      [rows[0].id, insumo.insumoId, await idCatalogo("modalidad_solicitud", "DONACION"), usuarioId],
    );
    lineas.push(linea.rows[0].id);
  }
  return { solicitud: rows[0].id, persona, lineas };
}

async function cancelar(linea: number): Promise<void> {
  await poolOwner.query(`CALL public.sp_cancelar_linea_solicitud($1, $2, 'Ya no la necesita')`, [linea, usuarioId]);
}

async function entregar(linea: number, persona: number, insumo: InsumoCreado, cantidad: number): Promise<void> {
  await poolOwner.query(`CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`, [
    linea, persona, insumo.insumoId, cantidad, usuarioId, null, null, null,
  ]);
}

async function estadoSolicitud(id: number): Promise<string> {
  const { rows } = await poolOwner.query<{ nombre: string }>(
    `SELECT e.nombre FROM public.solicitud_apoyo s
     JOIN public.estado_solicitud_apoyo e ON e.id = s.estado_id WHERE s.id = $1`,
    [id],
  );
  return rows[0].nombre;
}

describe("cabecera de la solicitud con líneas canceladas", () => {
  it("todo cancelado: CANCELADA, no ENTREGADA", async () => {
    const insumo = await crearInsumo(usuarioId);
    const s = await solicitudCon(insumo);

    await cancelar(s.lineas[0]);

    expect(await estadoSolicitud(s.solicitud)).toBe("CANCELADA");
  });

  it("una entregada y otra cancelada: ENTREGADA", async () => {
    const a = await crearInsumo(usuarioId);
    const b = await crearInsumo(usuarioId);
    await crearLote(usuarioId, a, { cantidad: 5 });
    const s = await solicitudCon(a, b);

    await entregar(s.lineas[0], s.persona, a, 2);
    await cancelar(s.lineas[1]);

    expect(await estadoSolicitud(s.solicitud)).toBe("ENTREGADA");
  });

  it("entregada en parte y luego cancelada: ENTREGADA, porque algo recibió", async () => {
    const a = await crearInsumo(usuarioId);
    await crearLote(usuarioId, a, { cantidad: 1 });
    const s = await solicitudCon(a);

    await entregar(s.lineas[0], s.persona, a, 1);
    expect(await estadoSolicitud(s.solicitud)).toBe("PENDIENTE_ENTREGA_PARCIAL");
    await cancelar(s.lineas[0]);

    expect(await estadoSolicitud(s.solicitud)).toBe("ENTREGADA");
  });

  it("una cancelada no cuenta como avance: con lo demás sin stock, sigue en PENDIENTE_ADQUISICION", async () => {
    const a = await crearInsumo(usuarioId);
    const b = await crearInsumo(usuarioId);
    const s = await solicitudCon(a, b);

    await cancelar(s.lineas[0]);

    expect(await estadoSolicitud(s.solicitud)).toBe("PENDIENTE_ADQUISICION");
  });
});
