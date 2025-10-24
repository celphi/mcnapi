import express from 'express';
const router = express.Router();

function toAmount2(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Number(n.toFixed(2));
}

function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clientIp(req) {
    const xfwd = req.headers['x-forwarded-for'];
    if (typeof xfwd === 'string' && xfwd) return xfwd.split(',')[0].trim();
    if (Array.isArray(xfwd) && xfwd[0]) return xfwd[0].split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || '';
}

async function getBackendToken() {
    const url = process.env.CCBILL_OAUTH_URL || 'https://api.ccbill.com/ccbill-auth/oauth/token';
    const id = process.env.CCBILL_BE_CLIENT_ID;
    const sec = process.env.CCBILL_BE_CLIENT_SECRET;
    if (!id || !sec) throw Object.assign(new Error('server_config_missing_be_credentials'), { status: 500 });

    const auth = 'Basic ' + Buffer.from(`${id}:${sec}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw Object.assign(new Error('token_fetch_failed'), { status: 502, detail: t });
    }
    const j = await resp.json().catch(() => ({}));
    const token = j?.access_token;
    if (!token) throw Object.assign(new Error('token_missing'), { status: 502, detail: j });

    return token;
}

router.post('/purchase', async (req, res) => {
    try {
        const b = req.body || {};
        const paymentTokenId = b.paymentTokenId ?? null;
        const amount2 = toAmount2(b.amount);
        const currencyCode = toInt(b.currencyCode);
        const clientAccnum = toInt(b.clientAccnum);
        const clientSubacc = toInt(b.clientSubacc);
        const threeDS = b.threedsInformation ?? null;

        if (!paymentTokenId || amount2 == null || currencyCode == null || clientAccnum == null || clientSubacc == null) {
            return res.status(400).json({
                error: 'missing_fields',
                need: ['paymentTokenId', 'amount', 'currencyCode', 'clientAccnum', 'clientSubacc']
            });
        }

        const beToken = await getBackendToken();

        let payload = {
            clientAccnum,
            clientSubacc,
            initialPrice: amount2,
            initialPeriod: 30,
            currencyCode
        };
        let endpoint = `https://api.ccbill.com/transactions/payment-tokens/${encodeURIComponent(paymentTokenId)}`;

        if (threeDS && typeof threeDS === 'object') {
            const statusRaw = String(threeDS.status ?? threeDS.threedsStatus ?? '').toUpperCase();
            const success = typeof threeDS.success !== 'undefined'
                ? Boolean(threeDS.success)
                : (typeof threeDS.threedsSuccess !== 'undefined' ? Boolean(threeDS.threedsSuccess) : false);
            const verified = success || ['Y', 'A'].includes(statusRaw);

            payload.threedsAmount = amount2;
            payload.threedsCurrency = currencyCode;

            if (verified) {
                const v = {
                    threedsEci:                 String(threeDS.eci ?? threeDS.threedsEci ?? ''),
                    threedsStatus:              String(statusRaw || 'Y'),
                    threedsSuccess:             true,
                    threedsVersion:             String(threeDS.protocolVersion ?? threeDS.version ?? threeDS.threedsVersion ?? ''),
                    threedsClientTransactionId: String(threeDS.clientTransactionId ?? threeDS.threedsClientTransactionId ?? ''),
                    threedsSdkTransId:          String(threeDS.sdkTransId ?? threeDS.threedsSdkTransId ?? ''),
                    threedsAcsTransId:          String(threeDS.acsTransId ?? threeDS.threedsAcsTransId ?? ''),
                    threedsDsTransId:           String(threeDS.dsTransId ?? threeDS.threedsDsTransId ?? ''),
                    threedsAuthenticationType:  String(threeDS.authenticationType ?? ''),
                    threedsAuthenticationValue: String(threeDS.authenticationValue ?? ''),
                    threedsCardToken:           String(threeDS.cardToken ?? '')
                };
                Object.keys(v).forEach(k => (v[k] === '' || v[k] == null) && delete v[k]);
                payload = { ...payload, ...v };
            } else {
                payload = {
                    ...payload,
                    threedsError:       'AUTHENTICATION_FAILED',
                    threedsErrorDetail: String(threeDS.transStatusReasonDetail ?? 'Card authentication failed'),
                    threedsErrorCode:   String(threeDS.transStatusReason ?? '01'),
                    threedsResponse:    JSON.stringify(threeDS),
                    threedsStatus:      String(statusRaw || 'N'),
                    threedsSuccess:     false,
                    threedsEci:         String(threeDS.eci ?? '07'),
                    threedsVersion:     String(threeDS.protocolVersion ?? threeDS.version ?? '')
                };
            }

            endpoint = `https://api.ccbill.com/transactions/payment-tokens/threeds/${encodeURIComponent(paymentTokenId)}`;
        }

        const ip = clientIp(req);
        const headers = {
            'Accept': 'application/vnd.mcn.transaction-service.api.v.2+json',
            'Authorization': `Bearer ${beToken}`,
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
            'User-Agent': 'mcnapi-3ds-demo/1.0'
        };
        if (ip) headers['X-Origin-IP'] = ip;

        const resp = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const text = await resp.text().catch(() => '');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch {}
        return res.status(resp.status || 200).json(parsed ?? { raw: text, status: resp.status });
    } catch (e) {
        const status = e?.status || 500;
        return res.status(status).json({ error: e?.message || 'internal_error', detail: e?.detail });
    }
});

export default router;
