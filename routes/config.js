import { Router } from "express";

function getPublicConfig() {
    return {
        appid:      String(process.env.CCBILL_CLIENT_APP_ID || ""),
        accnum:     String(process.env.CCBILL_CLIENT_ACCNUM || ""),
        subacc:     String(process.env.CCBILL_CLIENT_SUBACC || ""),
        subacc3ds:  String(process.env.CCBILL_CLIENT_SUBACC_3DS || process.env.CCBILL_CLIENT_SUBACC || "")
    };
}

const router = Router();

router.get("/config.js", (req, res) => {
    const cfg = getPublicConfig();
    res.set("Cache-Control", "no-store");
    res.type("application/javascript").send(
        `window.CCBILL_DEMO_CONFIG=Object.freeze(${JSON.stringify(cfg)});`
    );
});

export default router;
