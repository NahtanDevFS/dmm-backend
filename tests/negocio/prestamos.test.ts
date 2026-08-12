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
  stockDisponible,
  enDias,
  type InsumoCreado,
} from "../helpers/fixtures.js";

/**
 * Contratos de prestamo de equipo (sillas de ruedas, muletas, andadores).
 *
 * Dos reglas estructurales sostienen todo el modulo:
 *
 *  1. Un contrato nace de una entrega fisica O es la renovacion de otro, nunca
 *     ambas cosas ni ninguna (`contrato_origen_check`).
 *  2. La cadena de renovaciones es LINEAL: un contrato admite una sola
 *     renovacion (`contrato_prestamo_anterior_unico_key`).
 *
 * De ahi se sigue lo mas delicado: solo el contrato RAIZ tiene
 * `detalle_entrega_id`, asi que `sp_registrar_devolucion_prestamo` solo opera
 * sobre el, y el backend debe resolver la raiz antes de invocarlo. Si alguien
 * llamara al SP con el ultimo contrato de la cadena, fallaria.
 */

let usuarioId: number;
let personaId: number;
let estadoVigente: number;
let estadoExtendido: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("prestamos");
  estadoVigente = await idCatalogo("estado_contrato_prestamo", "VIGENTE");
  estadoExtendido = await idCatalogo("estado_contrato_prestamo", "EXTENDIDO");
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.multa_prestamo, public.contrato_prestamo,
                    public.detalle_entrega, public.entrega,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote
     RESTART IDENTITY CASCADE`,
  );
  personaId = await crearPersona(usuarioId, { nombres: "Prestataria" });
});

afterAll(async () => {
  await cerrarPools();
});

/** Entrega fisica del equipo, de la que colgara el contrato raiz. */
async function entregarEquipo(
  insumo: InsumoCreado,
  cantidad = 1,
): Promise<number> {
  await poolOwner.query(
    `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
    [null, personaId, insumo.insumoId, cantidad, usuarioId, null, null, null],
  );
  const { rows } = await poolOwner.query<{ id: number }>(
    `SELECT id FROM public.detalle_entrega ORDER BY id DESC LIMIT 1`,
  );
  return rows[0].id;
}

async function crearContratoRaiz(
  detalleEntregaId: number,
  diasPlazo = 30,
): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.contrato_prestamo
       (detalle_entrega_id, fecha_devolucion_pactada, estado_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [detalleEntregaId, enDias(diasPlazo), estadoVigente, usuarioId],
  );
  return rows[0].id;
}

async function renovar(contratoAnteriorId: number): Promise<number> {
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.contrato_prestamo
       (contrato_anterior_id, fecha_devolucion_pactada, estado_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [contratoAnteriorId, enDias(60), estadoVigente, usuarioId],
  );
  await poolOwner.query(
    `UPDATE public.contrato_prestamo SET estado_id = $1 WHERE id = $2`,
    [estadoExtendido, contratoAnteriorId],
  );
  return rows[0].id;
}

describe("origen del contrato", () => {
  it("acepta un contrato nacido de una entrega", async () => {
    const insumo = await crearInsumo(usuarioId, { nombre: "Silla de ruedas" });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalle = await entregarEquipo(insumo);

    const contrato = await crearContratoRaiz(detalle);
    expect(contrato).toBeGreaterThan(0);
  });

  it("rechaza un contrato sin entrega y sin contrato anterior", async () => {
    // Un contrato huerfano no corresponde a ningun equipo real.
    await expect(
      poolOwner.query(
        `INSERT INTO public.contrato_prestamo
           (fecha_devolucion_pactada, estado_id, created_by)
         VALUES ($1, $2, $3)`,
        [enDias(30), estadoVigente, usuarioId],
      ),
    ).rejects.toThrow();
  });

  it("rechaza un contrato que sea entrega Y renovacion a la vez", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalle = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalle);

    const otraEntrega = await entregarEquipo(insumo);
    await expect(
      poolOwner.query(
        `INSERT INTO public.contrato_prestamo
           (detalle_entrega_id, contrato_anterior_id, fecha_devolucion_pactada,
            estado_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [otraEntrega, raiz, enDias(30), estadoVigente, usuarioId],
      ),
    ).rejects.toThrow();
  });

  it("no permite dos contratos sobre la misma entrega", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalle = await entregarEquipo(insumo);
    await crearContratoRaiz(detalle);

    await expect(crearContratoRaiz(detalle)).rejects.toThrow();
  });

  it("exige que la devolucion pactada no sea anterior al inicio", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalle = await entregarEquipo(insumo);

    await expect(crearContratoRaiz(detalle, -10)).rejects.toThrow();
  });
});

describe("cadena de renovaciones", () => {
  it("permite renovar un contrato y deja el anterior EXTENDIDO", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));

    const renovacion = await renovar(raiz);

    const { rows } = await poolOwner.query<{ nombre: string }>(
      `SELECT e.nombre FROM public.contrato_prestamo cp
       JOIN public.estado_contrato_prestamo e ON e.id = cp.estado_id
       WHERE cp.id = $1`,
      [raiz],
    );
    expect(rows[0].nombre).toBe("EXTENDIDO");
    expect(renovacion).toBeGreaterThan(raiz);
  });

  it("no admite dos renovaciones del mismo contrato", async () => {
    // La cadena es lineal, no un arbol: si un contrato pudiera renovarse dos
    // veces, habria dos contratos vigentes por un solo equipo fisico.
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));

    await renovar(raiz);
    await expect(renovar(raiz)).rejects.toThrow();
  });

  it("permite encadenar renovaciones sucesivas", async () => {
    // Renovar la renovacion si es valido: lo prohibido es ramificar.
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));

    const segunda = await renovar(raiz);
    const tercera = await renovar(segunda);

    expect(tercera).toBeGreaterThan(segunda);
  });

  it("la renovacion no tiene entrega fisica propia", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));
    const renovacion = await renovar(raiz);

    const { rows } = await poolOwner.query<{
      detalle_entrega_id: number | null;
    }>(
      `SELECT detalle_entrega_id FROM public.contrato_prestamo WHERE id = $1`,
      [renovacion],
    );
    // Es la razon por la que la devolucion debe resolver la raiz.
    expect(rows[0].detalle_entrega_id).toBeNull();
  });

  it("resuelve la raiz desde cualquier eslabon de la cadena", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));
    const segunda = await renovar(raiz);
    const tercera = await renovar(segunda);

    // Mismo CTE recursivo que usa contrato.repository.ts.
    const { rows } = await poolOwner.query<{ raiz_id: number }>(
      `WITH RECURSIVE hacia_atras AS (
         SELECT id, contrato_anterior_id, detalle_entrega_id
         FROM public.contrato_prestamo WHERE id = $1
         UNION
         SELECT cp.id, cp.contrato_anterior_id, cp.detalle_entrega_id
         FROM public.contrato_prestamo cp
         JOIN hacia_atras h ON cp.id = h.contrato_anterior_id
       )
       SELECT id AS raiz_id FROM hacia_atras WHERE detalle_entrega_id IS NOT NULL`,
      [tercera],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].raiz_id).toBe(raiz);
  });
});

describe("devolucion del equipo", () => {
  it("devuelve el equipo al lote de origen y cierra el contrato", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));

    expect(await stockDisponible(lote.loteId)).toBe(2);

    await poolOwner.query(
      `CALL public.sp_registrar_devolucion_prestamo($1, $2)`,
      [raiz, usuarioId],
    );

    expect(await stockDisponible(lote.loteId)).toBe(3);

    const { rows } = await poolOwner.query<{
      nombre: string;
      fecha_devolucion_real: Date | null;
    }>(
      `SELECT e.nombre, cp.fecha_devolucion_real
       FROM public.contrato_prestamo cp
       JOIN public.estado_contrato_prestamo e ON e.id = cp.estado_id
       WHERE cp.id = $1`,
      [raiz],
    );
    expect(rows[0].nombre).toBe("DEVUELTO");
    expect(rows[0].fecha_devolucion_real).not.toBeNull();
  });

  it("no se puede invocar sobre una renovacion", async () => {
    // Documenta por que el backend resuelve la raiz: llamar al SP con el
    // ultimo contrato de la cadena falla.
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));
    const renovacion = await renovar(raiz);

    await expect(
      poolOwner.query(`CALL public.sp_registrar_devolucion_prestamo($1, $2)`, [
        renovacion,
        usuarioId,
      ]),
    ).rejects.toThrow(/renovaci[oó]n sin entrega f[ií]sica propia|no existe/i);
  });

  it("no permite registrar dos veces la misma devolucion", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));

    await poolOwner.query(
      `CALL public.sp_registrar_devolucion_prestamo($1, $2)`,
      [raiz, usuarioId],
    );
    // Sin esta guarda el equipo se duplicaria en el inventario.
    await expect(
      poolOwner.query(`CALL public.sp_registrar_devolucion_prestamo($1, $2)`, [
        raiz,
        usuarioId,
      ]),
    ).rejects.toThrow(/ya tiene registrada una devoluci[oó]n/i);

    expect(await stockDisponible(lote.loteId)).toBe(3);
  });

  it("rechaza la devolucion con un usuario inexistente", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));

    await expect(
      poolOwner.query(
        `CALL public.sp_registrar_devolucion_prestamo($1, -999)`,
        [raiz],
      ),
    ).rejects.toThrow(/usuario .* no existe/i);
  });

  it("conserva la entrega como historial al devolver", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalle = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalle);

    await poolOwner.query(
      `CALL public.sp_registrar_devolucion_prestamo($1, $2)`,
      [raiz, usuarioId],
    );

    // Devolver no anula la entrega: quedo constancia de que la persona lo tuvo.
    const { rows } = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.detalle_entrega WHERE id = $1`,
      [detalle],
    );
    expect(rows[0].activo).toBe(true);
  });
});

describe("multas", () => {
  it("registra una multa sobre un contrato", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));
    const tipoId = await idCatalogo(
      "tipo_multa_prestamo",
      "RETRASO_DEVOLUCION",
    );

    const { rows } = await poolOwner.query<{ id: number; monto: string }>(
      `INSERT INTO public.multa_prestamo
         (contrato_prestamo_id, tipo_multa_id, monto, created_by)
       VALUES ($1, $2, 50.00, $3) RETURNING id, monto`,
      [raiz, tipoId, usuarioId],
    );

    expect(Number(rows[0].monto)).toBe(50);
  });

  it("admite varias multas por contrato", async () => {
    // Un mismo prestamo puede acumular retraso y daño.
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));
    const retraso = await idCatalogo(
      "tipo_multa_prestamo",
      "RETRASO_DEVOLUCION",
    );
    const danado = await idCatalogo("tipo_multa_prestamo", "EQUIPO_DANADO");

    await poolOwner.query(
      `INSERT INTO public.multa_prestamo
         (contrato_prestamo_id, tipo_multa_id, monto, created_by)
       VALUES ($1, $2, 50.00, $4), ($1, $3, 100.00, $4)`,
      [raiz, retraso, danado, usuarioId],
    );

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.multa_prestamo
       WHERE contrato_prestamo_id = $1 AND activo = true`,
      [raiz],
    );
    expect(rows[0].n).toBe("2");
  });

  it("borra las multas en cascada al borrar el contrato", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const raiz = await crearContratoRaiz(await entregarEquipo(insumo));
    const tipoId = await idCatalogo(
      "tipo_multa_prestamo",
      "RETRASO_DEVOLUCION",
    );

    await poolOwner.query(
      `INSERT INTO public.multa_prestamo
         (contrato_prestamo_id, tipo_multa_id, monto, created_by)
       VALUES ($1, $2, 50.00, $3)`,
      [raiz, tipoId, usuarioId],
    );
    await poolOwner.query(
      `DELETE FROM public.contrato_prestamo WHERE id = $1`,
      [raiz],
    );

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.multa_prestamo
       WHERE contrato_prestamo_id = $1`,
      [raiz],
    );
    expect(rows[0].n).toBe("0");
  });
});
