import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import catalogosRoutes from "../modules/catalogos/catalogos.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/", catalogosRoutes);

// Aquí se irán agregando las rutas de los demás módulos
// router.use('/beneficiarios', beneficiariosRoutes);

export default router;
