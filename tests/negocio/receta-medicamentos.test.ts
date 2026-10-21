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
import { crearInsumo, crearLote, crearPersona } from "../helpers/fixtures.js";
import { CATEGORIAS_CON_RECETA } from "../../src/config/receta.js";

// Receta médica para entregar medicamentos (config/receta.ts).
//
// Antes no se exigía en ningún lado: la entrega directa la pedía en un paso
// posterior y opcional, y de 5 entregas de medicamentos en desarrollo solo 1
// la tenía. Qué categoría la exige va por id en la configuración (por omisión
// la 1, Medicamentos), sin tocar la base: el backend lo expone como
// `requiere_receta` en los insumos y marca `falta_receta` en las entregas.

let directora: Sesion;
let medicamento: number;
let alimento: number;
let personaId: number;
let tipoReceta: number;

async function entregar(insumoId: number): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `SELECT public.fn_crear_entrega($1, $2) AS id`,
    [personaId, directora.usuarioId],
  );
  await poolOwner.query(`CALL public.sp_agregar_insumo_entrega($1, $2, 1)`, [
    rows[0].id,
    insumoId,
  ]);
  return rows[0].id;
}

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
  directora = await sesionComo("DIRECTORA");
  expect(CATEGORIAS_CON_RECETA).toEqual([1]);

  // La categoría 1 hace de «Medicamentos», como en desarrollo y producción
  await poolOwner.query(
    `INSERT INTO public.categoria_insumo (id, nombre, created_by)
     VALUES (1, 'Medicamentos (prueba)', $1)
     ON CONFLICT (id) DO NOTHING`,
    [directora.usuarioId],
  );
  await poolOwner.query(
    `SELECT setval(pg_get_serial_sequence('public.categoria_insumo', 'id'),
                   GREATEST((SELECT max(id) FROM public.categoria_insumo), 1))`,
  );

  const med = await crearInsumo(directora.usuarioId, { nombre: "Amoxicilina de prueba" });
  await poolOwner.query(`UPDATE public.insumo SET categoria_id = 1 WHERE id = $1`, [
    med.insumoId,
  ]);
  const ali = await crearInsumo(directora.usuarioId, { nombre: "Arroz de prueba" });
  await poolOwner.query(
    `UPDATE public.insumo SET categoria_id = (
       SELECT id FROM public.categoria_insumo WHERE id <> 1 ORDER BY id LIMIT 1)
     WHERE id = $1`,
    [ali.insumoId],
  );
  medicamento = med.insumoId;
  alimento = ali.insumoId;
  await crearLote(directora.usuarioId, med, { cantidad: 10 });
  await crearLote(directora.usuarioId, ali, { cantidad: 10 });
  personaId = await crearPersona(directora.usuarioId);
  tipoReceta = await idCatalogo("tipo_evidencia_entrega", "RECETA_MEDICA");
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

describe("qué insumos exigen receta", () => {
  it("el listado de insumos lo marca según la categoría", async () => {
    const r = await pedir("GET", "/api/insumos?limite=200", directora);
    const porId = new Map(
      r.cuerpo.datos.map((i: { id: number; requiere_receta: boolean }) => [i.id, i.requiere_receta]),
    );
    expect(porId.get(medicamento)).toBe(true);
    expect(porId.get(alimento)).toBe(false);
  });

  it("también la ficha del insumo y el listado de stock", async () => {
    const ficha = await pedir("GET", `/api/insumos/${medicamento}`, directora);
    expect(ficha.cuerpo.requiere_receta).toBe(true);

    const stock = await pedir("GET", "/api/insumos/stock", directora);
    const fila = stock.cuerpo.find((s: { insumo_id: number }) => s.insumo_id === alimento);
    expect(fila.requiere_receta).toBe(false);
  });
});

describe("entregas sin receta", () => {
  it("una entrega de medicamento sin receta queda marcada, en el listado y en la ficha", async () => {
    const id = await entregar(medicamento);

    const listado = await pedir("GET", "/api/entregas?limite=100", directora);
    const fila = listado.cuerpo.datos.find((e: { id: number }) => e.id === id);
    expect(fila.falta_receta).toBe(true);

    const ficha = await pedir("GET", `/api/entregas/${id}`, directora);
    expect(ficha.cuerpo.falta_receta).toBe(true);
  });

  it("con la receta adjunta deja de estar marcada", async () => {
    const id = await entregar(medicamento);
    await poolOwner.query(
      `INSERT INTO public.evidencia_entrega (entrega_id, tipo_evidencia_id, ruta_archivo, created_by)
       VALUES ($1, $2, 'recetas/prueba.jpg', $3)`,
      [id, tipoReceta, directora.usuarioId],
    );

    const ficha = await pedir("GET", `/api/entregas/${id}`, directora);
    expect(ficha.cuerpo.falta_receta).toBe(false);
  });

  it("otra evidencia no cuenta como receta", async () => {
    const id = await entregar(medicamento);
    await poolOwner.query(
      `INSERT INTO public.evidencia_entrega (entrega_id, tipo_evidencia_id, ruta_archivo, created_by)
       VALUES ($1, $2, 'fotos/prueba.jpg', $3)`,
      [id, await idCatalogo("tipo_evidencia_entrega", "FORMULARIO_FIRMADO"), directora.usuarioId],
    );

    const ficha = await pedir("GET", `/api/entregas/${id}`, directora);
    expect(ficha.cuerpo.falta_receta).toBe(true);
  });

  it("una entrega sin medicamentos nunca se marca", async () => {
    const id = await entregar(alimento);
    const ficha = await pedir("GET", `/api/entregas/${id}`, directora);
    expect(ficha.cuerpo.falta_receta).toBe(false);
  });

  it("una entrega anulada no se marca", async () => {
    const id = await entregar(medicamento);
    await poolOwner.query(
      `CALL public.sp_desactivar_entrega($1, $2, 'Anulada en prueba')`,
      [id, directora.usuarioId],
    );
    const ficha = await pedir("GET", `/api/entregas/${id}`, directora);
    expect(ficha.cuerpo.falta_receta).toBe(false);
  });
});
