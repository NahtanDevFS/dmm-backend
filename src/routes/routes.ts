import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";

const router = Router();

router.use("/auth", authRoutes);

// Aquí se irán agregando las rutas de los demás módulos
// router.use('/beneficiarios', beneficiariosRoutes);

export default router;
