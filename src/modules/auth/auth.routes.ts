import { Router } from "express";
import {
  loginController,
  logoutController,
  meController,
} from "./auth.controller.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { limiteLogin } from "../../middlewares/rate-limit.middleware.js";

const router = Router();

// El limite va antes del controller: frena la fuerza bruta contra bcrypt sin
// llegar a calcular el hash.
router.post("/login", limiteLogin, loginController);
router.post("/logout", requireAuth, logoutController);
router.get("/me", requireAuth, meController);

export default router;
