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

// Lotes vencidos fuera del despacho (migracion 35).
//
// Antes, un lote con la caducidad pasada seguia contando como existencia hasta
// que alguien lo diera de baja a mano, y el orden FEFO lo despachaba PRIMERO:
// la fecha mas antigua es justamente la vencida. Tambien se cubre la otra mitad
// de la migracion: una linea PENDIENTE_ENTREGA cuyo insumo se quedo sin
// existencias tiene que aparecer en la lista de espera.

let usuarioId: number;
let personaId: number;
let programaId: number;
let modalidadDonacionId: number;

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("vencidos");
  modalidadDonacionId = await idCatalogo("modalidad_solicitud", "DONACION");

  const prog = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.programa (nombre, created_by) VALUES ('Programa vencidos', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  programaId = prog.rows[0].id;
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.detalle_entrega, public.entrega,
                    public.detalle_solicitud_apoyo, public.solicitud_apoyo,
                    public.detalle_inventario_lote, public.recepcion_donacion_lote
     RESTART IDENTITY CASCADE`,
  );
  personaId = await crearPersona(usuarioId, { nombres: "Beneficiaria" });
});

afterAll(async () => {
  await cerrarPools();
});

async function stockEntregable(insumo: InsumoCreado): Promise<number> {
  const { rows } = await poolOwner.query<{ s: number }>(
    `SELECT public.fn_stock_disponible($1) AS s`,
    [insumo.insumoId],
  );
  return rows[0].s;
}

async function registrarEntrega(
  insumo: InsumoCreado,
  cantidad: number,
): Promise<void> {
  await poolOwner.query(
    `CALL public.sp_registrar_entrega($1, $2, $3, $4, $5, $6, $7, $8)`,
    [null, personaId, insumo.insumoId, cantidad, usuarioId, null, null, null],
  );
}

async function crearLinea(
  insumo: InsumoCreado,
  cantidad: number,
): Promise<number> {
  const sol = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.solicitud_apoyo (persona_id, programa_id, estado_id, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      personaId,
      programaId,
      await idCatalogo("estado_solicitud_apoyo", "PENDIENTE_ADQUISICION"),
      usuarioId,
    ],
  );
  const linea = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.detalle_solicitud_apoyo
       (solicitud_id, insumo_id, cantidad_requerida, estado_id, modalidad_solicitud_id, created_by)
     VALUES ($1, $2, $3, 1, $4, $5) RETURNING id`,
    [sol.rows[0].id, insumo.insumoId, cantidad, modalidadDonacionId, usuarioId],
  );
  return linea.rows[0].id;
}

async function estadoLinea(lineaId: number): Promise<string> {
  const { rows } = await poolOwner.query<{ nombre: string }>(
    `SELECT e.nombre FROM public.detalle_solicitud_apoyo d
     JOIN public.estado_solicitud_apoyo e ON e.id = d.estado_id
     WHERE d.id = $1`,
    [lineaId],
  );
  return rows[0].nombre;
}

describe("stock y despacho sin lotes vencidos", () => {
  it("el stock entregable no cuenta lo vencido", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    await crearLote(usuarioId, insumo, { cantidad: 7, fechaCaducidad: enDias(-5) });
    await crearLote(usuarioId, insumo, { cantidad: 3, fechaCaducidad: enDias(60) });

    expect(await stockEntregable(insumo)).toBe(3);

    const { rows } = await poolOwner.query<{
      stock_total: number;
      stock_vencido: number;
      semaforo: string;
    }>(
      `SELECT stock_total, stock_vencido, semaforo
       FROM public.v_stock_insumo WHERE insumo_id = $1`,
      [insumo.insumoId],
    );
    expect(rows[0].stock_total).toBe(3);
    expect(rows[0].stock_vencido).toBe(7);
    // El semaforo sigue avisando: es la alerta para darlo de baja.
    expect(rows[0].semaforo).toBe("VENCIDO");
  });

  it("el reparto FEFO salta el lote vencido aunque sea el de fecha mas antigua", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    const vencido = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(-5),
    });
    const vigente = await crearLote(usuarioId, insumo, {
      cantidad: 10,
      fechaCaducidad: enDias(30),
    });

    await registrarEntrega(insumo, 4);

    expect(await stockDisponible(vencido.loteId)).toBe(10);
    expect(await stockDisponible(vigente.loteId)).toBe(6);
  });

  it("no completa con lo vencido cuando lo vigente no alcanza", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    await crearLote(usuarioId, insumo, { cantidad: 10, fechaCaducidad: enDias(-5) });
    await crearLote(usuarioId, insumo, { cantidad: 2, fechaCaducidad: enDias(30) });

    await expect(registrarEntrega(insumo, 5)).rejects.toThrow(
      /Stock insuficiente\. Disponible: 2/,
    );
  });

  it("rechaza despachar una unidad vencida elegida a mano", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    const vencido = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(-5),
    });
    await crearLote(usuarioId, insumo, { cantidad: 5, fechaCaducidad: enDias(30) });

    const { rows } = await poolOwner.query<{ id: number }>(
      `SELECT public.fn_crear_entrega($1, $2) AS id`,
      [personaId, usuarioId],
    );
    await expect(
      poolOwner.query(
        `CALL public.sp_agregar_insumo_entrega($1, $2, 1, NULL, $3)`,
        [rows[0].id, insumo.insumoId, vencido.loteId],
      ),
    ).rejects.toThrow(/venció/);
    expect(await stockDisponible(vencido.loteId)).toBe(5);
  });

  it("el mismo dia de su caducidad todavia se entrega", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    const lote = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(30),
    });
    // CURRENT_DATE de la base y no enDias(0): enDias calcula en UTC.
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET fecha_caducidad = CURRENT_DATE WHERE id = $1`,
      [lote.loteId],
    );

    await registrarEntrega(insumo, 2);
    expect(await stockDisponible(lote.loteId)).toBe(3);
  });

  it("una linea nueva con solo existencias vencidas espera adquisicion", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    await crearLote(usuarioId, insumo, { cantidad: 10, fechaCaducidad: enDias(-5) });

    const linea = await crearLinea(insumo, 2);
    expect(await estadoLinea(linea)).toBe("PENDIENTE_ADQUISICION");
  });
});

describe("lista de espera con lineas asignadas sin existencias", () => {
  async function enEspera(
    lineaId: number,
  ): Promise<{ estado: string; sin_existencias: boolean } | undefined> {
    const { rows } = await poolOwner.query<{
      estado: string;
      sin_existencias: boolean;
    }>(
      `SELECT estado, sin_existencias FROM public.v_lista_espera
       WHERE detalle_solicitud_id = $1`,
      [lineaId],
    );
    return rows[0];
  }

  it("no aparece mientras hay existencias para entregarle", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 5 });
    const linea = await crearLinea(insumo, 2);

    expect(await estadoLinea(linea)).toBe("PENDIENTE_ENTREGA");
    expect(await enEspera(linea)).toBeUndefined();
  });

  it("aparece cuando otra entrega se lleva las existencias", async () => {
    const insumo = await crearInsumo(usuarioId);
    await crearLote(usuarioId, insumo, { cantidad: 3 });
    const linea = await crearLinea(insumo, 2);
    expect(await estadoLinea(linea)).toBe("PENDIENTE_ENTREGA");

    // Una entrega directa a otra persona agota el insumo.
    await registrarEntrega(insumo, 3);

    expect(await estadoLinea(linea)).toBe("PENDIENTE_ENTREGA");
    expect(await enEspera(linea)).toEqual({
      estado: "PENDIENTE_ENTREGA",
      sin_existencias: true,
    });
  });

  it("aparece cuando sus existencias vencen", async () => {
    const insumo = await crearInsumo(usuarioId, { requiereFechaCaducidad: true });
    const lote = await crearLote(usuarioId, insumo, {
      cantidad: 5,
      fechaCaducidad: enDias(30),
    });
    const linea = await crearLinea(insumo, 2);
    expect(await enEspera(linea)).toBeUndefined();

    // El paso del tiempo, simulado: ninguna escritura sobre la linea.
    await poolOwner.query(
      `UPDATE public.detalle_inventario_lote SET fecha_caducidad = $2 WHERE id = $1`,
      [lote.loteId, enDias(-2)],
    );

    expect((await enEspera(linea))?.sin_existencias).toBe(true);
  });

  it("las que ya estaban en espera siguen igual y sin la marca", async () => {
    const insumo = await crearInsumo(usuarioId);
    const linea = await crearLinea(insumo, 2);

    expect(await enEspera(linea)).toEqual({
      estado: "PENDIENTE_ADQUISICION",
      sin_existencias: false,
    });
  });
});
