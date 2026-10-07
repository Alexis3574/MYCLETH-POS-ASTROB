import { productRouter, categoryRouter, unitRouter, taxRouter } from "./modules/products/product.routes.js";
import express from "express";
import { userRouter} from "./modules/users/user.routes.js"
import { saleRouter } from "./modules/sales/sale.routes.js";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";
import apiRoutes from "./routes/index.js";
import { roleRouter } from "./modules/roles/role.routes.js";
import { userRoleRouter } from "./modules/user-roles/user-role.routes.js";
import { permissionRouter } from "./modules/permissions/permission.routes.js";
import { rolePermissionRouter } from "./modules/role-permissions/role-permission.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";

export const app = express();

app.use(helmet());

app.use(cors({ origin: env.corsOrigin, }));

app.use(express.json());

app.use( "/api/v1/auth",authRouter,);

app.use("/api/v1/users", userRouter);  

app.use("/api/v1/users", userRoleRouter,);

app.use("/api/v1/roles", roleRouter);

app.use( "/api/v1/roles", rolePermissionRouter,);

app.use( "/api/v1/permissions", permissionRouter,);

app.use("/api/v1/sales", saleRouter);

app.use("/api/v1/products", productRouter);
app.use("/api/v1/categories", categoryRouter);
app.use("/api/v1/units", unitRouter);
app.use("/api/v1/taxes", taxRouter);

app.use("/api/v1", apiRoutes);

app.use(errorMiddleware);