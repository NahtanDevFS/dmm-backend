import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { poolOwner, resetBaseDePruebas, cerrarPools } from "../helpers/bd.js";
import { crearUsuario, crearPersona } from "../helpers/fixtures.js";
import { registrarEntregaSchema } from "../../src/modules/entregas/entrega.schema.js";

// Programa de la entrega (migración 34).
//
// La cabecera guarda el programa al que se carga lo entregado. Un despacho lo
// hereda de su solicitud y una entrega directa lo elige quien la registra; esa
// regla vive en el esquema de entrada, y la base solo lo guarda.

let usuarioId: number;
let personaId: number;
let programaId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("entrega-programa");

  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa de entrega', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_entrega, public.entrega RESTART IDENTITY CASCADE`,
  );
  personaId = await crearPersona(usuarioId, { nombres: "Beneficiaria" });
});

afterAll(async () => {
  await cerrarPools();
});

async function programaDe(entregaId: number): Promise<number | null> {
  const { rows } = await poolOwner.query<{ programa_id: number | null }>(
    `SELECT programa_id FROM public.entrega WHERE id = $1`,
    [entregaId],
  );
  return rows[0].programa_id;
}

describe("fn_crear_entrega y el programa", () => {
  it("guarda el programa que recibe", async () => {
    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT public.fn_crear_entrega($1, $2, NULL, NULL, NULL, $3) AS id`,
      [personaId, usuarioId, programaId],
    );
    expect(await programaDe(rows[0].id)).toBe(programaId);
  });

  it("con cinco argumentos deja la entrega sin programa (préstamo directo)", async () => {
    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT public.fn_crear_entrega($1, $2, NULL, NULL, NULL) AS id`,
      [personaId, usuarioId],
    );
    expect(await programaDe(rows[0].id)).toBeNull();
  });

  it("rechaza un programa que no existe", async () => {
    await expect(
      poolOwner.query(
        `SELECT public.fn_crear_entrega($1, $2, NULL, NULL, NULL, 999999)`,
        [personaId, usuarioId],
      ),
    ).rejects.toMatchObject({ constraint: "fk_entrega_programa" });
  });
});

describe("esquema de registro de entrega", () => {
  const base = { persona_id: 1 };

  it("una entrega directa sin programa se rechaza", () => {
    const r = registrarEntregaSchema.safeParse({
      ...base,
      insumos: [{ insumo_id: 1, cantidad: 2 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.programa_id).toBeDefined();
    }
  });

  it("una entrega directa con programa pasa", () => {
    const r = registrarEntregaSchema.safeParse({
      ...base,
      programa_id: 3,
      insumos: [{ insumo_id: 1, cantidad: 2 }],
    });
    expect(r.success).toBe(true);
  });

  it("un despacho de solicitud no necesita programa: lo toma de ella", () => {
    const r = registrarEntregaSchema.safeParse({
      ...base,
      insumos: [{ insumo_id: 1, cantidad: 2, detalle_solicitud_id: 7 }],
    });
    expect(r.success).toBe(true);
  });
});
