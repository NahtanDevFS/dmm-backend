import { Router } from "express";
import { CATALOGOS_SIMPLES } from "./catalogo-simple.config.js";
import { createCatalogoSimpleRouter } from "./catalogo-simple.routes.js";

const router = Router();

for (const config of Object.values(CATALOGOS_SIMPLES)) {
  router.use(`/${config.slug}`, createCatalogoSimpleRouter(config));
}

// Catálogos con reglas propias (fuera del molde genérico)
//   router.use("/comunidades", comunidadRoutes);
//   router.use("/roles", rolRoutes);
//   router.use("/categorias-insumo", categoriaInsumoRoutes);

export default router;
