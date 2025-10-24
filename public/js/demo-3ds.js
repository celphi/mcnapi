'use strict';

class CCBill3DSDemo {
  constructor(opts = {}) {
    const env = window.CCBILL_DEMO_CONFIG ?? {};
    this.appId = opts.appId ?? env.appid ?? '';
    this.accnum = opts.accnum ?? env.accnum ?? '';
    this.subacc = opts.subacc ?? env.subacc ?? '';
    this.subacc3d = opts.subacc3ds ?? env.subacc3ds ?? this.subacc;

    this.els = {
      log: this.qs('#log'),
      tokenBox: this.qs('#tokenBox'),
      form: this.qs('#payForm'),
      force3ds: this.qs('#force3ds'),
      amount: this.qs('#amount'),
      currency: this.qs('#currencyCode'),
    };
  }

  qs(sel, root = document) { return root.querySelector(sel); }

  log(msg, obj) {
    const t = new Date().toLocaleTimeString();
    const line = `[${t}] ${msg}`;
    const body = obj !== undefined ? `\n${JSON.stringify(obj, null, 2)}` : '';
    if (this.els.log) this.els.log.textContent += `\n${line}${body}`;
    console.log(line, obj ?? '');
  }

  sanitize(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  flattenGateway(o) {
    if (!o || typeof o !== 'object') return null;
    const parts = [];
    if (o.generalMessage) parts.push(o.generalMessage);
    if (Array.isArray(o.errors)) parts.push(...o.errors.map(x => `${x.field || 'error'}: ${x.message || ''}`.trim()));
    if (o.errorCode) parts.push(`code ${o.errorCode}`);
    if (o.declineText) parts.push(`decline: ${o.declineText}`);
    if (o.declineCode) parts.push(`(${o.declineCode})`);
    return parts.length ? this.sanitize(parts.join(' | ')) : null;
  }

  err(e) {
    if (e == null) return '';
    if (typeof e === 'string') {
      try { const j = JSON.parse(e); return this.flattenGateway(j) || this.sanitize(e); } catch { return this.sanitize(e); }
    }
    if (e instanceof Error) return this.sanitize(`${e.name || 'Error'}: ${e.message || ''}`);
    const flat = this.flattenGateway(e);
    if (flat) return flat;
    try { return this.sanitize(JSON.stringify(e)); } catch { return this.sanitize(String(e)); }
  }

  async getJSON(res) {
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${this.sanitize(txt)}`);
    }
    return res.json();
  }

  async fetchFeToken() {
    const res = await fetch('/fe-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const j = await this.getJSON(res);
    if (!j?.access_token) throw new Error('no access_token');
    return j.access_token;
  }

  async isScaRequired(widget, feToken) {
    const resp = await widget.isScaRequired(feToken, this.accnum, this.subacc3d);
    const data = await resp.json();
    const scaRequired = typeof data === 'boolean' ? data : Boolean(data?.scaRequired);
    this.log('isScaRequired', { status: 200, scaRequired, raw: data });
    if (this.els.force3ds?.checked) {
      this.log('Force 3DS demo is ON');
      return true;
    }
    return scaRequired;
  }

  async authenticate(widget, feToken) {
    const data = await widget.authenticateCustomer(feToken, this.accnum, this.subacc3d);
    this.log('authenticateCustomer', { status: 200, data });
    return data;
  }

  threedsSucceeded(info) {
    return info?.success === true || ['Y', 'A'].includes(String(info?.status || '').toUpperCase());
  }

  async createPaymentToken(widget, feToken, useSubacc) {
    const resp = await widget.createPaymentToken(feToken, this.accnum, useSubacc);
    const data = await resp.json();
    this.log('createPaymentToken RESP', { status: 200, body: data });
    const id = data?.paymentTokenId || data?.id || null;
    if (!id) throw new Error('No paymentTokenId in response');
    return id;
  }

  bindEvents() {
    this.els.form?.addEventListener('submit', (e) => this.onSubmit(e));
  }

  async onSubmit(ev) {
    ev.preventDefault();

    if (!this.appId || !this.accnum || !this.subacc) {
      alert('Missing data-appid / data-accnum / data-subacc on <body>.');
      return;
    }

    let feToken;
    try {
      feToken = await this.fetchFeToken();
      this.log('Fetched FE token');
    } catch (e) {
      this.log('FE token fetch failed', { error: this.err(e) });
      alert('Could not get FE token. See log.');
      return;
    }

    const widget = new ccbill.CCBillAdvancedWidget(this.appId);

    const scaRequired = await this.isScaRequired(widget, feToken);

    let threedsInformation = null;
    if (scaRequired) {
      try {
        threedsInformation = await this.authenticate(widget, feToken);
      } catch (e) {
        this.log('authenticateCustomer failed', { error: this.err(e) });
        alert('3-D Secure authentication failed — cannot proceed.');
        return;
      }
      if (!this.threedsSucceeded(threedsInformation)) {
        this.log('3DS authentication failed; not submitting charge', { threedsInformation });
        alert('3-D Secure authentication failed. We did not attempt a charge.');
        return;
      }
    }

    const usedSubacc = scaRequired ? this.subacc3d : this.subacc;

    let paymentTokenId;
    try {
      paymentTokenId = await this.createPaymentToken(widget, feToken, usedSubacc);
    } catch (e) {
      this.log('createPaymentToken failed', { error: this.err(e) });
      alert('Payment token creation failed — see log.');
      return;
    }

    const amount = parseFloat(this.els.amount?.value || '1.00');
    const currencyCode = Number(this.els.currency?.value || '840');

    const body = {
      paymentTokenId,
      amount,
      currencyCode,
      clientAccnum: Number(this.accnum),
      clientSubacc: Number(usedSubacc),
    };
    if (scaRequired) body.threedsInformation = threedsInformation;

    try {
      const res = await fetch('/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await this.getJSON(res);
      this.log('/purchase response', { status: res.status, data });
      if (data.approved === true || data.status === 'approved' || data.result === 'approved') {
        alert('Payment approved!');
      } else if (data.errors || data.error || data.generalMessage) {
        alert('Charge error — see log.');
      } else {
        alert('Charge completed — see log for details.');
      }
    } catch (e) {
      this.log('charge call failed', { error: this.err(e) });
      alert('Charge call failed — see log.');
    }
  }

  init() {
    this.bindEvents();
    this.log('Ready.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const demo = new CCBill3DSDemo();
  demo.init();
});
