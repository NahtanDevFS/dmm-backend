import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  poolApp,
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
} from "../helpers/bd.js";
import {
  crearUsuario,
  crearInsumo,
  crearLote,
  crearRecepcion,
  stockDisponible,
  enDias,
  type InsumoCreado,
} from "../helpers/fixtures.js";

/**
 * Reglas de inventario que viven en triggers de PostgreSQL, no en TypeScript.
 *
 * Se prueban contra la base porque es donde estan: leer el repositorio no dice
 * nada sobre que hace `fn_calcular_recepcion_lote`, y una prueba con la base
 * simulada solo confirmaria que el mock devuelve lo que se le dijo.
 */

let usuarioId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("inventario");
}, 60_000);

beforeEach(async () => {
  // Cada prueba parte de inventario vacio: si una dejara stock, la siguiente
  // podria pasar por el motivo equivocado.
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_entrega, public.entrega,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await cerrarPools();
});

describe("calculo de cantidades al recibir un lote", () => {
  it("multiplica cantidad por unidades_por_presentacion", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, {
      cantidad: 12,
      unidadesPorPresentacion: 24,
    });

    // 12 cajas de 24 unidades = 288 unidades base.
    expect(lote.cantidadInicial).toBe(288);
    expect(lote.cantidadDisponible).toBe(288);
  });

  it("trunca hacia abajo, no redondea", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, {
      cantidad: 2.5,
      unidadesPorPresentacion: 3,
    });

    // 2.5 * 3 = 7.5 -> 7. Redondear daria 8 y el inventario prometeria una
    // unidad que no existe fisicamente.
    expect(lote.cantidadInicial).toBe(7);
  });

  it("permite que dos lotes del mismo insumo tengan distinta conversion", async () => {
    // Es la razon de ser del cambio v2->v3: el mismo insumo puede llegar en
    // frascos de 50 y de 100 segun quien lo done.
    const insumo = await crearInsumo(usuarioId);
    const chico = await crearLote(usuarioId, insumo, {
      cantidad: 2,
      unidadesPorPresentacion: 50,
    });
    const grande = await crearLote(usuarioId, insumo, {
      cantidad: 2,
      unidadesPorPresentacion: 100,
    });

    expect(chico.cantidadInicial).toBe(100);
    expect(grande.cantidadInicial).toBe(200);
  });

  it("rechaza un lote cuya cantidad resultante seria cero", async () => {
    const insumo = await crearInsumo(usuarioId);
    await expect(
      crearLote(usuarioId, insumo, {
        cantidad: 0.4,
        unidadesPorPresentacion: 1,
      }),
    ).rejects.toThrow(/inv[aá]lida/i);
  });
});

describe("validaciones condicionales del insumo", () => {
  it("exige fecha de caducidad cuando el insumo la requiere", async () => {
    const insumo = await crearInsumo(usuarioId, {
      requiereFechaCaducidad: true,
    });

    await expect(
      crearLote(usuarioId, insumo, { fechaCaducidad: null }),
    ).rejects.toThrow(/fecha de caducidad/i);

    const conFecha = await crearLote(usuarioId, insumo, {
      fechaCaducidad: enDias(90),
    });
    expect(conFecha.loteId).toBeGreaterThan(0);
  });

  it("exige codigo de fabricante cuando el insumo lo requiere", async () => {
    const insumo = await crearInsumo(usuarioId, {
      requiereCodigoFabricante: true,
    });

    await expect(
      crearLote(usuarioId, insumo, { codigoFabricante: null }),
    ).rejects.toThrow(/c[oó]digo de lote/i);

    // Una cadena de espacios no cuenta como codigo.
    await expect(
      crearLote(usuarioId, insumo, { codigoFabricante: "   " }),
    ).rejects.toThrow(/c[oó]digo de lote/i);
  });

  it("no exige nada cuando el insumo no lo pide", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, {
      fechaCaducidad: null,
      codigoFabricante: null,
    });
    expect(lote.cantidadInicial).toBeGreaterThan(0);
  });

  it("rechaza una presentacion que pertenece a otro insumo", async () => {
    const insumoA = await crearInsumo(usuarioId, { nombre: "Insumo A" });
    const insumoB = await crearInsumo(usuarioId, { nombre: "Insumo B" });
    const recepcion = await crearRecepcion(usuarioId);

    await expect(
      poolOwner.query(
        `INSERT INTO public.detalle_inventario_lote
           (insumo_id, recepcion_lote_id, presentacion_recepcion_id,
            cantidad_recepcion_original, unidades_por_presentacion_lote, created_by)
         VALUES ($1, $2, $3, 5, 1, $4)`,
        [insumoA.insumoId, recepcion, insumoB.presentacionId, usuarioId],
      ),
    ).rejects.toThrow(/no corresponde al insumo/i);
  });
});

describe("descuento de stock al entregar", () => {
  async function crearEntrega(personaId: number): Promise<number> {
    const { rows } = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.entrega (persona_id, usuario_entrega_id, created_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [personaId, usuarioId, usuarioId],
    );
    return rows[0].id;
  }

  async function despachar(
    entregaId: number,
    insumo: InsumoCreado,
    loteId: number,
    cantidad: number,
  ): Promise<void> {
    // $4 y $5 van separados aunque lleven el mismo valor: Postgres deduce el
    // tipo de cada parametro por su uso, y `cantidad_despacho_original` es
    // numeric(12,4) mientras que `cantidad_entregada` es integer. Reutilizar
    // $4 para ambas falla con "inconsistent types deduced for parameter".
    await poolOwner.query(
      `INSERT INTO public.detalle_entrega
         (entrega_id, detalle_inventario_lote_id, presentacion_despacho_id,
          cantidad_despacho_original, cantidad_entregada, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entregaId, loteId, insumo.presentacionId, cantidad, cantidad, usuarioId],
    );
  }

  let personaId: number;

  beforeEach(async () => {
    const { rows } = await poolOwner.query<{ id: number }>(
      `INSERT INTO public.persona (nombres, apellidos, fecha_nacimiento, created_by)
       VALUES ('Beneficiaria', 'De Prueba', '1990-01-01', $1)
       RETURNING id`,
      [usuarioId],
    );
    personaId = rows[0].id;
  });

  it("descuenta del lote la cantidad entregada", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 100 });
    const entrega = await crearEntrega(personaId);

    await despachar(entrega, insumo, lote.loteId, 30);

    expect(await stockDisponible(lote.loteId)).toBe(70);
  });

  it("rechaza entregar mas de lo disponible", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });
    const entrega = await crearEntrega(personaId);

    await expect(despachar(entrega, insumo, lote.loteId, 11)).rejects.toThrow(
      /stock insuficiente/i,
    );

    // El intento fallido no debe haber tocado el inventario.
    expect(await stockDisponible(lote.loteId)).toBe(10);
  });

  it("nunca deja el stock negativo, ni agotando el lote exacto", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 5 });
    const entrega = await crearEntrega(personaId);

    await despachar(entrega, insumo, lote.loteId, 5);
    expect(await stockDisponible(lote.loteId)).toBe(0);

    await expect(despachar(entrega, insumo, lote.loteId, 1)).rejects.toThrow(
      /stock insuficiente/i,
    );
    expect(await stockDisponible(lote.loteId)).toBe(0);
  });

  it("no permite despachar desde un lote inactivo", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET activo = false WHERE id = $1`,
      [lote.loteId],
    );
    const entrega = await crearEntrega(personaId);

    await expect(despachar(entrega, insumo, lote.loteId, 1)).rejects.toThrow(
      /no existe o est[aá] inactivo/i,
    );
  });

  /**
   * Dos transacciones concurrentes sobre el mismo lote.
   *
   * Es la prueba que justifica el `FOR UPDATE` de `fn_descontar_inventario`.
   * Sin el bloqueo, ambas leerian el mismo `cantidad_disponible`, las dos
   * pasarian la validacion y el stock quedaria negativo: inventario que
   * promete unidades que no existen.
   *
   * Se usan dos clientes distintos del pool a proposito; con uno solo las
   * sentencias se serializarian y no habria concurrencia real.
   */
  it("no sobregira cuando dos entregas compiten por el mismo lote", async () => {
    const insumo = await crearInsumo(usuarioId);
    const lote = await crearLote(usuarioId, insumo, { cantidad: 10 });
    const entregaA = await crearEntrega(personaId);
    const entregaB = await crearEntrega(personaId);

    const clienteA = await poolApp.connect();
    const clienteB = await poolApp.connect();

    const insertar = (cliente: any, entregaId: number) =>
      cliente.query(
        `INSERT INTO public.detalle_entrega
           (entrega_id, detalle_inventario_lote_id, presentacion_despacho_id,
            cantidad_despacho_original, cantidad_entregada, created_by)
         VALUES ($1, $2, $3, 6::numeric, 6::integer, $4)`,
        [entregaId, lote.loteId, insumo.presentacionId, usuarioId],
      );

    try {
      await clienteA.query("BEGIN");
      await clienteB.query("BEGIN");
      await clienteA.query("SELECT set_config('app.usuario_id', $1, true)", [
        String(usuarioId),
      ]);
      await clienteB.query("SELECT set_config('app.usuario_id', $1, true)", [
        String(usuarioId),
      ]);

      // A toma el bloqueo del lote y descuenta 6 de 10.
      await insertar(clienteA, entregaA);

      // B pide otros 6: debe quedarse esperando el bloqueo de A.
      const promesaB = insertar(clienteB, entregaB);

      await clienteA.query("COMMIT");

      // Con el lote ya en 4, B no puede llevarse 6.
      await expect(promesaB).rejects.toThrow(/stock insuficiente/i);
      await clienteB.query("ROLLBACK");
    } finally {
      clienteA.release();
      clienteB.release();
    }

    // 10 - 6 = 4. Sin FOR UPDATE habria quedado en -2.
    expect(await stockDisponible(lote.loteId)).toBe(4);
  });
});
