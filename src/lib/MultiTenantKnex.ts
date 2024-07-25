import * as fs from "fs";
import * as path from "path";
import { Knex, knex } from "knex";
import { iTenant } from "./interfaces/tenant.interface";
import { IMigration } from "./interfaces/migration.interface";
import * as util from "util";

const readdirAsync = util.promisify(fs.readdir);

class MultiTenantKnex {
  private systemKnexConfig: Knex.Config;
  private tenantKnexConfig: Knex.Config;
  private systemKnex: Knex;
  private tenantKnex: Knex;
  private systemModelsPath: string;
  private tenantModelsPath: string;
  private tenantConnections: { [key: string]: Knex };
  private tenantORMs: { [key: string]: any };
  private mainORM: any;
  private currentORM: any;
  private tenantSeedRoute: string;

  constructor(
    systemKnexConfig: Knex.Config,
    tenantKnexConfig: Knex.Config,
    systemModelsPath: string,
    tenantModelsPath: string
  ) {
    this.systemKnexConfig = systemKnexConfig;
    this.tenantKnexConfig = tenantKnexConfig;
    this.systemModelsPath = systemModelsPath;
    this.tenantModelsPath = tenantModelsPath;
    this.tenantConnections = {};
    this.tenantORMs = {};
    this.mainORM = {};
    this.systemKnex = knex(systemKnexConfig);
    this.tenantKnex = knex(tenantKnexConfig);
    this.currentORM = this.mainORM;
    this.tenantSeedRoute = "../../../knex/seeds/tenant";
  }

  async buildMainORM() {
    this.mainORM = await this._importModels(
      this.systemKnex,
      this.systemModelsPath
    );
  }

  async createTenant(subdomain: string) {
    subdomain = subdomain.toLowerCase();
    let tenant: iTenant;
    try {
      tenant = await this.mainORM.Tenant.query().insert({
        name: subdomain,
        status: "active",
        subdomain,
        dbName: `tenant_${subdomain}`,
      });
    } catch (error: any) {
      console.error(error);
      if (error.code === "23505") {
        throw new Error("Subdomain already exists");
      } else {
        throw new Error("Something went wrong");
      }
    }

    // Create a new database for the tenant
    await this.systemKnex.raw(`CREATE DATABASE tenant_${subdomain}`);

    // Create a new connection for the tenant
    const tenantConnection = this._createTenantConnection(subdomain);

    const pathSeeds = path.join(this.tenantModelsPath, this.tenantSeedRoute);

    // Create the tenant's tables
    const migrationTenant = await this._initializeMigrations(tenantConnection);
    if (migrationTenant) await migrationTenant();

    // Seed the tenant's tables
    const seedersTenant = await this._initializeSeeders(
      tenantConnection,
      pathSeeds
    );
    await seedersTenant();

    // Create the tenant's ORM
    this.tenantORMs[subdomain] = await this._importModels(
      tenantConnection,
      this.tenantModelsPath
    );

    return tenant;
  }

  private _createTenantConnection(subdomain: string): Knex {
    if (this.tenantConnections[subdomain]) {
      this.tenantConnections[subdomain].destroy();
    }
    const tenantConnection = knex({
      ...this.tenantKnexConfig,
      connection: {
        ...(this.tenantKnexConfig.connection as object),
        database: `tenant_${subdomain}`,
      },
    });
    this.tenantConnections[subdomain] = tenantConnection;
    return tenantConnection;
  }

  async migrate() {
    //await this.migrateMainDb();
    await this.migrateAllTenants();
    await this.seedsAllTenants();
  }

  async migrateMainDb() {
    const migrateMainDb = await this._initializeMigrations(this.tenantKnex);
    try {
      if (migrateMainDb) await migrateMainDb();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error initializing migrations:", error);
      } else {
        console.error("Unexpected error initializing migrations:", error);
      }
      throw error;
    }
  }

  private async _initializeMigrations(
    connection: Knex
  ): Promise<(() => Promise<void>) | null> {
    try {
      const migrationFiles: IMigration[][] = await connection.migrate.list();

      // Check if there are any pending migrations
      const pendingMigrations = migrationFiles[1]; // migrationFiles[1] contains the pending migrations
      console.log("pendingMigrations v1.1.0", pendingMigrations);

      if (pendingMigrations.length === 0) {
        console.log(
          "No new migrations to run. Migrations are already up to date."
        );
        return null;
      }

      // Return a function that runs the migrations sequentially if needed
      return async () => {
        for (const migrationFile of pendingMigrations) {
          await connection.migrate.up({
            name: migrationFile.file || migrationFile.name,
          });
        }
      };
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error initializing migrations:", error);
      } else {
        console.error("Unexpected error initializing migrations:", error);
      }
      throw error;
    }
  }

  private async _initializeSeeders(
    connection: Knex,
    globPattern: string
  ): Promise<() => Promise<void>> {
    try {
      const seedDirectory = globPattern;
      const seedFiles = await readdirAsync(seedDirectory);
      const seeders: (() => Promise<void>)[] = [];

      for (const seedFile of seedFiles) {
        const seedPath = path.join(seedDirectory, seedFile);
        const seederModule = await import(seedPath);
        if (typeof seederModule.seed === "function") {
          seeders.push(() => seederModule.seed(connection));
        }
      }

      return async () => {
        for (const seeder of seeders) {
          await seeder();
        }
      };
    } catch (error) {
      console.error("Error initializing seeders:", error);
      throw error;
    }
  }

  async migrateAllTenants() {
    try {
      const tenants = await this.getDbTenants();
      const migrationPromises = tenants.map(async (tenant) => {
        const tenantConnection = this._createTenantConnection(tenant.subdomain);
        return this._initializeMigrations(tenantConnection);
      });

      const migrationFunctions = await Promise.all(migrationPromises);

      for (const migrate of migrationFunctions) {
        if (migrate) {
          try {
            await migrate();
          } catch (error) {
            if (error instanceof Error) {
              console.warn("Migration warning for tenant", error);
            } else {
              throw error;
            }
          }
        }
      }

      console.log("All tenant migrations completed successfully.");
    } catch (error) {
      console.error("Error migrating all tenants:", error);
      throw error;
    }
  }

  async seedsAllTenants() {
    try {
      const tenants = await this.getDbTenants();
      const pathSeeds = path.join(this.tenantModelsPath, this.tenantSeedRoute);
      const seedsPromises = tenants.map(async (tenant) => {
        const tenantConnection = this._createTenantConnection(tenant.subdomain);
        return this._initializeSeeders(tenantConnection, pathSeeds);
      });

      const seedsFunctions = await Promise.all(seedsPromises);

      for (const seed of seedsFunctions) {
        if (seed) {
          try {
            await seed();
          } catch (error) {
            if (error instanceof Error) {
              console.warn("Seed warning for tenant", error);
            } else {
              throw error;
            }
          }
        }
      }

      console.log("All tenant seeds completed successfully.");
    } catch (error) {
      console.error("Error seeding all tenants:", error);
      throw error;
    }
  }

  async getDbTenants(): Promise<iTenant[]> {
    const query = this.systemKnex.queryBuilder().select("*").from("Tenants");
    const tenants = await query;
    return tenants;
  }

  async buildTenantConnections() {
    const tenants = await this.getDbTenants();
    tenants.forEach((tenant) => {
      this._createTenantConnection(tenant.subdomain);
    });
  }

  async buildTenantORMs() {
    if (Object.keys(this.tenantConnections).length === 0) {
      await this.buildTenantConnections();
    }
    for (const subdomain in this.tenantConnections) {
      this.tenantORMs[subdomain] = await this._importModels(
        this.tenantConnections[subdomain],
        this.tenantModelsPath
      );
    }
  }

  setCurrentORM(subdomain: string) {
    if (!this.tenantORMs[subdomain]) {
      throw new Error(`No tenant with subdomain ${subdomain}`);
    }
    this.currentORM = this.tenantORMs[subdomain];
    console.log("currentORM", this.currentORM);
  }

  async setCurrentTenantConnection(subdomain: string) {
    if (!this.tenantORMs[subdomain]) {
      throw new Error(`No tenant with subdomain ${subdomain}`);
    }
    const tenantConnection = this._createTenantConnection(subdomain);
    this.tenantORMs[subdomain] = await this._importModels(
      tenantConnection,
      this.tenantModelsPath
    );
    this.currentORM = this.tenantORMs[subdomain];
    console.log("currentORM", this.currentORM);
  }

  async setCurrentMainConnection() {
    this.mainORM = await this._importModels(
      this.systemKnex,
      this.systemModelsPath
    );
    this.currentORM = this.mainORM;
  }

  getCurrentORM() {
    if (!this.currentORM) {
      throw new Error("No current db set");
    }
    return this.currentORM;
  }

  private async _importModels(connection: Knex, modelsPath: string) {
    const orm: { [key: string]: any } = {};
    const modelFiles = this._getModelFiles(modelsPath);
    console.log('hey', modelsPath);
    await Promise.all(
      modelFiles.map(async (file) => {
        const modelModule = await import(path.join(modelsPath, file));
        for (const modelName in modelModule) {
          orm[modelName] = modelModule[modelName];
          modelModule[modelName].knex(connection);
        }
      })
    );

    Object.keys(orm).forEach((modelName) => {
      const modelClass = orm[modelName];
      if (modelClass.associate) {
        modelClass.associate(orm);
      }
    });

    return orm;
  }

  private _getModelFiles(dirPath: string) {
    return fs.readdirSync(dirPath).filter((file) => {
      return (
        file.indexOf(".") !== 0 &&
        file.slice(-9) === ".model.ts" &&
        file.indexOf(".test.ts") === -1
      );
    });
  }
}

export default MultiTenantKnex;
