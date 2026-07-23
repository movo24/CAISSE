import { PublicTicketData } from './public-ticket.service';

/** Échappement HTML — toute donnée dynamique passe ici (anti-XSS). */
function esc(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** data-URL image sûre (uniquement png/jpeg base64 — jamais de SVG/script). */
function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  if (/^https:\/\/[^"'\s]+$/.test(url)) return url;
  return null;
}

function money(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2).replace('.', ',') + ' €';
}

function fmtRate(rate: number): string {
  return (Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/\.?0+$/, '')).replace('.', ',');
}

/**
 * Page publique mobile-first du ticket numérique — identité The Wesley
 * (magenta #E5117A / encre #3B0A22, source : pos-desktop ClientDisplayPage).
 * Zéro donnée interne (marges, prix d'achat, technique), zéro tracking,
 * lecture seule stricte : la page reproduit la vente scellée.
 */
export function buildTicketPageHtml(data: PublicTicketData, token: string): string {
  const tz = data.store.timezone || 'Europe/Paris';
  const dateStr = new Date(data.date).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: tz,
  });

  const logoSrc = safeImageSrc(data.store.logoUrl);
  const cityLine = [data.store.postalCode, data.store.city].filter(Boolean).join(' ');

  // ── Bandeau de statut : annulé / remboursé / avoir — sans réécrire le ticket ──
  let statusBanner = '';
  if (data.status === 'voided') {
    statusBanner = `<div class="banner banner-voided">Ticket annulé — cette vente a été annulée. Le ticket d'origine reste consultable ci-dessous.</div>`;
  } else if (data.creditNotes.length > 0) {
    const refunded = data.creditNotes.reduce((s, cn) => s + cn.totalMinorUnits, 0);
    const kinds = data.creditNotes.some((cn) => cn.type === 'refund') ? 'Remboursement' : 'Avoir';
    const full = refunded >= data.totalMinorUnits;
    statusBanner = `<div class="banner banner-refund">${kinds} ${full ? 'total' : 'partiel'} — ${esc(
      data.creditNotes.map((cn) => cn.code).join(', '),
    )} (${money(refunded)}). Le ticket d'origine ci-dessous n'est pas modifié.</div>`;
  } else if (data.status === 'payment_pending') {
    statusBanner = `<div class="banner banner-pending">Paiement en cours de régularisation.</div>`;
  }

  const itemsHtml = data.items
    .map((i) => {
      const discount =
        i.discountMinorUnits > 0
          ? `<div class="item-discount">Remise −${money(i.discountMinorUnits)}</div>`
          : '';
      return `<div class="item">
  <div class="item-main">
    <div class="item-name">${esc(i.name)}</div>
    <div class="item-detail">${i.quantity} × ${money(i.unitPriceMinorUnits)}${discount}</div>
  </div>
  <div class="item-total">${money(i.lineTotalMinorUnits)}</div>
</div>`;
    })
    .join('\n');

  const vatRows = data.vatBreakdown
    .map(
      (v) =>
        `<tr><td>TVA ${fmtRate(v.rate)} %</td><td>${money(v.htMinorUnits)}</td><td>${money(
          v.tvaMinorUnits,
        )}</td><td>${money(v.ttcMinorUnits)}</td></tr>`,
    )
    .join('');

  const paymentsHtml = data.payments
    .map((p) => `<div class="row"><span>${esc(p.label)}</span><span>${money(p.amountMinorUnits)}</span></div>`)
    .join('');

  const contactBits = [
    data.store.phone ? `<a href="tel:${esc(data.store.phone)}">${esc(data.store.phone)}</a>` : '',
    data.store.email ? `<a href="mailto:${esc(data.store.email)}">${esc(data.store.email)}</a>` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const legalBits = [
    data.store.operatingCompanyName ? esc(data.store.operatingCompanyName) : '',
    data.store.siret ? `SIRET ${esc(data.store.siret)}` : '',
    data.store.rcs ? `RCS ${esc(data.store.rcs)}` : '',
    data.store.tvaIntracom ? `TVA ${esc(data.store.tvaIntracom)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const site = data.store.websiteUrl && /^https?:\/\//.test(data.store.websiteUrl) ? data.store.websiteUrl : null;

  const recoItems = data.recommendations.enabled
    ? data.recommendations.items
        .map((p) => {
          const img = safeImageSrc(p.imageUrl);
          const oldPrice =
            p.oldPriceMinorUnits && p.oldPriceMinorUnits > p.priceMinorUnits
              ? `<span class="reco-old">${money(p.oldPriceMinorUnits)}</span>`
              : '';
          return `<div class="reco-card">
  ${img ? `<img src="${img}" alt="${esc(p.name)}" loading="lazy">` : '<div class="reco-noimg">🍬</div>'}
  <div class="reco-name">${esc(p.name)}</div>
  <div class="reco-price">${money(p.priceMinorUnits)} ${oldPrice}</div>
</div>`;
        })
        .join('\n')
    : '';

  const recoSection =
    data.recommendations.enabled && (recoItems || site)
      ? `<section class="card reco">
  <h2>Nos nouveautés</h2>
  ${recoItems ? `<div class="reco-grid">${recoItems}</div>` : ''}
  ${site ? `<a class="btn btn-primary" href="${esc(site)}" rel="noopener">Découvrir les nouveautés</a>` : ''}
</section>`
      : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>Ticket ${esc(data.ticketNumber)} — ${esc(data.store.name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--magenta:#E5117A;--magenta-deep:#B3125A;--ink:#3B0A22;--paper:#FFF6FA;--line:#F3D9E6}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Nunito',sans-serif;background:var(--paper);color:var(--ink);padding:14px;padding-bottom:40px}
.wrap{max-width:430px;margin:0 auto}
.card{background:#fff;border-radius:18px;box-shadow:0 3px 16px rgba(59,10,34,.08);overflow:hidden;margin-bottom:14px}
.hero{background:linear-gradient(150deg,var(--magenta),var(--magenta-deep));color:#fff;padding:26px 20px;text-align:center}
.hero img.logo{max-width:150px;max-height:72px;object-fit:contain;background:#fff;border-radius:12px;padding:6px 12px;margin-bottom:10px}
.hero .store-name{font-size:20px;font-weight:800;letter-spacing:.3px}
.hero .total{font-size:38px;font-weight:900;margin:10px 0 2px}
.hero .meta{font-size:12px;opacity:.85}
.banner{padding:12px 16px;font-size:13px;font-weight:600;text-align:center}
.banner-voided{background:#7f1d1d;color:#fff}
.banner-refund{background:#b45309;color:#fff}
.banner-pending{background:#92400e;color:#fff}
.body{padding:18px}
.store-block{text-align:center;padding-bottom:14px;border-bottom:1px dashed var(--line);margin-bottom:14px}
.store-block p{font-size:12px;color:#7a5566;margin-top:2px}
.store-block a{color:var(--magenta-deep);text-decoration:none}
.item{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #faeef4}
.item-name{font-size:14px;font-weight:600}
.item-detail{font-size:12px;color:#7a5566;margin-top:2px}
.item-discount{font-size:12px;color:var(--magenta-deep);font-weight:600}
.item-total{font-size:14px;font-weight:700;white-space:nowrap}
.row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
.totals{margin-top:12px}
.totals .row.sub{color:#7a5566}
.totals .row.discount{color:var(--magenta-deep);font-weight:600}
.grand{display:flex;justify-content:space-between;font-size:20px;font-weight:900;margin-top:10px;padding-top:12px;border-top:2px solid var(--ink)}
table.vat{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
table.vat th{color:#a37b8d;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.6px;text-align:right;padding:4px 0;border-bottom:1px solid var(--line)}
table.vat th:first-child,table.vat td:first-child{text-align:left}
table.vat td{text-align:right;padding:5px 0;border-bottom:1px solid #faeef4}
.payments{margin-top:14px;background:var(--paper);border-radius:12px;padding:10px 14px}
.payments h3,.section-title{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#a37b8d;margin-bottom:6px}
.btn{display:block;text-align:center;padding:13px;border-radius:14px;font-weight:800;font-size:15px;text-decoration:none;margin-top:12px}
.btn-primary{background:var(--magenta);color:#fff}
.btn-outline{border:2px solid var(--magenta);color:var(--magenta-deep);background:#fff}
.returns{font-size:12px;color:#7a5566;line-height:1.5}
.reco h2{font-size:17px;font-weight:800;padding:16px 18px 0}
.reco{padding-bottom:18px}
.reco .btn{margin:14px 18px 0}
.reco-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:12px 18px 0}
.reco-card{background:var(--paper);border-radius:12px;padding:8px;text-align:center}
.reco-card img,.reco-noimg{width:100%;aspect-ratio:1;object-fit:cover;border-radius:9px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:26px}
.reco-name{font-size:11px;font-weight:600;margin-top:6px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.reco-price{font-size:12px;font-weight:800;color:var(--magenta-deep);margin-top:2px}
.reco-old{text-decoration:line-through;color:#a37b8d;font-weight:500;font-size:11px}
footer{text-align:center;font-size:11px;color:#a37b8d;padding:8px 0 20px}
footer a{color:var(--magenta-deep)}
@media print{body{background:#fff;padding:0}.card{box-shadow:none}.btn,.reco,footer{display:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="hero">
      ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="${esc(data.store.name)}">` : ''}
      <div class="store-name">${esc(data.store.name)}</div>
      <div class="total">${money(data.totalMinorUnits)}</div>
      <div class="meta">Ticket ${esc(data.ticketNumber)} · ${esc(dateStr)}</div>
    </div>
    ${statusBanner}
    <div class="body">
      <div class="store-block">
        ${data.store.address ? `<p>${esc(data.store.address)}${data.store.addressExtra ? ', ' + esc(data.store.addressExtra) : ''}${cityLine ? ' — ' + esc(cityLine) : ''}</p>` : ''}
        ${contactBits ? `<p>${contactBits}</p>` : ''}
        ${legalBits ? `<p>${legalBits}</p>` : ''}
        ${data.cashier ? `<p>Vendeur : ${esc(data.cashier)}</p>` : ''}
      </div>

      <div class="section-title">Articles</div>
      ${itemsHtml}

      <div class="totals">
        <div class="row sub"><span>Sous-total</span><span>${money(data.subtotalMinorUnits)}</span></div>
        ${data.discountTotalMinorUnits > 0 ? `<div class="row discount"><span>Remises</span><span>−${money(data.discountTotalMinorUnits)}</span></div>` : ''}
        <div class="grand"><span>TOTAL TTC</span><span>${money(data.totalMinorUnits)}</span></div>
      </div>

      <table class="vat">
        <thead><tr><th>Taux</th><th>HT</th><th>TVA</th><th>TTC</th></tr></thead>
        <tbody>${vatRows}</tbody>
      </table>

      <div class="payments">
        <h3>Paiement</h3>
        ${paymentsHtml}
      </div>

      <a class="btn btn-outline" href="/ticket/${esc(token)}/pdf">Télécharger le ticket (PDF)</a>
    </div>
  </div>

  <section class="card" style="padding:16px 18px">
    <div class="section-title">Retour ou échange</div>
    <p class="returns">Pour tout retour ou échange, présentez ce ticket (ou ce QR code) en magasin.
    ${contactBits ? `Contact : ${contactBits}.` : ''}
    Le numéro de ticket ${esc(data.ticketNumber)} fait référence.</p>
  </section>

  ${recoSection}

  <footer>
    ${site ? `<a href="${esc(site)}" rel="noopener">${esc(site.replace(/^https?:\/\//, ''))}</a> · ` : ''}
    Ticket numérique — reproduction fidèle de la vente enregistrée, non modifiable.
  </footer>
</div>
</body>
</html>`;
}
