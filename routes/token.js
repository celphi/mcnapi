import express from 'express';
const router = express.Router();

async function fetchToken(clientId, clientSecret, tokenUrl) {
    const auth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
        let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
        return { status: resp.status, json: { error: 'token_fetch_failed', detail: j } };
    }
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: 200, json };
}

router.post('/fe-token', async (_req, res) => {
    const id = process.env.CCBILL_FE_CLIENT_ID;
    const sec = process.env.CCBILL_FE_CLIENT_SECRET;
    const url = process.env.CCBILL_OAUTH_URL || 'https://api.ccbill.com/ccbill-auth/oauth/token';
    if (!id || !sec) return res.status(500).json({ error: 'server_config_missing_fe_credentials' });
    const { status, json } = await fetchToken(id, sec, url);
    res.status(status).json(json);
});

router.post('/be-token', async (_req, res) => {
    const id = process.env.CCBILL_BE_CLIENT_ID;
    const sec = process.env.CCBILL_BE_CLIENT_SECRET;
    const url = process.env.CCBILL_OAUTH_URL || 'https://api.ccbill.com/ccbill-auth/oauth/token';
    if (!id || !sec) return res.status(500).json({ error: 'server_config_missing_be_credentials' });
    const { status, json } = await fetchToken(id, sec, url);
    res.status(status).json(json);
});

export default router;
