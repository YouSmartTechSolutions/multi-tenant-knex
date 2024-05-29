import { Request, Response, NextFunction } from "express";
import MultiTenantKnex from "../MultiTenantKnex";

const tenantMiddleware = (multiTenantKnex: MultiTenantKnex) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const tenantIdHeader = req.headers["x-tenant-id"];

    if (!tenantIdHeader) {
      return res.status(400).json({ error: "Missing X-Tenant-Id header" });
    }

    const tenantId = Array.isArray(tenantIdHeader)
      ? tenantIdHeader[0]
      : tenantIdHeader;

    try {
      await multiTenantKnex.setCurrentTenantConnection(tenantId);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    next();
  };
};

export default tenantMiddleware;
