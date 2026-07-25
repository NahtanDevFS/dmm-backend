import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import {
  listarDepartamentosController,
  listarMunicipiosController,
} from "./geografia.controller.js";

const router = Router();

router.get("/departamentos", requireAuth, listarDepartamentosController);
router.get("/municipios", requireAuth, listarMunicipiosController);

export default router;
