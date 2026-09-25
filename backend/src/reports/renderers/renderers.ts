import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { csvCell } from '../../common/utils/csv';

export interface ReportColumn {
  key: string;
  header: string;
  /** relative width weight for PDF layout */
  width?: number;
}

export interface ReportDataset {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: { label: string; value: string | number }[];
  generatedAt: Date;
  parameters: Record<string, unknown>;
}

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().replace('T', ' ').substring(0, 19);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export async function renderCsv(ds: ReportDataset, file: string): Promise<void> {
  const stream = fs.createWriteStream(file, { encoding: 'utf8' });
  const write = (s: string) => new Promise<void>((resolve) => (stream.write(s) ? resolve() : stream.once('drain', resolve)));
  await write('﻿' + ds.columns.map((c) => csvCell(c.header)).join(',') + '\r\n');
  for (const r of ds.rows) {
    await write(ds.columns.map((c) => csvCell(r[c.key] instanceof Date ? (r[c.key] as Date).toISOString() : r[c.key])).join(',') + '\r\n');
  }
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });
}

export async function renderXlsx(ds: ReportDataset, file: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SecureEndpoint Manager';
  wb.created = ds.generatedAt;

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Metric', key: 'label', width: 36 },
    { header: 'Value', key: 'value', width: 28 },
  ];
  summary.addRow({ label: 'Report', value: ds.title });
  summary.addRow({ label: 'Generated at (UTC)', value: ds.generatedAt.toISOString() });
  for (const [k, v] of Object.entries(ds.parameters)) {
    if (v !== undefined && v !== null && v !== '') summary.addRow({ label: `Filter: ${k}`, value: formatCell(v) });
  }
  summary.addRow({});
  for (const s of ds.summary) summary.addRow(s);
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

  const sheet = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = ds.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.min(60, Math.max(12, c.header.length + 4, (c.width ?? 1) * 14)),
  }));
  for (const r of ds.rows) {
    const row: Record<string, unknown> = {};
    for (const c of ds.columns) {
      const v = r[c.key];
      row[c.key] = v instanceof Date || typeof v === 'number' ? v : formatCell(v);
    }
    sheet.addRow(row);
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  if (ds.columns.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ds.columns.length } };
  }
  await wb.xlsx.writeFile(file);
}

const PDF_MAX_ROWS = 5000;

export async function renderPdf(ds: ReportDataset, file: string): Promise<void> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: ds.title, Author: 'SecureEndpoint Manager' } });
  const out = fs.createWriteStream(file);
  doc.pipe(out);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const brand = '#1E3A8A';

  // Title block
  doc.rect(0, 0, doc.page.width, 70).fill(brand);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(ds.title, left, 20, { width: pageWidth });
  doc.font('Helvetica').fontSize(10).text(`SecureEndpoint Manager  ·  Generated ${ds.generatedAt.toISOString().replace('T', ' ').substring(0, 19)} UTC`, left, 46);
  doc.fillColor('#111827');
  doc.y = 90;
  if (ds.subtitle) doc.font('Helvetica').fontSize(10).fillColor('#374151').text(ds.subtitle, left, doc.y);
  const filters = Object.entries(ds.parameters).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (filters.length) {
    doc.fontSize(9).fillColor('#6B7280').text(`Filters: ${filters.map(([k, v]) => `${k}=${formatCell(v)}`).join('  ·  ')}`, left, doc.y + 2);
  }
  doc.moveDown(0.8);

  // Summary table (two columns of metric cards)
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Summary', left, doc.y);
  doc.moveDown(0.3);
  const cardW = (pageWidth - 30) / 4;
  let cx = left;
  let cy = doc.y;
  ds.summary.forEach((s, i) => {
    if (i > 0 && i % 4 === 0) {
      cx = left;
      cy += 46;
    }
    doc.roundedRect(cx, cy, cardW, 40, 4).fillAndStroke('#F3F4F6', '#E5E7EB');
    doc.fillColor('#6B7280').font('Helvetica').fontSize(8).text(s.label.toUpperCase(), cx + 8, cy + 6, { width: cardW - 16 });
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(14).text(String(s.value), cx + 8, cy + 18, { width: cardW - 16 });
    cx += cardW + 10;
  });
  doc.y = cy + 56;

  // Data table
  const rows = ds.rows.slice(0, PDF_MAX_ROWS);
  const weights = ds.columns.map((c) => c.width ?? 1);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / totalW) * pageWidth);
  const fontSize = ds.columns.length > 9 ? 6.5 : 7.5;
  const rowH = fontSize + 7;

  const drawHeader = () => {
    let x = left;
    const y = doc.y;
    doc.rect(left, y, pageWidth, rowH + 2).fill(brand);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(fontSize);
    ds.columns.forEach((c, i) => {
      doc.text(c.header, x + 3, y + 4, { width: widths[i] - 6, height: rowH, ellipsis: true, lineBreak: false });
      x += widths[i];
    });
    doc.y = y + rowH + 2;
  };

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(`Details (${ds.rows.length} rows${ds.rows.length > PDF_MAX_ROWS ? `, first ${PDF_MAX_ROWS} shown` : ''})`, left, doc.y);
  doc.moveDown(0.3);
  drawHeader();
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  rows.forEach((r, idx) => {
    if (doc.y + rowH > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeader();
    }
    const y = doc.y;
    if (idx % 2 === 1) doc.rect(left, y, pageWidth, rowH).fill('#F9FAFB');
    let x = left;
    doc.fillColor('#111827').font('Helvetica').fontSize(fontSize);
    ds.columns.forEach((c, i) => {
      doc.text(formatCell(r[c.key]), x + 3, y + 3.5, { width: widths[i] - 6, height: rowH, ellipsis: true, lineBreak: false });
      x += widths[i];
    });
    doc.y = y + rowH;
  });
  if (!rows.length) doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6B7280').text('No data for the selected filters.', left, doc.y + 6);

  // Footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#9CA3AF').text(
      `${ds.title} · Page ${i + 1} of ${range.count} · Confidential`,
      left,
      doc.page.height - doc.page.margins.bottom - 8,
      { width: pageWidth, align: 'center', lineBreak: false },
    );
  }
  doc.end();
  await new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve());
    out.on('error', reject);
  });
}
