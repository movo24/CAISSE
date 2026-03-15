/* ═══════════════════════════════════════════════════════════════
   EXPORT UTILS — Export CSV + Impression PDF simplifié
   Utilisé pour la paie, le pointage, et les rapports
   ═══════════════════════════════════════════════════════════════ */

import { MonthPayroll, formatCurrency, formatHours } from './payroll-calculator';

// ── CSV Export ──

/**
 * Génère un fichier CSV et déclenche le téléchargement
 */
export function downloadCSV(filename: string, headers: string[], rows: string[][]): void {
  const BOM = '\uFEFF'; // UTF-8 BOM pour Excel
  const separator = ';'; // Point-virgule pour Excel FR

  const headerLine = headers.join(separator);
  const dataLines = rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(separator),
  );

  const content = BOM + [headerLine, ...dataLines].join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exporte les fiches de paie en CSV
 */
export function exportPayrollCSV(payrolls: MonthPayroll[], month: string): void {
  const headers = [
    'Employe', 'Role', 'Mois',
    'Jours travailles', 'Heures totales', 'Heures normales',
    'Heures sup 25%', 'Heures sup 50%',
    'Brut normal', 'Brut HS 25%', 'Brut HS 50%', 'Brut total',
    'Charges salariales', 'Net avant impot',
    'Charges patronales', 'Cout employeur',
  ];

  const rows = payrolls.map((p) => [
    p.employeeName,
    p.role,
    p.month,
    p.daysWorked.toString(),
    formatHours(p.totalWorkedHours),
    formatHours(p.regularHours),
    formatHours(p.overtimeHours25),
    formatHours(p.overtimeHours50),
    formatCurrency(p.grossRegular),
    formatCurrency(p.grossOvertime25),
    formatCurrency(p.grossOvertime50),
    formatCurrency(p.grossTotal),
    formatCurrency(p.employeeSocialCharges),
    formatCurrency(p.netBeforeTax),
    formatCurrency(p.employerSocialCharges),
    formatCurrency(p.grossTotal + p.employerSocialCharges),
  ]);

  downloadCSV(`paie_${month}`, headers, rows);
}

// ── Print / PDF ──

/**
 * Ouvre une fenêtre d'impression avec le contenu HTML formaté
 */
export function printPayslip(payroll: MonthPayroll, storeName: string): void {
  const html = generatePayslipHTML(payroll, storeName);
  const printWindow = window.open('', '_blank', 'width=800,height=1100');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
}

function generatePayslipHTML(p: MonthPayroll, storeName: string): string {
  const monthLabel = formatMonthLabel(p.month);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Fiche de paie — ${p.employeeName} — ${monthLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11px; color: #1a1a2e; padding: 40px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 20px; }
    .header h1 { font-size: 18px; font-weight: 800; }
    .header .meta { text-align: right; font-size: 10px; color: #666; }
    .section { margin-bottom: 16px; }
    .section-title { font-size: 12px; font-weight: 700; color: #1a1a2e; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { text-align: left; font-weight: 600; color: #666; padding: 4px 8px; border-bottom: 1px solid #eee; }
    td { padding: 4px 8px; border-bottom: 1px solid #f5f5f5; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .total-row { background: #f8f9fa; font-weight: 700; }
    .total-row td { border-top: 2px solid #1a1a2e; padding-top: 8px; }
    .net-row { background: #1a1a2e; color: white; font-size: 13px; }
    .net-row td { padding: 10px 8px; }
    .footer { margin-top: 30px; font-size: 9px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>BULLETIN DE PAIE</h1>
      <p style="font-size:10px;color:#666;margin-top:4px">${storeName}</p>
    </div>
    <div class="meta">
      <p><strong>Periode :</strong> ${monthLabel}</p>
      <p><strong>Employe :</strong> ${p.employeeName}</p>
      <p><strong>Poste :</strong> ${p.role}</p>
      <p><strong>Jours travailles :</strong> ${p.daysWorked}</p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">HEURES TRAVAILLEES</div>
    <table>
      <tr><th>Type</th><th class="right">Heures</th><th class="right">Taux horaire</th><th class="right">Montant</th></tr>
      <tr>
        <td>Heures normales</td>
        <td class="right">${formatHours(p.regularHours)}</td>
        <td class="right">${formatCurrency(Math.round(p.grossRegular / Math.max(p.regularHours, 1)))}/h</td>
        <td class="right">${formatCurrency(p.grossRegular)}</td>
      </tr>
      ${p.overtimeHours25 > 0 ? `<tr>
        <td>Heures supplementaires +25%</td>
        <td class="right">${formatHours(p.overtimeHours25)}</td>
        <td class="right">—</td>
        <td class="right">${formatCurrency(p.grossOvertime25)}</td>
      </tr>` : ''}
      ${p.overtimeHours50 > 0 ? `<tr>
        <td>Heures supplementaires +50%</td>
        <td class="right">${formatHours(p.overtimeHours50)}</td>
        <td class="right">—</td>
        <td class="right">${formatCurrency(p.grossOvertime50)}</td>
      </tr>` : ''}
      <tr class="total-row">
        <td class="bold">TOTAL HEURES</td>
        <td class="right bold">${formatHours(p.totalWorkedHours)}</td>
        <td></td>
        <td class="right bold">${formatCurrency(p.grossTotal)}</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">COTISATIONS</div>
    <table>
      <tr><th>Designation</th><th class="right">Base</th><th class="right">Taux</th><th class="right">Montant</th></tr>
      <tr>
        <td>Cotisations salariales (CSG, CRDS, retraite, etc.)</td>
        <td class="right">${formatCurrency(p.grossTotal)}</td>
        <td class="right">22,00%</td>
        <td class="right">${formatCurrency(p.employeeSocialCharges)}</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <table>
      <tr class="net-row">
        <td class="bold">NET A PAYER AVANT IMPOT</td>
        <td></td>
        <td></td>
        <td class="right bold">${formatCurrency(p.netBeforeTax)}</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">COUT EMPLOYEUR</div>
    <table>
      <tr>
        <td>Salaire brut</td>
        <td class="right">${formatCurrency(p.grossTotal)}</td>
      </tr>
      <tr>
        <td>Charges patronales (~42%)</td>
        <td class="right">${formatCurrency(p.employerSocialCharges)}</td>
      </tr>
      <tr class="total-row">
        <td class="bold">COUT TOTAL EMPLOYEUR</td>
        <td class="right bold">${formatCurrency(p.grossTotal + p.employerSocialCharges)}</td>
      </tr>
    </table>
  </div>

  <div class="footer">
    <p>Document genere par CAISSE Back-Office — ${new Date().toLocaleDateString('fr-FR')} — Ce document est un recapitulatif simplifie, non un bulletin de paie officiel.</p>
  </div>
</body>
</html>`;
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  const months = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
  return `${months[parseInt(m, 10) - 1]} ${year}`;
}
