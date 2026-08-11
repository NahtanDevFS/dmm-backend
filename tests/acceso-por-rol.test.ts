import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  levantarServidor,
  bajarServidor,
  sesionComo,
  pedir,
  type Sesion,
} from "./helpers/servidor.js";
import { resetBaseDePruebas, cerrarPools } from "./helpers/bd.js";

/**
 * Verifica por HTTP real que cada rol llega solo a donde debe.
 *
 * Es la prueba que blinda el hallazgo que origino todo este trabajo: ALCALDE
 * tenia acceso de lectura a solicitudes, entregas, contratos, inventario y a
 * los documentos de identificacion de beneficiarios, cuando la regla acordada
 * con el cliente es que solo entra al modulo de reportes.
 *
 * Se comprueba el CODIGO DE ESTADO, no el contenido: lo que importa aqui es si
 * la peticion se detiene o no. Que los datos sean correctos es asunto de las
 * pruebas de negocio.
 *
 * 200 significa "no lo bloqueo el control de acceso": se acepta cualquier
 * respuesta que no sea 401/403, porque un 404 por id inexistente tambien
 * prueba que paso el filtro.
 */

type Rol = "EMPLEADO_DMM" | "DIRECTORA" | "ALCALDE" | "ADMINISTRADOR";

const sesiones = {} as Record<Rol, Sesion>;

interface Caso {
  metodo: string;
  ruta: string;
  /** Roles que SI deben pasar. El resto debe recibir 403. */
  permitidos: Rol[];
  nota?: string;
}

const TODOS: Rol[] = ["EMPLEADO_DMM", "DIRECTORA", "ALCALDE", "ADMINISTRADOR"];
const OPERACION: Rol[] = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];
const DIRECCION: Rol[] = ["DIRECTORA", "ADMINISTRADOR"];
const REPORTES: Rol[] = ["DIRECTORA", "ALCALDE", "ADMINISTRADOR"];
const ADMIN: Rol[] = ["ADMINISTRADOR"];

const CASOS: Caso[] = [
  // --- Lo que motivo el cambio: ALCALDE fuera de todo el negocio -----------
  { metodo: "GET", ruta: "/api/personas", permitidos: OPERACION },
  {
    metodo: "GET",
    ruta: "/api/personas/1/documentos",
    permitidos: OPERACION,
    nota: "Documentos de identificacion: el peor de los accesos indebidos",
  },
  { metodo: "GET", ruta: "/api/solicitudes", permitidos: OPERACION },
  {
    metodo: "GET",
    ruta: "/api/solicitudes/lista-espera",
    permitidos: OPERACION,
  },
  { metodo: "GET", ruta: "/api/entregas", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/entregas/1/evidencias", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/contratos", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/contratos/vencidos", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/insumos", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/inventario/semaforo", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/recepciones", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/archivos/x.jpg", permitidos: OPERACION },

  // --- Reportes: unico modulo de ALCALDE, y EMPLEADO_DMM queda fuera -------
  {
    metodo: "GET",
    ruta: "/api/reportes/personas-atendidas",
    permitidos: REPORTES,
  },
  {
    metodo: "GET",
    ruta: "/api/reportes/stock-por-categoria",
    permitidos: REPORTES,
  },
  {
    metodo: "GET",
    ruta: "/api/reportes/poblacion-beneficiada",
    permitidos: REPORTES,
  },

  // --- Catalogos que alimentan los filtros de reportes ---------------------
  // ALCALDE SI los lee: sin ellos su unico modulo queda inservible porque no
  // puede poblar ningun <select> de filtro.
  { metodo: "GET", ruta: "/api/comunidades", permitidos: TODOS },
  { metodo: "GET", ruta: "/api/departamentos", permitidos: TODOS },
  { metodo: "GET", ruta: "/api/municipios", permitidos: TODOS },
  { metodo: "GET", ruta: "/api/discapacidades", permitidos: TODOS },
  { metodo: "GET", ruta: "/api/programas", permitidos: TODOS },
  { metodo: "GET", ruta: "/api/categorias-insumo", permitidos: TODOS },

  // --- Catalogos que NO alimentan reportes: ALCALDE fuera ------------------
  { metodo: "GET", ruta: "/api/marcas-insumo", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/unidades-medida", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/instituciones-donantes", permitidos: OPERACION },
  { metodo: "GET", ruta: "/api/tipos-parentesco", permitidos: OPERACION },

  // --- Gestion de catalogos: solo direccion --------------------------------
  { metodo: "POST", ruta: "/api/discapacidades", permitidos: DIRECCION },
  { metodo: "POST", ruta: "/api/programas", permitidos: DIRECCION },
  { metodo: "POST", ruta: "/api/insumos", permitidos: DIRECCION },

  // --- Decisiones de direccion --------------------------------------------
  // Ojo: aprobar/rechazar/anular son POST, no PATCH. Con el metodo equivocado
  // Express no encuentra ruta y responde 404 ANTES de evaluar el rol, asi que
  // el caso pasaria sin haber probado nada.
  { metodo: "POST", ruta: "/api/solicitudes/1/aprobar", permitidos: DIRECCION },
  {
    metodo: "POST",
    ruta: "/api/solicitudes/1/rechazar",
    permitidos: DIRECCION,
  },
  { metodo: "POST", ruta: "/api/entregas/1/anular", permitidos: DIRECCION },
  { metodo: "POST", ruta: "/api/contratos/1/multas", permitidos: DIRECCION },
  {
    metodo: "POST",
    ruta: "/api/solicitudes/1/cancelar",
    permitidos: OPERACION,
  },

  // --- Operacion diaria ----------------------------------------------------
  { metodo: "POST", ruta: "/api/personas", permitidos: OPERACION },
  { metodo: "POST", ruta: "/api/solicitudes", permitidos: OPERACION },
  { metodo: "POST", ruta: "/api/entregas", permitidos: OPERACION },
  { metodo: "POST", ruta: "/api/recepciones", permitidos: OPERACION },

  // --- Exclusivo de administrador -----------------------------------------
  { metodo: "GET", ruta: "/api/usuarios", permitidos: ADMIN },
  { metodo: "POST", ruta: "/api/usuarios", permitidos: ADMIN },
  { metodo: "GET", ruta: "/api/auditoria", permitidos: ADMIN },
  {
    metodo: "GET",
    ruta: "/api/roles",
    permitidos: ADMIN,
    nota: "Su unico consumidor es el select de gestion de usuarios",
  },
];

beforeAll(async () => {
  await resetBaseDePruebas();
  await levantarServidor();
  for (const rol of TODOS) {
    sesiones[rol] = await sesionComo(rol);
  }
}, 60_000);

afterAll(async () => {
  await bajarServidor();
  await cerrarPools();
});

describe("acceso por rol", () => {
  for (const caso of CASOS) {
    const etiqueta = `${caso.metodo} ${caso.ruta}${caso.nota ? ` (${caso.nota})` : ""}`;

    describe(etiqueta, () => {
      for (const rol of TODOS) {
        const deberiaPasar = caso.permitidos.includes(rol);

        it(`${rol} ${deberiaPasar ? "pasa el control" : "recibe 403"}`, async () => {
          const res = await pedir(caso.metodo, caso.ruta, sesiones[rol], {});

          if (deberiaPasar) {
            expect(
              res.status,
              `${rol} deberia pasar pero recibio ${res.status}: ${JSON.stringify(res.cuerpo)}`,
            ).not.toBe(403);
            expect(res.status).not.toBe(401);
          } else {
            expect(
              res.status,
              `${rol} deberia recibir 403 pero recibio ${res.status}: ${JSON.stringify(res.cuerpo)}`,
            ).toBe(403);
          }
        });
      }

      it("sin sesion recibe 401", async () => {
        const res = await pedir(caso.metodo, caso.ruta, null, {});
        expect(res.status).toBe(401);
      });
    });
  }
});
