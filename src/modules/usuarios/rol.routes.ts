import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { ADMINISTRACION } from "../../config/roles.js";
import { listarRolesController } from "./usuario.controller.js";

/** Solo lista */
const router = Router();

// Solo ADMINISTRADOR: su unico consumidor es el select de gestion de usuarios
router.get("/", requireAuth, requireRole(ADMINISTRACION), listarRolesController);

export default router;
