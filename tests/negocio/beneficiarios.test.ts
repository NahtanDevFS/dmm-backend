import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  poolOwner,
  resetBaseDePruebas,
  cerrarPools,
  idCatalogo,
} from "../helpers/bd.js";
import { crearUsuario, crearPersona, enDias } from "../helpers/fixtures.js";

/**
 * RF-BEN-03: todo menor sin CUI/DPI debe tener un encargado vinculado.
 *
 * Lo que hace especial a esta regla es CUANDO se valida. Los dos triggers son
 * CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED, asi que la
 * comprobacion NO ocurre al INSERT sino al COMMIT.
 *
 * Sin eso, registrar un menor con su encargado en una sola operacion seria
 * imposible: al insertar al menor todavia no existe el vinculo, y al intentar
 * crear el vinculo todavia no existe el menor. El diferimiento es lo que
 * permite que `POST /api/personas` acepte persona + encargados en un unico
 * request, que es como trabaja la DMM en ventanilla.
 *
 * De ahi que casi todas estas pruebas manejen transacciones explicitas: probar
 * esto con autocommit verificaria otra cosa.
 */

let usuarioId: number;
let parentescoId: number;

/** Fecha de nacimiento de alguien que hoy tiene la edad pedida. */
function nacidoHace(anios: number): string {
  const f = new Date();
  f.setFullYear(f.getFullYear() - anios);
  return f.toISOString().slice(0, 10);
}

beforeAll(async () => {
  await resetBaseDePruebas();
  usuarioId = await crearUsuario("beneficiarios");
  parentescoId = await idCatalogo("tipo_parentesco", "MADRE");
}, 60_000);

beforeEach(async () => {
  await poolOwner.query(
    `TRUNCATE TABLE public.encargado_menor, public.contacto_referencia_persona,
                    public.documento_persona, public.persona_discapacidad,
                    public.persona
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await cerrarPools();
});

/** Ejecuta `fn` dentro de una transaccion y hace COMMIT al final. */
async function enTransaccion<T>(fn: (cliente: any) => Promise<T>): Promise<T> {
  const cliente = await poolOwner.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT set_config('app.usuario_id', $1, true)", [
      String(usuarioId),
    ]);
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (error) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

async function insertarPersona(
  cliente: any,
  datos: { nombres: string; fechaNacimiento: string; cuiDpi?: string | null },
): Promise<number> {
  const { rows } = await cliente.query(
    `INSERT INTO public.persona
       (cui_dpi, nombres, apellidos, fecha_nacimiento, created_by)
     VALUES ($1, $2, 'De Prueba', $3, $4)
     RETURNING id`,
    [datos.cuiDpi ?? null, datos.nombres, datos.fechaNacimiento, usuarioId],
  );
  return rows[0].id;
}

async function vincularEncargado(
  cliente: any,
  menorId: number,
  encargadoId: number,
): Promise<void> {
  await cliente.query(
    `INSERT INTO public.encargado_menor
       (menor_id, encargado_id, tipo_parentesco_id, created_by)
     VALUES ($1, $2, $3, $4)`,
    [menorId, encargadoId, parentescoId, usuarioId],
  );
}

describe("menor sin DPI: exigencia de encargado", () => {
  it("rechaza al COMMIT un menor sin DPI y sin encargado", async () => {
    await expect(
      enTransaccion(async (cliente) => {
        await insertarPersona(cliente, {
          nombres: "Menor Solo",
          fechaNacimiento: nacidoHace(10),
          cuiDpi: null,
        });
        // El INSERT en si mismo NO falla: la validacion esta diferida.
      }),
    ).rejects.toThrow(/menor de edad y no tiene CUI\/DPI/i);

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.persona`,
    );
    expect(rows[0].n).toBe("0");
  });

  it("acepta menor y encargado creados en la misma transaccion", async () => {
    // El caso que justifica todo el diseño diferido: en ventanilla se registra
    // al niño y a su madre de una sola vez.
    const menorId = await enTransaccion(async (cliente) => {
      const madre = await insertarPersona(cliente, {
        nombres: "Madre Nueva",
        fechaNacimiento: nacidoHace(35),
        cuiDpi: "1111111110101",
      });
      const menor = await insertarPersona(cliente, {
        nombres: "Menor Con Madre",
        fechaNacimiento: nacidoHace(8),
        cuiDpi: null,
      });
      await vincularEncargado(cliente, menor, madre);
      return menor;
    });

    expect(menorId).toBeGreaterThan(0);
  });

  it("permite insertar al menor ANTES que a su encargado", async () => {
    // Es lo que hace imposible una validacion inmediata: en este orden, al
    // insertar al menor el vinculo todavia no puede existir.
    const menorId = await enTransaccion(async (cliente) => {
      const menor = await insertarPersona(cliente, {
        nombres: "Menor Primero",
        fechaNacimiento: nacidoHace(5),
        cuiDpi: null,
      });
      const padre = await insertarPersona(cliente, {
        nombres: "Padre Despues",
        fechaNacimiento: nacidoHace(40),
        cuiDpi: "2222222220101",
      });
      await vincularEncargado(cliente, menor, padre);
      return menor;
    });

    expect(menorId).toBeGreaterThan(0);
  });

  it("acepta un menor CON DPI sin ningun encargado", async () => {
    // La regla es "menor Y sin DPI". Un menor identificado no la activa.
    const menorId = await enTransaccion((cliente) =>
      insertarPersona(cliente, {
        nombres: "Menor Con DPI",
        fechaNacimiento: nacidoHace(16),
        cuiDpi: "3333333330101",
      }),
    );

    expect(menorId).toBeGreaterThan(0);
  });

  it("acepta un adulto sin DPI sin encargado", async () => {
    // Los adultos sin documento se resuelven con contacto de referencia
    // (RF-BEN-05), no con encargado.
    const adultoId = await enTransaccion((cliente) =>
      insertarPersona(cliente, {
        nombres: "Adulto Sin DPI",
        fechaNacimiento: nacidoHace(45),
        cuiDpi: null,
      }),
    );

    expect(adultoId).toBeGreaterThan(0);
  });
});

describe("el limite de la mayoria de edad", () => {
  it("exige encargado a quien cumple 18 mañana", async () => {
    const casiAdulto = new Date();
    casiAdulto.setFullYear(casiAdulto.getFullYear() - 18);
    casiAdulto.setDate(casiAdulto.getDate() + 1);

    await expect(
      enTransaccion((cliente) =>
        insertarPersona(cliente, {
          nombres: "Casi Adulto",
          fechaNacimiento: casiAdulto.toISOString().slice(0, 10),
          cuiDpi: null,
        }),
      ),
    ).rejects.toThrow(/menor de edad/i);
  });

  it("no exige encargado a quien cumplio 18 ayer", async () => {
    const recienAdulto = new Date();
    recienAdulto.setFullYear(recienAdulto.getFullYear() - 18);
    recienAdulto.setDate(recienAdulto.getDate() - 1);

    const id = await enTransaccion((cliente) =>
      insertarPersona(cliente, {
        nombres: "Recien Adulto",
        fechaNacimiento: recienAdulto.toISOString().slice(0, 10),
        cuiDpi: null,
      }),
    );

    expect(id).toBeGreaterThan(0);
  });
});

describe("desvinculacion de encargados", () => {
  async function crearMenorConEncargado(): Promise<{
    menorId: number;
    encargadoId: number;
  }> {
    return enTransaccion(async (cliente) => {
      const encargado = await insertarPersona(cliente, {
        nombres: "Encargado",
        fechaNacimiento: nacidoHace(38),
        cuiDpi: `4444444440${Math.floor(Math.random() * 900 + 100)}`,
      });
      const menor = await insertarPersona(cliente, {
        nombres: "Menor Vinculado",
        fechaNacimiento: nacidoHace(7),
        cuiDpi: null,
      });
      await vincularEncargado(cliente, menor, encargado);
      return { menorId: menor, encargadoId: encargado };
    });
  }

  it("no permite dejar a un menor sin ningun encargado activo", async () => {
    const { menorId, encargadoId } = await crearMenorConEncargado();

    await expect(
      enTransaccion((cliente) =>
        cliente.query(
          `UPDATE public.encargado_menor SET activo = false
           WHERE menor_id = $1 AND encargado_id = $2`,
          [menorId, encargadoId],
        ),
      ),
    ).rejects.toThrow(/menor de edad y no tiene CUI\/DPI/i);

    // El vinculo debe seguir activo tras el rollback.
    const { rows } = await poolOwner.query<{ activo: boolean }>(
      `SELECT activo FROM public.encargado_menor WHERE menor_id = $1`,
      [menorId],
    );
    expect(rows[0].activo).toBe(true);
  });

  it("permite cambiar de encargado dentro de una misma transaccion", async () => {
    // Desvincular al viejo y vincular al nuevo: en ningun momento intermedio
    // hay encargado, pero al COMMIT si.
    const { menorId, encargadoId } = await crearMenorConEncargado();

    await enTransaccion(async (cliente) => {
      const nuevo = await insertarPersona(cliente, {
        nombres: "Encargado Nuevo",
        fechaNacimiento: nacidoHace(50),
        cuiDpi: "5555555550101",
      });
      await cliente.query(
        `UPDATE public.encargado_menor SET activo = false
         WHERE menor_id = $1 AND encargado_id = $2`,
        [menorId, encargadoId],
      );
      await vincularEncargado(cliente, menorId, nuevo);
    });

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.encargado_menor
       WHERE menor_id = $1 AND activo = true`,
      [menorId],
    );
    expect(rows[0].n).toBe("1");
  });

  it("permite desvincular si al menor se le registro un DPI", async () => {
    const { menorId, encargadoId } = await crearMenorConEncargado();

    await enTransaccion(async (cliente) => {
      await cliente.query(
        `UPDATE public.persona SET cui_dpi = '6666666660101' WHERE id = $1`,
        [menorId],
      );
      await cliente.query(
        `UPDATE public.encargado_menor SET activo = false
         WHERE menor_id = $1 AND encargado_id = $2`,
        [menorId, encargadoId],
      );
    });

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.encargado_menor
       WHERE menor_id = $1 AND activo = true`,
      [menorId],
    );
    expect(rows[0].n).toBe("0");
  });
});

describe("integridad de los datos de persona", () => {
  it("no admite dos personas con el mismo CUI/DPI", async () => {
    await crearPersona(usuarioId, {
      nombres: "Primera",
      cuiDpi: "7777777770101",
    });

    await expect(
      crearPersona(usuarioId, { nombres: "Segunda", cuiDpi: "7777777770101" }),
    ).rejects.toThrow();
  });

  it("si admite varias personas sin CUI/DPI", async () => {
    // UNIQUE en Postgres no colisiona entre NULLs, y es lo que hace falta:
    // muchos beneficiarios no tienen documento.
    const a = await crearPersona(usuarioId, { nombres: "Sin DPI A" });
    const b = await crearPersona(usuarioId, { nombres: "Sin DPI B" });

    expect(a).not.toBe(b);
  });

  it("rechaza una fecha de nacimiento futura", async () => {
    await expect(
      crearPersona(usuarioId, {
        nombres: "Del Futuro",
        fechaNacimiento: enDias(30),
      }),
    ).rejects.toThrow();
  });

  it("borra en cascada los datos dependientes de la persona", async () => {
    const personaId = await crearPersona(usuarioId, { nombres: "Con Datos" });
    await poolOwner.query(
      `INSERT INTO public.contacto_referencia_persona
         (persona_id, nombre, created_by)
       VALUES ($1, 'Contacto', $2)`,
      [personaId, usuarioId],
    );

    await poolOwner.query(`DELETE FROM public.persona WHERE id = $1`, [
      personaId,
    ]);

    const { rows } = await poolOwner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.contacto_referencia_persona
       WHERE persona_id = $1`,
      [personaId],
    );
    expect(rows[0].n).toBe("0");
  });
});
