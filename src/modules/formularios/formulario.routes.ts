import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, OPERACION } from "../../config/roles.js";
import {
  listarCatalogosController,
  listarValoresCatalogoController,
  listarTiposDatoController,
  listarFormulariosController,
  obtenerFormularioController,
  listarOpcionesCampoController,
  crearFormularioController,
  editarFormularioController,
  agregarCampoController,
  editarCampoController,
  moverCampoController,
  asignarFormularioCategoriaController,
  listarAsignacionesController,
  formulariosDeInsumoController,
  quitarFormularioCategoriaController,
  listarFormulariosDeLineaController,
  obtenerRespuestasController,
  guardarRespuestasController,
} from "./formulario.controller.js";

const router = Router();

router.get(
  "/catalogos",
  requireAuth,
  requireRole(OPERACION),
  listarCatalogosController,
);
router.get(
  "/catalogos/:id/valores",
  requireAuth,
  requireRole(OPERACION),
  listarValoresCatalogoController,
);
router.get(
  "/tipos-dato",
  requireAuth,
  requireRole(OPERACION),
  listarTiposDatoController,
);

// Los dos GET que faltaban. Sin ellos, la configuración de formularios solo
// se podía leer entrando a la base, y la exigencia de un insumo solo se
// descubría cuando la aprobación ya estaba bloqueada.
router.get(
  "/categorias-formulario",
  requireAuth,
  requireRole(OPERACION),
  listarAsignacionesController,
);
router.get(
  "/insumos/:insumoId/formularios",
  requireAuth,
  requireRole(OPERACION),
  formulariosDeInsumoController,
);

router.get(
  "/",
  requireAuth,
  requireRole(OPERACION),
  listarFormulariosController,
);
router.get(
  "/:id",
  requireAuth,
  requireRole(OPERACION),
  obtenerFormularioController,
);
router.get(
  "/campos/:campoId/opciones",
  requireAuth,
  requireRole(OPERACION),
  listarOpcionesCampoController,
);

router.post(
  "/",
  requireAuth,
  requireRole(DIRECCION),
  crearFormularioController,
);
router.patch(
  "/:id",
  requireAuth,
  requireRole(DIRECCION),
  editarFormularioController,
);
router.post(
  "/:id/campos",
  requireAuth,
  requireRole(DIRECCION),
  agregarCampoController,
);
// Reordenar: mueve un campo un lugar arriba o abajo. Va aparte del PATCH
// porque no edita un valor del campo, lo intercambia con otro registro.
router.post(
  "/campos/:campoId/mover",
  requireAuth,
  requireRole(DIRECCION),
  moverCampoController,
);

router.patch(
  "/campos/:campoId",
  requireAuth,
  requireRole(DIRECCION),
  editarCampoController,
);
router.post(
  "/categorias-formulario",
  requireAuth,
  requireRole(DIRECCION),
  asignarFormularioCategoriaController,
  listarAsignacionesController,
  formulariosDeInsumoController,
);
router.delete(
  "/categorias-formulario/:categoriaId/:formularioId",
  requireAuth,
  requireRole(DIRECCION),
  quitarFormularioCategoriaController,
);

router.get(
  "/lineas/:detalleId",
  requireAuth,
  requireRole(OPERACION),
  listarFormulariosDeLineaController,
);
router.get(
  "/lineas/:detalleId/:formularioId/respuestas",
  requireAuth,
  requireRole(OPERACION),
  obtenerRespuestasController,
);
router.put(
  "/lineas/:detalleId/:formularioId/respuestas",
  requireAuth,
  requireRole(OPERACION),
  guardarRespuestasController,
);

export default router;
