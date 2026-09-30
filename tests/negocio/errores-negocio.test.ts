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
import {
  crearInsumo,
  crearLote,
  crearPersona,
  enDias,
} from "../helpers/fixtures.js";

// Reglas de negocio que la aplicación rechaza desde TypeScript.
//
// Se lanzaban como `new Error(...)` sin status, y el middleware las convertía
// en un 500 "Error interno del servidor": el usuario nunca veía por qué no se
// podía. Ahora son ErrorDeNegocio y llegan con su código y su mensaje. Se
// prueba por HTTP, que es donde se notaba el fallo.

let directora: Sesion;
let personaId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
  directora = await sesionComo("DIRECTORA");
  personaId = await crearPersona(directora.usuarioId, { nombres: "Errores Negocio" });
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

/** Presta una unidad de un equipo y devuelve el id del contrato. */
async function prestar(): Promise<number> {
  const insumo = await crearInsumo(directora.usuarioId, { categoriaPermitePrestamo: true });
  await crearLote(directora.usuarioId, insumo, { cantidad: 2 });
  await poolOwner.query(
    `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
    [null, personaId, insumo.insumoId, 1, directora.usuarioId, null, null, null],
  );
  const { rows: det } = await poolOwner.query<{ id: number }>(
    `SELECT id FROM public.detalle_entrega ORDER BY id DESC LIMIT 1`,
  );
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.contrato_prestamo
       (detalle_entrega_id, fecha_devolucion_pactada, estado_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [det[0].id, enDias(30), await idCatalogo("estado_contrato_prestamo", "VIGENTE"), directora.usuarioId],
  );
  return rows[0].id;
}

describe("préstamos", () => {
  it("anular un préstamo ya devuelto responde 409 con la explicación", async () => {
    const id = await prestar();
    await poolOwner.query(`CALL public.sp_registrar_devolucion_prestamo($1, $2)`, [id, directora.usuarioId]);

    const r = await pedir("POST", `/api/contratos/${id}/anular`, directora, { motivo: "Registrado por error" });

    expect(r.status).toBe(409);
    expect(r.cuerpo.message).toMatch(/ya tiene una devolución registrada/);
  });

  it("anular dos veces responde 409", async () => {
    const id = await prestar();
    expect((await pedir("POST", `/api/contratos/${id}/anular`, directora, { motivo: "Registrado por error" })).status).toBe(200);

    const r = await pedir("POST", `/api/contratos/${id}/anular`, directora, { motivo: "Otra vez" });
    expect(r.status).toBe(409);
    expect(r.cuerpo.message).toMatch(/ya está anulado/);
  });

  it("cerrar como no devuelto un préstamo anulado responde 409", async () => {
    const id = await prestar();
    await pedir("POST", `/api/contratos/${id}/anular`, directora, { motivo: "Registrado por error" });

    const r = await pedir("POST", `/api/contratos/${id}/no-devuelto`, directora, { motivo: "No respondió a las llamadas" });
    expect(r.status).toBe(409);
    expect(r.cuerpo.message).toMatch(/anulado/);
  });

  it("multar un préstamo anulado responde 409", async () => {
    const id = await prestar();
    await pedir("POST", `/api/contratos/${id}/anular`, directora, { motivo: "Registrado por error" });

    const r = await pedir("POST", `/api/contratos/${id}/multas`, directora, {
      tipo_multa_id: await idCatalogo("tipo_multa_prestamo", "ATRASO"),
      monto: 50,
    });
    expect(r.status).toBe(409);
    expect(r.cuerpo.message).toMatch(/anulado/);
  });
});

describe("solicitudes pedidas en una presentación", () => {
  async function solicitudEn(presentacionId: number, insumoId: number, cantidad: number) {
    const prog = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa errores', $1)
       ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
      [directora.usuarioId],
    );
    return pedir("POST", "/api/solicitudes", directora, {
      persona_id: personaId,
      programa_id: prog.rows[0].id,
      lineas: [{
        insumo_id: insumoId,
        presentacion_solicitud_id: presentacionId,
        cantidad_presentacion: cantidad,
        modalidad_solicitud_id: await idCatalogo("modalidad_solicitud", "DONACION"),
      }],
    });
  }

  async function presentacion(insumoId: number, factor: number, activo = true): Promise<number> {
    const u = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.unidad_medida (nombre, created_by) VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
      [`Unidad errores ${factor}`, directora.usuarioId],
    );
    const { rows } = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.presentacion_insumo
         (insumo_id, unidad_medida_id, es_default, unidades_por_presentacion, activo, created_by)
       VALUES ($1, $2, false, $3, $4, $5) RETURNING id`,
      [insumoId, u.rows[0].id, factor, activo, directora.usuarioId],
    );
    return rows[0].id;
  }

  it("con una presentación inactiva responde 400", async () => {
    const insumo = await crearInsumo(directora.usuarioId);
    const r = await solicitudEn(await presentacion(insumo.insumoId, 10, false), insumo.insumoId, 1);

    expect(r.status).toBe(400);
    expect(r.cuerpo.message).toMatch(/no existe o está inactiva/);
  });

  it("si lo pedido equivale a menos de una unidad responde 400", async () => {
    const insumo = await crearInsumo(directora.usuarioId);
    const r = await solicitudEn(await presentacion(insumo.insumoId, 0.25), insumo.insumoId, 1);

    expect(r.status).toBe(400);
    expect(r.cuerpo.message).toMatch(/menos de una unidad/);
  });
});

describe("formularios", () => {
  it("reordenar un campo desactivado responde 409", async () => {
    const f = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.formulario (nombre, created_by) VALUES ('Formulario errores', $1) RETURNING id`,
      [directora.usuarioId],
    );
    const tipo = await idCatalogo("tipo_dato_campo_formulario", "TEXTO_CORTO");
    const c = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.formulario_campo (formulario_id, etiqueta, tipo_dato_id, orden, activo, created_by)
       VALUES ($1, 'Campo apagado', $2, 1, false, $3) RETURNING id`,
      [f.rows[0].id, tipo, directora.usuarioId],
    );

    const r = await pedir("POST", `/api/formularios/campos/${c.rows[0].id}/mover`, directora, { direccion: "arriba" });
    expect(r.status).toBe(409);
    expect(r.cuerpo.message).toMatch(/desactivado no se puede reordenar/);
  });

  it("reordenar un campo que no existe responde 404", async () => {
    const r = await pedir("POST", "/api/formularios/campos/999999/mover", directora, { direccion: "abajo" });
    expect(r.status).toBe(404);
  });
});
