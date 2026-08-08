import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import catalogosRoutes from "../modules/catalogos/catalogos.routes.js";
import geografiaRoutes from "../modules/geografia/geografia.routes.js";
import comunidadRoutes from "../modules/comunidades/comunidad.routes.js";
import personaRoutes from "../modules/personas/persona.routes.js";
import insumoRoutes from "../modules/insumos/insumo.routes.js";
import recepcionRoutes from "../modules/inventario/recepcion.routes.js";
import inventarioRoutes from "../modules/inventario/inventario.routes.js";
import solicitudRoutes from "../modules/solicitudes/solicitud.routes.js";
import entregaRoutes from "../modules/entregas/entrega.routes.js";
import contratoRoutes from "../modules/prestamos/contrato.routes.js";
import reporteRoutes from "../modules/reportes/reporte.routes.js";
import usuarioRoutes from "../modules/usuarios/usuario.routes.js";
import rolRoutes from "../modules/usuarios/rol.routes.js";
import catalogosLecturaRoutes from "../modules/catalogos-lectura/catalogos-lectura.routes.js";
import archivosRoutes from "../lib/storage/archivos.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/", catalogosRoutes);
router.use("/", geografiaRoutes);
router.use("/", catalogosLecturaRoutes);
router.use("/", archivosRoutes);
// /categorias-insumo ya no se monta aquí: desde el esquema v3 es un catálogo
// simple y lo sirve catalogosRoutes por su entrada en catalogo-simple.config.
router.use("/comunidades", comunidadRoutes);
router.use("/personas", personaRoutes);
router.use("/insumos", insumoRoutes);
router.use("/recepciones", recepcionRoutes);
router.use("/inventario", inventarioRoutes);
router.use("/solicitudes", solicitudRoutes);
router.use("/entregas", entregaRoutes);
router.use("/contratos", contratoRoutes);
router.use("/reportes", reporteRoutes);
router.use("/usuarios", usuarioRoutes);
router.use("/roles", rolRoutes);

// Aquí se irán agregando las rutas de los demás módulos
// router.use('/beneficiarios', beneficiariosRoutes);

export default router;
