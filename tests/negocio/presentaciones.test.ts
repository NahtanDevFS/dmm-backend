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
import { crearInsumo, crearPersona } from "../helpers/fixtures.js";

// Factor de conversión de una presentación (unidades_por_presentacion).
//
// El controlador validaba el factor pero no se lo pasaba al repositorio, así
// que toda presentación nueva quedaba en 1: una "Caja de 100" valía una unidad
// y una solicitud de 2 cajas se registraba como 2 unidades. Se prueba por HTTP
// para cubrir el tramo controlador → repositorio, que es donde se perdía.

let directora: Sesion;
let unidadCajaId: number;

async function unidad(nombre: string): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.unidad_medida (nombre, created_by) VALUES ($1, $2)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [nombre, directora.usuarioId],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
  directora = await sesionComo("DIRECTORA");
  unidadCajaId = await unidad("Caja de prueba");
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

describe("crear una presentación", () => {
  it("guarda el factor indicado", async () => {
    const insumo = await crearInsumo(directora.usuarioId);

    const r = await pedir("POST", `/api/insumos/${insumo.insumoId}/presentaciones`, directora, {
      unidad_medida_id: unidadCajaId,
      unidades_por_presentacion: 100,
    });

    expect(r.status).toBe(201);
    expect(Number(r.cuerpo.unidades_por_presentacion)).toBe(100);
  });

  it("sin factor, la presentación vale 1", async () => {
    const insumo = await crearInsumo(directora.usuarioId);

    const r = await pedir("POST", `/api/insumos/${insumo.insumoId}/presentaciones`, directora, {
      unidad_medida_id: unidadCajaId,
    });

    expect(r.status).toBe(201);
    expect(Number(r.cuerpo.unidades_por_presentacion)).toBe(1);
  });

  it("la predeterminada vale 1 aunque se mande otro factor", async () => {
    // Expresa la unidad base: su factor es 1 por definición.
    const insumo = await crearInsumo(directora.usuarioId);

    const r = await pedir("POST", `/api/insumos/${insumo.insumoId}/presentaciones`, directora, {
      unidad_medida_id: unidadCajaId,
      es_default: true,
      unidades_por_presentacion: 100,
    });

    expect(r.status).toBe(201);
    expect(r.cuerpo.es_default).toBe(true);
    expect(Number(r.cuerpo.unidades_por_presentacion)).toBe(1);
  });
});

describe("pedir en una presentación", () => {
  it("2 cajas de 100 se registran como 200 unidades", async () => {
    const insumo = await crearInsumo(directora.usuarioId);
    const caja = await pedir("POST", `/api/insumos/${insumo.insumoId}/presentaciones`, directora, {
      unidad_medida_id: unidadCajaId,
      unidades_por_presentacion: 100,
    });
    expect(caja.status).toBe(201);

    const personaId = await crearPersona(directora.usuarioId, { nombres: "Pide Cajas" });
    const prog = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa presentaciones', $1)
       ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
      [directora.usuarioId],
    );

    const s = await pedir("POST", "/api/solicitudes", directora, {
      persona_id: personaId,
      programa_id: prog.rows[0].id,
      lineas: [
        {
          insumo_id: insumo.insumoId,
          presentacion_solicitud_id: caja.cuerpo.id,
          cantidad_presentacion: 2,
          modalidad_solicitud_id: await idCatalogo("modalidad_solicitud", "DONACION"),
        },
      ],
    });
    expect(s.status).toBe(201);

    const { rows } = await poolOwner.query<{ cantidad_requerida: number }>(
      `SELECT cantidad_requerida FROM public.detalle_solicitud_apoyo WHERE solicitud_id = $1`,
      [s.cuerpo.solicitud.id],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].cantidad_requerida)).toBe(200);
  });
});
