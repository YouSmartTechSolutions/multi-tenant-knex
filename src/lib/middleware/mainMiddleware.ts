import { Request, Response, NextFunction } from "express";
import MultiTenantKnex from "../MultiTenantKnex";

const mainMiddleware =
  (multiTenantKnex: MultiTenantKnex) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-tenant-id"]) {
      return res
        .status(400)
        .json({ error: "Non necessary header X-Tenant-Id" });
    }
    try {
      await multiTenantKnex.setCurrentMainConnection();
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
    next();
  };

export default mainMiddleware;
