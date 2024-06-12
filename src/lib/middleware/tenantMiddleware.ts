import { Request, Response, NextFunction } from "express";
import MultiTenantKnex from "../MultiTenantKnex";
import jwt from "jsonwebtoken";

const tenantMiddleware = (
  multiTenantKnex: MultiTenantKnex,
  jwtSecret: string = ""
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    let tenantId: string | undefined;

    // Check for the Authorization header
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];

      try {
        // Verify the token
        const decodedToken = jwt.verify(token, jwtSecret);
        tenantId = (decodedToken as any).tenantId;
      } catch (error: any) {
        return res.status(401).json({ error: "Invalid token" });
      }
    }

    // Check for the x-tenant-id header
    const tenantIdHeader = req.headers["x-tenant-id"];
    if (tenantIdHeader) {
      tenantId = Array.isArray(tenantIdHeader)
        ? tenantIdHeader[0]
        : tenantIdHeader;
    }

    // Ensure a tenant ID has been determined
    if (!tenantId) {
      return res
        .status(400)
        .json({ error: "Missing X-Tenant-Id header and token tenant ID" });
    }

    try {
      // Set the tenant connection using the determined tenant ID
      await multiTenantKnex.setCurrentTenantConnection(tenantId);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    next();
  };
};

export default tenantMiddleware;
