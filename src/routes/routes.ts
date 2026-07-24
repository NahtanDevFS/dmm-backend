import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import catalogosRoutes from "../modules/catalogos/catalogos.routes.js";
import geografiaRoutes from "../modules/geografia/geografia.routes.js";
import comunidadRoutes from "../modules/comunidades/comunidad.routes.js";
import categoriaInsumoRoutes from "../modules/categoria-insumo/categoria-insumo.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/", catalogosRoutes);
router.use("/", geografiaRoutes);
router.use("/comunidades", comunidadRoutes);
router.use("/categorias-insumo", categoriaInsumoRoutes);

// Aquí se irán agregando las rutas de los demás módulos
// router.use('/beneficiarios', beneficiariosRoutes);

export default router;
