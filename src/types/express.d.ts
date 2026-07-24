export {};

declare global {
  namespace Express {
    interface Request {
      usuario?: {
        id: number;
        username: string;
        rol: string;
      };
      sesion?: {
        id: string;
      };
    }
  }
}
