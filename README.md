<h1 align="center" style="border-bottom: solid 1px;">📦 multi-tenant-knex 🏢</h1>
<h4 align="center">Create multi-tenant applications effortlessly with this library, freeing your mind from the complexities.</h4>

`multi-tenant-knex` is a library designed for building multi-tenant applications using TypeScript and [Knex.js](https://knexjs.org/) for database management with [Objection.js](https://vincit.github.io/objection.js/). It provides utilities to manage multiple tenants seamlessly.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Features](#features)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Installation

Install the library using npm:

```bash
npm install multi-tenant-knex
```

## Usage

### Setup
1. Follow the project structure:
```
knex
  - migrations
      20240527181008_user_table.ts
      20240527181456_tenant_table.ts
      20240527181888_task_table.ts
  - seeds
node_modules
src
  - config
      index.ts
  - controllers
      user.controller.ts
      task.controller.ts
  - db
      knex.ts
  - models
      user.model.ts
      tenant.model.ts
      task.model.ts
      tenantConfig.ts
  - router
      user.routes.ts
      task.routes.ts
      index.ts
app.ts
index.ts
knexfile.ts
```
2. User migration file `20240527181008_user_table.ts`
   
```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table: Knex.TableBuilder) => {
    table.increments();
    table.timestamps(true, true);
    table.string('name').unique().notNullable();
    table.string('email').unique().notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('users');
}
```
3. Tenant migration file `20240527181456_tenant_table.ts`
```typescript
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenants', (table: Knex.TableBuilder) => {
    table.increments();
    table.timestamps(true, true);
    table.string('name').unique().notNullable();
    table.string('subdomain').notNullable();
    table.string('dbName').notNullable();
    table.string('status').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('tenants');
}
```

4. Initialize your Knex instance. (Example of `knexfile.ts`)

```typescript
import * as path from 'path';
import objection from 'objection';
import { config } from './src/config';

const defaultKnexConfig = {
  client: 'pg',
  migrations: {
    tableName: 'knex_migrations',
    directory: path.resolve('knex/migrations'),
  },
  seeds: {
    directory: path.resolve('knex/seeds'),
  },
  ...objection.knexSnakeCaseMappers(),
  useNullAsDefault: true,
};

export default {
  development: {
    ...defaultKnexConfig,
    connection: {
      host: config.dbHost,
      port: Number(config.dbPort),
      user: config.dbUser,
      database: config.dbDatabase,
      password: config.dbPassword,
    },
  },
};
```
5. Create the config file of environment variables (Example of `src/config/index.ts`)
```typescript
import * as dotenv from 'dotenv';

dotenv.config();

enum NodeEnv {
  DEV = 'development',
}

interface Env {
  env: NodeEnv;
  appPort: number;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbDatabase: string;
  dbPassword: string;
  //jwtSecret: string; (if you want use JWT instead of a single header)
}

export const config: Env = {
  env: (process.env.NODE_ENV as NodeEnv) || NodeEnv.DEV,
  appPort: Number(process.env.HTTP_PORT) || 5432,
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: Number(process.env.DB_PORT) || 3000,
  dbUser: process.env.DB_USER || 'default',
  dbDatabase: process.env.DB_NAME || 'default',
  dbPassword: process.env.DB_PASS || 'default',
  //jwtSecret: process.env.JWT_SECRET || 'secret', (if you want use JWT instead of a single header)
};

```

6. Create the tenant config file in the models package. (Example of `src/models/tenantConfig.ts`)

```typescript
import knexConfig from '../../knexfile';
import { config } from '../config';
import { fileURLToPath } from 'url';
import path from 'path';
import { MultiTenantKnex, mainMiddleware, tenantMiddleware } from 'multi-tenant-knex';

// Derive the directory name from the ES module URL
const __filename = fileURLToPath(import.meta.url);
const modelsPath = path.dirname(__filename);

const multi = new MultiTenantKnex(knexConfig[config.env], modelsPath);
multi.buildMainORM();
multi.buildTenantORMs().then(() => {
  console.log('Tenant ORM built');
});
const db = () => multi.getCurrentORM();

export const TenantConfig = {
  multi,
  db,
  mainMiddleware: mainMiddleware(multi),
  tenantMiddleware: tenantMiddleware(multi), tenantMiddleware: tenantMiddleware(multi), // Use only the x-tenant-id, but if you want to use JWT you can add a new parameter.
};
```
Example:

```javascript
tenantMiddleware(multi, config.jwtSecret)
```

7. Create the controller responsible for creating users and tenants. (Example of `src/controllers/user.controller.ts`)

```typescript
import { Request, Response } from 'express';
import { TenantConfig } from '../models/tenantConfig';
import { StatusCodes } from 'http-status-codes';

export const create = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { name, email } = req.body;
  try {
    // Attempt to create a user in the main database
    await TenantConfig.multi.buildMainORM();
    await TenantConfig.db().User.query().insert({
      name,
      email,
    });

    try {
      // Attempt to create the tenant
      const tenant = await TenantConfig.multi.createTenant(name);

      TenantConfig.multi.setCurrentORM(tenant.subdomain);
      TenantConfig.multi.migrate();

      // Create the user in the tenant's database
      const user = await TenantConfig.db().User.query().insert({
        name,
        email,
      });

      return res.status(StatusCodes.CREATED).json({
        name: user.name,
        email: user.email,
        tenant_id: tenant.subdomain,
      });
    } catch (e: any) {
      return res.status(StatusCodes.CONFLICT).json({ error: e.message });
    }
  } catch (e) {
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: 'An error occurred while creating the user' + e });
  }
};

export const UserController = {
  create,
};

```

8. Setup the route to use the main middleware (Example of `src/router/user.routes.ts`)
```typescript
import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { TenantConfig } from '../models/tenantConfig';

const router = Router();

router.post('/', TenantConfig.mainMiddleware, UserController.create);

export default router;
```
9. Setup the route to use the tenant middleware (Example of `src/router/task.routes.ts`)
```typescript
import { Router } from 'express';
import { TaskController } from '../controllers/task.controller';
import { TenantConfig } from '../models/tenantConfig';

const router = Router();

router.get('/', TenantConfig.tenantMiddleware, TaskController.list);

export default router;
```

### Build

To build the library, run:

```bash
npm run build
```

This will generate the CommonJS and ES Module outputs along with the type definitions in the `dist` directory.

## Features

- Supports multi-tenancy for PostgreSQL utilizing Knex.js and Objection.js.
- Facilitates simple tenant management with dynamic configuration.
- Developed in TypeScript for enhanced type safety and an improved developer experience.
- Simplifies implementation with JWT token support.

## Contributing

Contributions are welcome! Please follow these steps to contribute:

1. Fork the repository.
2. Create a new branch: `git checkout -b feature/your-feature-name`.
3. Make your changes and commit them: `git commit -m 'Add some feature'`.
4. Push to the branch: `git push origin feature/your-feature-name`.
5. Create a pull request.

Please make sure your code follows the project's coding standards and includes tests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments
Special thanks to the 📦🚀 [Cilo](https://github.com/khaled-badenjki/cilo), Knex.js and TypeScript communities for their valuable tools and contributions.
