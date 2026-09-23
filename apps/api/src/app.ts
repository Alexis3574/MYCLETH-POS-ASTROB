import express from "express";
import { userRouter} from "./modules/users/user.routes.js"
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";
import apiRoutes from "./routes/index.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";

export const app = express();

app.use(helmet());

app.use(
  cors({
    origin: env.corsOrigin,
  })
);

app.use(express.json());

app.use("/api/v1/users", userRouter);  

app.use("/api/v1", apiRoutes);

app.use(errorMiddleware);