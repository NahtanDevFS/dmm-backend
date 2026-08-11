import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { SOLO_ADMIN } from "../../config/roles.js";
import { listarRolesController } from "./usuario.controller.js";

/**
 * Solo lista. NO hay CRUD de `rol` y no debe haberlo: los permisos estan
 * codificados en el backend (requireRole en cada ruta), asi que un rol creado
 * desde una pantalla no tendria ningun permiso real. Esta lista existe para
 * poblar el select al crear o editar un usuario.
 */
const router = Router();

// Solo ADMINISTRADOR: su unico consumidor es el select de gestion de usuarios.
router.get("/", requireAuth, requireRole(SOLO_ADMIN), listarRolesController);

export default router;
