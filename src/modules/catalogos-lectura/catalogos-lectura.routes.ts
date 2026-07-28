import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import {
  listarTiposGeneroController,
  listarTiposParentescoController,
} from "./catalogos-lectura.controller.js";

const router = Router();

router.get("/tipos-genero", requireAuth, listarTiposGeneroController);
router.get("/tipos-parentesco", requireAuth, listarTiposParentescoController);

export default router;
