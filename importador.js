/* Lector de resúmenes de tarjeta (Banco Galicia: Visa y Mastercard).
   Todo corre en el teléfono: el PDF no sale del dispositivo. */
(function (root) {
  "use strict";
  const MES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
  const pad = n => String(n).padStart(2, "0");
  const AMT = /-?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/g;
  const toNum = s => parseFloat(s.replace(/\./g, "").replace(",", "."));

  // "25-Sep-26" o "21-05-26" -> "2026-09-25"
  function parseDate(s) {
    const m = /^(\d{1,2})[-/](\d{1,2}|[A-Za-zÁÉÍÓÚáéíóú]{3})[-/](\d{2,4})$/.exec(s);
    if (!m) return null;
    const d = Number(m[1]);
    const mo = /^\d+$/.test(m[2]) ? Number(m[2]) : MES[m[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    let y = Number(m[3]); if (y < 100) y += 2000;
    if (!mo || mo > 12 || d < 1 || d > 31) return null;
    return y + "-" + pad(mo) + "-" + pad(d);
  }

  // Reconstruye las líneas de texto del PDF respetando columnas (como "pdftotext -layout").
  async function extractLines(pdfjsLib, data) {
    const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) < 2.5);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || 0, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let out = "", lastEnd = null;
        for (const it of r.items) {
          if (lastEnd !== null) {
            const gap = it.x - lastEnd;
            out += gap > 12 ? "     " : gap > 1.5 ? " " : "";
          }
          out += it.s;
          lastEnd = it.x + it.w;
        }
        lines.push(out.replace(/\s+$/, ""));
      }
      lines.push("\f");
    }
    return lines;
  }

  // Limpia el nombre del comercio para mostrarlo lindo.
  function cleanRef(ref) {
    let s = ref.replace(/\s+/g, " ").trim();
    s = s.replace(/USD(\s.*)?$/i, "").trim();
    // códigos sueltos al final (ej. "MKX81H1VW", "000000006573666")
    s = s.replace(/\s+(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}$/i, "").replace(/\s+\d{6,}$/, "").trim();
    let pre = "";
    if (/^MERPAGO\*/i.test(s)) { pre = "MP "; s = s.replace(/^MERPAGO\*/i, ""); }
    else if (/^PEDIDOSYA\*/i.test(s)) { pre = "PedidosYa "; s = s.replace(/^PEDIDOSYA\*/i, ""); }
    s = s.toLowerCase().replace(/(^|[\s*/.-])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bSa\b/, "SA").replace(/\*\s*/g, "").trim();
    return (pre + s).trim();
  }
  // Clave para reconocer al comercio la próxima vez (aprende categorías).
  function merchantKey(ref) {
    return ref.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/USD(\s.*)?$/, "").replace(/[^A-Z* ]/g, " ").replace(/\s+/g, " ").trim()
      .split(" ").slice(0, 3).join(" ");
  }

  function parseStatement(lines) {
    const text = lines.join("\n");
    const res = { banco: /galicia/i.test(text) ? "Galicia" : "", tarjeta: "", vencimiento: null, cierre: null, items: [], skipped: [], totalPesos: null, totalUsd: null, usdBase: null };
    const tm = /Tarjeta\s+Cr[ée]dito\s+([A-Z][A-Z ]+?)(?:\s{2,}|$)/m.exec(text);
    res.tarjeta = tm ? tm[1].trim().replace(/\s+/g, " ") : (/VISA/.test(text) ? "VISA" : /MASTER/.test(text) ? "MASTERCARD" : "Tarjeta");
    // Fila de fechas del encabezado: cierre ant., vto ant., cierre, vencimiento, próx. cierre, próx. vto
    for (const l of lines.slice(0, 40)) {
      const ds = l.match(/\b\d{1,2}-[A-Za-z]{3}-\d{2}\b/g);
      if (ds && ds.length >= 4) { res.cierre = parseDate(ds[2]); res.vencimiento = parseDate(ds[3]); break; }
    }
    let inDetail = false;
    for (const raw of lines) {
      const l = raw.replace(/ /g, " ");
      if (/DETALLE DEL CONSUMO/i.test(l)) { inDetail = true; continue; }
      if (/Cuotas a vencer|Plan V:|OPCIONES DE FINANCIACION|INFORMACION INSTITUCIONAL/i.test(l)) inDetail = false;
      const tp = /^\s*TOTAL A PAGAR\s+(\S+)(?:\s+(\S+))?/i.exec(l);
      if (tp && res.totalPesos === null) { res.totalPesos = toNum(tp[1]); if (tp[2]) res.totalUsd = toNum(tp[2]); }
      const base = /\(\s*(\d+(?:\.\d{3})*,\d{2})\s*\)/.exec(l);
      if (base && /RG\s*4240|RG\s*5617|IIBB/i.test(l)) res.usdBase = toNum(base[1]);
      if (!inDetail) continue;
      const m = /^\s*(\d{1,2}-(?:\d{2}|[A-Za-z]{3})-\d{2})\s+(.*)$/.exec(l);
      if (!m) continue;
      const date = parseDate(m[1]);
      let rest = m[2];
      const amounts = rest.match(AMT) || [];
      if (!date || !amounts.length) continue;
      rest = rest.replace(/^(\*|K)\s+/, "");
      const isTax = /^(IIBB|IVA|DB\.?RG|PERCEP|IMP\.|IMPUESTO|SELLOS|COMISION|INTERES|CARGO)/i.test(rest);
      const isUsd = /USD(?=\s|$)/.test(rest);
      const last = amounts[amounts.length - 1];
      const value = toNum(last);
      if (/^(SU PAGO|PAGO|SALDO|BONIF|DEVOLUC|REINTEGRO)/i.test(rest) || value < 0) { res.skipped.push({ date, text: rest.replace(AMT, "").replace(/\s+/g, " ").trim(), amount: value }); continue; }
      // cuota "05/09" (no confundir con fechas ni porcentajes)
      const cm = /(?:^|\s)(\d{2})\/(\d{2})(?=\s)/.exec(rest);
      const cuota = cm ? { k: Number(cm[1]), n: Number(cm[2]) } : null;
      // comprobante: número de 5-6 dígitos antes del importe
      let ref = rest;
      const cut = isTax ? rest.search(/\d+,\d{2}\s*%|\(|\s{3,}/) : rest.search(/\s{3,}|\s(?:\d{2}\/\d{2})\s|USD\s/);
      if (cut > 0) ref = rest.slice(0, cut);
      if (isTax) ref = rest.split("(")[0].replace(/\s+/g, " ").trim();
      const tail = rest.slice(Math.max(0, cut));
      const comp = (/(?:^|\s)(\d{5,6})(?=\s)/.exec(tail.replace(AMT, " ")) || [])[1] || "";
      res.items.push({
        date, raw: ref.replace(/\s+/g, " ").trim(), concept: isTax ? "Impuesto " + ref.replace(/\s+/g, " ").replace(/\s*\d+,\d+\s*%.*$/, "").trim() : cleanRef(ref),
        key: merchantKey(isTax ? "IMPUESTOS TARJETA" : ref), comp, cuota,
        currency: isUsd ? "USD" : "ARS", amount: value, isTax
      });
    }
    return res;
  }

  const api = { extractLines, parseStatement, parseDate, cleanRef, merchantKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Importador = api;
})(typeof window !== "undefined" ? window : globalThis);
