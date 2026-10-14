import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
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
import {
  poblacionPorPrograma,
  contarSolicitudesPendientesAprobacion,
} from "../../src/modules/panel/panel.repository.js";

// Hallazgos de QA del 13/10/2026 sobre Reportes e Inicio (migración 36).
//
//  - DEF-07: las entregas directas con programa salían «sin programa».
//  - DEF-12: el grupo etario usaba la edad de hoy, no la de la entrega.
//  - DEF-11: el stock por categoría sumaba litros con unidades.
//  - DEF-05: «Solicitudes pendientes» contaba líneas, no solicitudes.
//  - Personas por programa sumaba personas únicas entre meses.

let usuarioId: number;
let programaId: number;
const PROGRAMA = "Programa reportes 36";

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("reportes36");
  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ($1, $2)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [PROGRAMA, usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_entrega, public.entrega,
                    public.detalle_solicitud_apoyo, public.solicitud_apoyo,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote,
                    public.persona
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await cerrarPools();
});

/** Entrega directa (sin solicitud) con fecha y programa a elección */
async function entregaDirecta(
  personaId: number,
  insumo: InsumoCreado,
  fecha: string,
  conPrograma = true,
): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `SELECT public.fn_crear_entrega($1, $2, NULL, NULL, NULL, $3) AS id`,
    [personaId, usuarioId, conPrograma ? programaId : null],
  );
  await poolOwner.query(`CALL public.sp_agregar_insumo_entrega($1, $2, 1)`, [
    rows[0].id,
    insumo.insumoId,
  ]);
  await poolOwner.query(
    `UPDATE public.entrega SET fecha_entrega = $2 WHERE id = $1`,
    [rows[0].id, fecha],
  );
  return rows[0].id;
}

describe("DEF-07: programa de la entrega directa", () => {
  it("personas atendidas muestra el programa de la entrega directa", async () => {
    const persona = await crearPersona(usuarioId);
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await entregaDirecta(persona, insumo, "2026-09-10");

    const { rows } = await poolOwner.query<{ programa_nombre: string | null }>(
      `SELECT programa_nombre FROM public.v_reporte_personas_atendidas
       WHERE persona_id = $1`,
      [persona],
    );
    expect(rows.map((r) => r.programa_nombre)).toEqual([PROGRAMA]);
  });

  it("población beneficiada la cuenta en su programa", async () => {
    const persona = await crearPersona(usuarioId);
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await entregaDirecta(persona, insumo, "2026-09-10");

    const { rows } = await poolOwner.query<{ programa_nombre: string | null }>(
      `SELECT programa_nombre FROM public.v_reporte_poblacion_beneficiada`,
    );
    expect(rows.map((r) => r.programa_nombre)).toEqual([PROGRAMA]);
  });

  it("una entrega directa sin programa sigue sin programa", async () => {
    const persona = await crearPersona(usuarioId);
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await entregaDirecta(persona, insumo, "2026-09-10", false);

    const { rows } = await poolOwner.query<{ programa_nombre: string | null }>(
      `SELECT programa_nombre FROM public.v_reporte_personas_atendidas`,
    );
    expect(rows.map((r) => r.programa_nombre)).toEqual([null]);
  });
});

describe("DEF-12: grupo etario con la edad a la fecha de entrega", () => {
  it("quien tenía 64 al recibir cuenta como adulto aunque hoy tenga 65", async () => {
    // Cumple 65 entre la entrega (marzo) y hoy
    const persona = await crearPersona(usuarioId, {
      fechaNacimiento: "1961-05-20",
    });
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await entregaDirecta(persona, insumo, "2026-03-15");

    const { rows } = await poolOwner.query<{ grupo_etario: string }>(
      `SELECT grupo_etario FROM public.v_reporte_poblacion_beneficiada`,
    );
    expect(rows.map((r) => r.grupo_etario)).toEqual(["ADULTO"]);
  });

  it("quien era menor al recibir cuenta como menor aunque hoy sea adulto", async () => {
    const persona = await crearPersona(usuarioId, {
      fechaNacimiento: "2008-08-01",
    });
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await entregaDirecta(persona, insumo, "2026-02-01");

    const { rows } = await poolOwner.query<{ grupo_etario: string }>(
      `SELECT grupo_etario FROM public.v_reporte_poblacion_beneficiada`,
    );
    expect(rows.map((r) => r.grupo_etario)).toEqual(["MENOR"]);
  });
});

describe("DEF-11: stock por categoría sin mezclar unidades", () => {
  it("una fila por unidad dentro de la misma categoría", async () => {
    const enUnidades = await crearInsumo(usuarioId, { nombre: "Jabón en barra" });
    const enLitros = await crearInsumo(usuarioId, { nombre: "Cloro" });
    const litro = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.unidad_medida (nombre, created_by) VALUES ('Litro', $1)
       ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
      [usuarioId],
    );
    await poolOwner.query(
      `UPDATE public.insumo SET unidad_medida_base_id = $2 WHERE id = $1`,
      [enLitros.insumoId, litro.rows[0].id],
    );
    await poolOwner.query(
      `UPDATE public.presentacion_insumo SET unidad_medida_id = $2 WHERE id = $1`,
      [enLitros.presentacionId, litro.rows[0].id],
    );
    await crearLote(usuarioId, enUnidades, { cantidad: 5 });
    await crearLote(usuarioId, enLitros, { cantidad: 10 });

    const { rows } = await poolOwner.query<{
      unidad_nombre: string;
      unidades_totales_disponibles: number;
    }>(
      `SELECT unidad_nombre, unidades_totales_disponibles
       FROM public.v_reporte_stock_por_categoria
       WHERE categoria_id = $1 ORDER BY unidad_nombre`,
      [enUnidades.categoriaId],
    );
    expect(rows).toEqual([
      { unidad_nombre: "Litro", unidades_totales_disponibles: 10 },
      { unidad_nombre: "Unidad", unidades_totales_disponibles: 5 },
    ]);
  });
});

describe("Inicio", () => {
  it("personas por programa cuenta una vez a quien recibió en dos meses", async () => {
    const persona = await crearPersona(usuarioId);
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    await entregaDirecta(persona, insumo, "2026-09-10");
    await entregaDirecta(persona, insumo, "2026-10-02");

    expect(await poblacionPorPrograma("2026-09-01", "2026-10-31")).toEqual([
      { programa_nombre: PROGRAMA, personas_unicas_beneficiadas: 1 },
    ]);
  });

  it("solicitudes pendientes cuenta solicitudes, no líneas (DEF-05)", async () => {
    const persona = await crearPersona(usuarioId);
    const sol = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.solicitud_apoyo
         (persona_id, programa_id, estado_id, requiere_aprobacion, aprobada, created_by)
       VALUES ($1, $2, $3, true, false, $4) RETURNING id`,
      [
        persona,
        programaId,
        await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ADQUISICION"),
        usuarioId,
      ],
    );
    const donacion = await idCatalogo("modalidad_solicitud", "DONACION");
    for (const nombre of ["Primer insumo", "Segundo insumo"]) {
      const insumo = await crearInsumo(usuarioId, { nombre });
      await poolOwner.query(
        `INSERT INTO public.detalle_solicitud_apoyo
           (solicitud_id, insumo_id, cantidad_requerida, estado_id, modalidad_solicitud_id, created_by)
         VALUES ($1, $2, 1, 1, $3, $4)`,
        [sol.rows[0].id, insumo.insumoId, donacion, usuarioId],
      );
    }

    expect(await contarSolicitudesPendientesAprobacion()).toBe(1);
  });
});
