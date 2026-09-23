import express from "express";
import cors from "cors";
import helmet from "helmet";
export const app = express();
app.use(helmet());
app.use(cors({
    origin: "http://localhost:5173",
}));
app.use(express.json());
app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        message: "API del POS funcionando correctamente",
    });
});
//# sourceMappingURL=app.js.map