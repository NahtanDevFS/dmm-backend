import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { listarRolesController } from "./usuario.controller.js";

/**
 * Solo lista. NO hay CRUD de `rol` y no debe haberlo: los permisos estan
 * codificados en el backend (requireRole en cada ruta), asi que un rol creado
 * desde una pantalla no tendria ningun permiso real. Esta lista existe para
 * poblar el select al crear o editar un usuario.
 */
const router = Router();

router.get("/", requireAuth, listarRolesController);

export default router;
