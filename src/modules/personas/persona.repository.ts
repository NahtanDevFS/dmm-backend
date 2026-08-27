import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface PersonaRow {
  id: number;
  cui_dpi: string | null;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: Date;
  genero_id: number | null;
  comunidad_id: number | null;
  telefono: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  cui_dpi: true,
  nombres: true,
  apellidos: true,
  fecha_nacimiento: true,
  genero_id: true,
  comunidad_id: true,
  telefono: true,
  activo: true,
} as const;

const COLUMNAS_PUBLICAS = Object.keys(SELECT_PUBLICO);

interface DatosPersonaBase {
  cui_dpi?: string | null;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  genero_id?: number | null;
  comunidad_id?: number | null;
  telefono?: string | null;
}

type EncargadoInput =
  | { tipo: "existente"; personaId: number; tipoParentescoId: number }
  | { tipo: "nuevo"; datos: DatosPersonaBase; tipoParentescoId: number };

interface ContactoReferenciaInput {
  nombre: string;
  telefono?: string | null;
  observaciones?: string | null;
}

export async function listarPersonas(
  client: { query: PoolClient["query"] },
  params: {
    busqueda?: string;
    comunidadId?: number;
    incluirInactivos: boolean;
    limite: number;
    desplazamiento: number;
  },
): Promise<{ total: number; filas: PersonaRow[] }> {
  const { busqueda, comunidadId, incluirInactivos } = params;

  const condiciones: string[] = [];
  const valores: unknown[] = [];
  let i = 1;

  if (!incluirInactivos) {
    condiciones.push(`activo = true`);
  }
  if (comunidadId !== undefined) {
    condiciones.push(`comunidad_id = $${i}`);
    valores.push(comunidadId);
    i += 1;
  }
  if (busqueda) {
    const idxBusqueda = i;
    condiciones.push(
      `((nombres || ' ' || apellidos) ILIKE '%' || $${idxBusqueda} || '%'
        OR similarity(nombres || ' ' || apellidos, $${idxBusqueda}) > 0.15
        OR regexp_replace(cui_dpi, '\\s', '', 'g')
             ILIKE '%' || regexp_replace($${idxBusqueda}, '\\s', '', 'g') || '%')`,
    );
    valores.push(busqueda);
    i += 1;
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const orderBy = busqueda
    ? `ORDER BY
         (regexp_replace(cui_dpi, '\\s', '', 'g')
            ILIKE '%' || regexp_replace($${i}, '\\s', '', 'g') || '%') DESC,
         similarity(nombres || ' ' || apellidos, $${i}) DESC`
    : `ORDER BY apellidos ASC, nombres ASC`;
  if (busqueda) valores.push(busqueda);

  // El conteo reutiliza las condiciones pero no el ORDER BY: cuando hay busqueda,
  // el ultimo parametro es solo para la similitud del orden y aqui no aplica.
  const totalResult = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.persona ${where}`,
    busqueda ? valores.slice(0, -1) : valores,
  );

  const result = await client.query<PersonaRow>(
    `SELECT ${COLUMNAS_PUBLICAS.join(", ")} FROM public.persona ${where} ${orderBy}
     LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, params.limite, params.desplazamiento],
  );

  return { total: totalResult.rows[0]?.n ?? 0, filas: result.rows };
}

export async function buscarPersonaPorId(
  id: number,
): Promise<PersonaRow | null> {
  return prisma.persona.findUnique({ where: { id }, select: SELECT_PUBLICO });
}

export async function existeCuiDpiDuplicado(
  cuiDpi: string,
  excluirId?: number,
): Promise<boolean> {
  const existente = await prisma.persona.findUnique({
    where: { cui_dpi: cuiDpi },
    select: { id: true },
  });
  if (!existente) return false;
  if (excluirId !== undefined && existente.id === excluirId) return false;
  return true;
}

export async function existeComunidadActiva(id: number): Promise<boolean> {
  const comunidad = await prisma.comunidad.findUnique({
    where: { id },
    select: { activo: true },
  });
  return comunidad?.activo === true;
}

export function esMenorDeEdad(fechaNacimientoISO: string): boolean {
  const nacimiento = new Date(fechaNacimientoISO);
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const aunNoCumple =
    hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() &&
      hoy.getDate() < nacimiento.getDate());
  if (aunNoCumple) edad -= 1;
  return edad < 18;
}

async function insertarPersona(
  client: PoolClient,
  usuarioId: number,
  datos: DatosPersonaBase,
): Promise<PersonaRow> {
  const result = await client.query<PersonaRow>(
    `INSERT INTO public.persona
       (cui_dpi, nombres, apellidos, fecha_nacimiento, genero_id, comunidad_id, telefono, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNAS_PUBLICAS.join(", ")}`,
    [
      datos.cui_dpi ?? null,
      datos.nombres,
      datos.apellidos,
      datos.fecha_nacimiento,
      datos.genero_id ?? null,
      datos.comunidad_id ?? null,
      datos.telefono ?? null,
      usuarioId,
    ],
  );
  return result.rows[0];
}

async function vincularEncargado(
  client: PoolClient,
  usuarioId: number,
  menorId: number,
  encargadoId: number,
  tipoParentescoId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO public.encargado_menor (menor_id, encargado_id, tipo_parentesco_id, created_by)
     VALUES ($1, $2, $3, $4)`,
    [menorId, encargadoId, tipoParentescoId, usuarioId],
  );
}

async function vincularDiscapacidad(
  client: PoolClient,
  usuarioId: number,
  personaId: number,
  discapacidadId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO public.persona_discapacidad (persona_id, discapacidad_id, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (persona_id, discapacidad_id) DO UPDATE SET activo = true, updated_by = $3`,
    [personaId, discapacidadId, usuarioId],
  );
}

async function insertarContactoReferencia(
  client: PoolClient,
  usuarioId: number,
  personaId: number,
  contacto: ContactoReferenciaInput,
): Promise<void> {
  await client.query(
    `INSERT INTO public.contacto_referencia_persona (persona_id, nombre, telefono, observaciones, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      personaId,
      contacto.nombre,
      contacto.telefono ?? null,
      contacto.observaciones ?? null,
      usuarioId,
    ],
  );
}

export async function crearPersonaConRelaciones(
  usuarioId: number,
  datos: DatosPersonaBase,
  discapacidadIds: number[],
  encargados: EncargadoInput[],
  contactos: ContactoReferenciaInput[],
): Promise<PersonaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const persona = await insertarPersona(client, usuarioId, datos);

    for (const discapacidadId of discapacidadIds) {
      await vincularDiscapacidad(client, usuarioId, persona.id, discapacidadId);
    }

    for (const contacto of contactos) {
      await insertarContactoReferencia(client, usuarioId, persona.id, contacto);
    }

    for (const encargado of encargados) {
      if (encargado.tipo === "existente") {
        await vincularEncargado(
          client,
          usuarioId,
          persona.id,
          encargado.personaId,
          encargado.tipoParentescoId,
        );
      } else {
        const nuevoEncargado = await insertarPersona(
          client,
          usuarioId,
          encargado.datos,
        );
        await vincularEncargado(
          client,
          usuarioId,
          persona.id,
          nuevoEncargado.id,
          encargado.tipoParentescoId,
        );
      }
    }

    return persona;
  });
}

export async function editarPersona(
  usuarioId: number,
  id: number,
  datos: Partial<DatosPersonaBase>,
): Promise<PersonaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    const campos: (keyof DatosPersonaBase)[] = [
      "cui_dpi",
      "nombres",
      "apellidos",
      "fecha_nacimiento",
      "genero_id",
      "comunidad_id",
      "telefono",
    ];

    for (const campo of campos) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;

    valores.push(id);

    const result = await client.query<PersonaRow>(
      `UPDATE public.persona
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS_PUBLICAS.join(", ")}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoPersona(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<PersonaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<PersonaRow>(
      `UPDATE public.persona
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${COLUMNAS_PUBLICAS.join(", ")}`,
      [nuevoEstado, usuarioId, id],
    );
    return result.rows[0];
  });
}

export interface DiscapacidadDePersona {
  discapacidad_id: number;
  nombre: string;
}

export async function listarDiscapacidadesDePersona(
  personaId: number,
): Promise<DiscapacidadDePersona[]> {
  const filas = await prisma.persona_discapacidad.findMany({
    where: { persona_id: personaId, activo: true },
    select: {
      discapacidad_id: true,
      discapacidad: { select: { nombre: true } },
    },
  });
  return filas.map(
    (f: { discapacidad_id: number; discapacidad: { nombre: string } }) => ({
      discapacidad_id: f.discapacidad_id,
      nombre: f.discapacidad.nombre,
    }),
  );
}

export async function agregarDiscapacidadAPersona(
  usuarioId: number,
  personaId: number,
  discapacidadId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await vincularDiscapacidad(client, usuarioId, personaId, discapacidadId);
  });
}

export async function quitarDiscapacidadDePersona(
  usuarioId: number,
  personaId: number,
  discapacidadId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.persona_discapacidad
       SET activo = false, updated_by = $1
       WHERE persona_id = $2 AND discapacidad_id = $3`,
      [usuarioId, personaId, discapacidadId],
    );
  });
}

export interface EncargadoDePersona {
  encargado_id: number;
  tipo_parentesco_id: number;
  parentesco_nombre: string;
  nombres: string;
  apellidos: string;
}

export async function listarEncargadosDePersona(
  menorId: number,
): Promise<EncargadoDePersona[]> {
  const filas = await prisma.encargado_menor.findMany({
    where: { menor_id: menorId, activo: true },
    select: {
      encargado_id: true,
      tipo_parentesco_id: true,
      tipo_parentesco: { select: { nombre: true } },
      persona_encargado_menor_encargado_idTopersona: {
        select: { nombres: true, apellidos: true },
      },
    },
  });
  return filas.map(
    (f: {
      encargado_id: number;
      tipo_parentesco_id: number;
      tipo_parentesco: { nombre: string };
      persona_encargado_menor_encargado_idTopersona: {
        nombres: string;
        apellidos: string;
      };
    }) => ({
      encargado_id: f.encargado_id,
      tipo_parentesco_id: f.tipo_parentesco_id,
      parentesco_nombre: f.tipo_parentesco.nombre,
      nombres: f.persona_encargado_menor_encargado_idTopersona.nombres,
      apellidos: f.persona_encargado_menor_encargado_idTopersona.apellidos,
    }),
  );
}

export async function vincularEncargadoAPersonaExistente(
  usuarioId: number,
  menorId: number,
  encargado: EncargadoInput,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    if (encargado.tipo === "existente") {
      await vincularEncargado(
        client,
        usuarioId,
        menorId,
        encargado.personaId,
        encargado.tipoParentescoId,
      );
    } else {
      const nuevoEncargado = await insertarPersona(
        client,
        usuarioId,
        encargado.datos,
      );
      await vincularEncargado(
        client,
        usuarioId,
        menorId,
        nuevoEncargado.id,
        encargado.tipoParentescoId,
      );
    }
  });
}

export async function desvincularEncargado(
  usuarioId: number,
  menorId: number,
  encargadoId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.encargado_menor
       SET activo = false, updated_by = $1
       WHERE menor_id = $2 AND encargado_id = $3`,
      [usuarioId, menorId, encargadoId],
    );
  });
}

export interface ContactoReferenciaRow {
  id: number;
  persona_id: number;
  nombre: string;
  telefono: string | null;
  observaciones: string | null;
  activo: boolean;
}

const SELECT_PUBLICO_CONTACTO = {
  id: true,
  persona_id: true,
  nombre: true,
  telefono: true,
  observaciones: true,
  activo: true,
} as const;

export async function listarContactosDePersona(
  personaId: number,
): Promise<ContactoReferenciaRow[]> {
  return prisma.contacto_referencia_persona.findMany({
    where: { persona_id: personaId, activo: true },
    select: SELECT_PUBLICO_CONTACTO,
    orderBy: { nombre: "asc" },
  });
}

export async function buscarContactoPorId(
  id: number,
): Promise<ContactoReferenciaRow | null> {
  return prisma.contacto_referencia_persona.findUnique({
    where: { id },
    select: SELECT_PUBLICO_CONTACTO,
  });
}

export async function agregarContacto(
  usuarioId: number,
  personaId: number,
  contacto: ContactoReferenciaInput,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await insertarContactoReferencia(client, usuarioId, personaId, contacto);
  });
}

export async function editarContacto(
  usuarioId: number,
  contactoId: number,
  datos: Partial<ContactoReferenciaInput>,
): Promise<ContactoReferenciaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of ["nombre", "telefono", "observaciones"] as const) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;

    valores.push(contactoId);

    const result = await client.query<ContactoReferenciaRow>(
      `UPDATE public.contacto_referencia_persona
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, persona_id, nombre, telefono, observaciones, activo`,
      valores,
    );
    return result.rows[0];
  });
}

export async function eliminarContacto(
  usuarioId: number,
  contactoId: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.contacto_referencia_persona
       SET activo = false, updated_by = $1
       WHERE id = $2`,
      [usuarioId, contactoId],
    );
  });
}
