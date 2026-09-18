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
import {
  anularContratoPorError,
  cerrarContratoNoDevuelto,
} from "../../src/modules/prestamos/contrato.repository.js";

/**
 * Cierre de un contrato de préstamo por una vía distinta a la devolución
 * normal (migración 26): anulación por error de captura, o cierre porque el
 * equipo no volvió.
 *
 * A diferencia del resto de prestamos.test.ts, aquí se llama directo a las
 * funciones de contrato.repository.ts (no al SP vía poolOwner), porque esta
 * lógica vive en TypeScript, no en un procedimiento almacenado — así queda
 * ejercitado el código real de la aplicación. Internamente esas funciones
 * usan withUserTransaction, que toma el pool de la app (rol de mínimo
 * privilegio dmm_app) apuntando ya a la base de pruebas, igual que hace
 * with-user-transaction.test.ts.
 *
 * IMPORTANTE: para que estas pruebas encuentren el estado NO_DEVUELTO hace
 * falta que tests/helpers/bd.ts siembre ese valor en
 * estado_contrato_prestamo. Si esta suite falla con "No existe
 * estado_contrato_prestamo.nombre = 'NO_DEVUELTO'", revise que ese fix siga
 * aplicado ahí.
 *
 * No pude confirmar contra una base real que el rol dmm_app tenga UPDATE
 * sobre contrato_prestamo y multa_prestamo (el volcado no lo mostró de forma
 * legible). Si esta suite falla con un error de permisos en vez de uno de
 * negocio, ese es el primer sitio a revisar — sería el mismo tipo de
 * hallazgo que faltar NO_DEVUELTO en el seed: código correcto bloqueado por
 * un GRANT que no se actualizó junto con la migración 26.
 */

let usuarioId: number;
let personaId: number;
let estadoVigente: number;
let estadoNoDevuelto: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("prestamos_cierre");
  estadoVigente = await idCatalogo("estado_contrato_prestamo", "VIGENTE");
  estadoNoDevuelto = await idCatalogo(
    "estado_contrato_prestamo",
    "NO_DEVUELTO",
  );
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.multa_prestamo, public.contrato_prestamo,
                    public.detalle_entrega, public.entrega,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote
     RESTART IDENTITY CASCADE`,
  );
  personaId = await crearPersona(usuarioId, { nombres: "Prestataria Cierre" });
});

afterAll(async () => {
  await cerrarPools();
});

/** Entrega física del equipo, de la que colgará el contrato raíz. Mismo helper que prestamos.test.ts. */
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

async function crearMulta(
  contratoId: number,
  pagada: boolean,
): Promise<number> {
  const tipoId = await idCatalogo("tipo_multa_prestamo", "RETRASO_DEVOLUCION");
  // multa_prestamo_pago_coherente_check exige fecha_pago cuando pagada es
  // verdadero, y NULL cuando es falso: una multa no puede estar "pagada"
  // sin decir cuándo, ni tener fecha de pago sin estar marcada como pagada.
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.multa_prestamo
       (contrato_prestamo_id, tipo_multa_id, monto, pagada, fecha_pago, created_by)
     VALUES ($1, $2, 50.00, $3, $4, $5) RETURNING id`,
    [contratoId, tipoId, pagada, pagada ? new Date() : null, usuarioId],
  );
  return rows[0].id;
}

describe("anularContratoPorError", () => {
  it("anula el contrato y restaura el stock desactivando el renglón de entrega", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    const lote = await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    expect(await stockDisponible(lote.loteId)).toBe(2);

    await anularContratoPorError(usuarioId, raiz, "Registrado por error");

    expect(await stockDisponible(lote.loteId)).toBe(3);

    const { rows } = await poolOwner.query<{
      activo: boolean;
      motivo_cierre: string | null;
    }>(
      `SELECT activo, motivo_cierre FROM public.contrato_prestamo WHERE id = $1`,
      [raiz],
    );
    expect(rows[0].activo).toBe(false);
    expect(rows[0].motivo_cierre).toContain("Registrado por error");
  });

  it("desactiva también el renglón de entrega asociado", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    await anularContratoPorError(usuarioId, raiz, "x");

    const { rows } = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.detalle_entrega WHERE id = $1`,
      [detalleEntregaId],
    );
    expect(rows[0].activo).toBe(false);
  });

  it("rechaza anular un contrato que ya tiene devolución registrada", async () => {
    // El caso real documentado en contrato.repository.ts: anular después de
    // una devolución duplicaría la restitución de stock.
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    await poolOwner.query(
      `CALL public.sp_registrar_devolucion_prestamo($1, $2)`,
      [raiz, usuarioId],
    );

    await expect(anularContratoPorError(usuarioId, raiz, "x")).rejects.toThrow(
      /ya tiene una devoluci[oó]n registrada/i,
    );
  });

  it("rechaza anular un contrato con multas ya pagadas", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);
    await crearMulta(raiz, true);

    await expect(anularContratoPorError(usuarioId, raiz, "x")).rejects.toThrow(
      /multas ya pagadas/i,
    );
  });

  it("permite anular un contrato con multas activas pero no pagadas", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);
    const multaId = await crearMulta(raiz, false);

    await anularContratoPorError(usuarioId, raiz, "x");

    // Las multas de un contrato anulado dejan de tener sentido: se
    // desactivan junto con el contrato.
    const { rows } = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.multa_prestamo WHERE id = $1`,
      [multaId],
    );
    expect(rows[0].activo).toBe(false);
  });

  it("rechaza anular un contrato ya anulado", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    await anularContratoPorError(usuarioId, raiz, "primera vez");

    await expect(
      anularContratoPorError(usuarioId, raiz, "segunda vez"),
    ).rejects.toThrow(/ya est[aá] anulado/i);
  });

  it("rechaza un contrato inexistente", async () => {
    await expect(anularContratoPorError(usuarioId, -999, "x")).rejects.toThrow(
      /no existe/i,
    );
  });
});

describe("cerrarContratoNoDevuelto", () => {
  it("cierra el contrato como NO_DEVUELTO sin tocar el stock", async () => {
    // La regla central de la migración 26: a diferencia de anular, aquí el
    // equipo de verdad no está, así que el stock NO debe restituirse.
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    const lote = await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    expect(await stockDisponible(lote.loteId)).toBe(2);

    const cerrado = await cerrarContratoNoDevuelto(
      usuarioId,
      raiz,
      "El beneficiario no respondió tras varios intentos de contacto",
    );

    expect(cerrado.estado_id).toBe(estadoNoDevuelto);
    expect(cerrado.motivo_cierre).toContain("no respondió");
    // El stock sigue descontado: el equipo no volvió, así que no hay una
    // silla disponible que en realidad nadie tiene.
    expect(await stockDisponible(lote.loteId)).toBe(2);
  });

  it("deja el contrato activo: es un hecho ocurrido, no algo que se borra", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    await cerrarContratoNoDevuelto(usuarioId, raiz, "x");

    const { rows } = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.contrato_prestamo WHERE id = $1`,
      [raiz],
    );
    expect(rows[0].activo).toBe(true);
  });

  it("rechaza cerrar como no devuelto un contrato que ya tiene devolución", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    await poolOwner.query(
      `CALL public.sp_registrar_devolucion_prestamo($1, $2)`,
      [raiz, usuarioId],
    );

    await expect(
      cerrarContratoNoDevuelto(usuarioId, raiz, "x"),
    ).rejects.toThrow(/no existe|est[aá] anulado|devoluci[oó]n registrada/i);
  });

  it("rechaza cerrar como no devuelto un contrato anulado", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);

    await anularContratoPorError(usuarioId, raiz, "x");

    await expect(
      cerrarContratoNoDevuelto(usuarioId, raiz, "x"),
    ).rejects.toThrow(/no existe|est[aá] anulado/i);
  });

  it("permite cerrar como no devuelto un contrato con multas pendientes: conserva su historial", async () => {
    const insumo = await crearInsumo(usuarioId, {
      categoriaPermitePrestamo: true,
    });
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const detalleEntregaId = await entregarEquipo(insumo);
    const raiz = await crearContratoRaiz(detalleEntregaId);
    const multaId = await crearMulta(raiz, false);

    await cerrarContratoNoDevuelto(usuarioId, raiz, "x");

    // A diferencia de la anulación, aquí las multas NO se desactivan: el
    // préstamo sí ocurrió y la multa sigue siendo válida.
    const { rows } = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.multa_prestamo WHERE id = $1`,
      [multaId],
    );
    expect(rows[0].activo).toBe(true);
  });

  it("rechaza un contrato inexistente", async () => {
    await expect(
      cerrarContratoNoDevuelto(usuarioId, -999, "x"),
    ).rejects.toThrow();
  });
});
