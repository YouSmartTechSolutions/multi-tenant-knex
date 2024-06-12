import { Request, Response, NextFunction } from "express";
import MultiTenantKnex from "../MultiTenantKnex";

const mainMiddleware =
  (multiTenantKnex: MultiTenantKnex) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await multiTenantKnex.setCurrentMainConnection();
    } catch (error: any) {
      return res.status(500).json({ error: "Internal server error" });
    }
    next();
  };

export default mainMiddleware;
