import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q, likeEscape } from '../db/index.js';
import { requirePerm } from '../lib/auth.js';
import { ah, idList, notFound, pageParams } from '../lib/http.js';
import { record } from '../services/history.js';

const router = Router();

function filters(query) {
  const where = [];
  const args = [];
  const s = String(query.search || '').trim();
  if (s) {
    where.push(`(v.name LIKE ? ESCAPE '\\' OR v.email LIKE ? ESCAPE '\\' OR v.phone LIKE ? ESCAPE '\\' OR fp.sku LIKE ? ESCAPE '\\' OR fp.name LIKE ? ESCAPE '\\')`);
    const like = `%${likeEscape(s)}%`;
    args.push(like, like, like, like, like);
  }
  if (query.from) {
    where.push('v.created_at >= ?');
    args.push(String(query.from));
  }
  if (query.to) {
    where.push('v.created_at <= ?');
    args.push(`${query.to}T23:59:59.999Z`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

const SELECT = `
  SELECT v.id, v.name, v.email, v.phone, v.scan_count, v.created_at, v.last_seen_at,
         fp.id AS first_product_id, fp.sku AS first_sku, fp.name AS first_name,
         lp.id AS last_product_id, lp.sku AS last_sku, lp.name AS last_name
    FROM visitors v
    LEFT JOIN products fp ON fp.id = v.first_product_id
    LEFT JOIN products lp ON lp.id = v.last_product_id`;

router.get('/', requirePerm('visitors.view'), (req, res) => {
  const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 50 });
  const { where, args } = filters(req.query);
  const total = Number(q.value(`SELECT COUNT(*) FROM visitors v LEFT JOIN products fp ON fp.id = v.first_product_id ${where}`, ...args));
  const items = q.all(`${SELECT} ${where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`, ...args, pageSize, offset);
  const stats = {
    visitors: Number(q.value('SELECT COUNT(*) FROM visitors')),
    scans: Number(q.value('SELECT COUNT(*) FROM product_scans')),
    anonymousScans: Number(q.value('SELECT COUNT(*) FROM product_scans WHERE visitor_id IS NULL AND user_id IS NULL')),
    last7: Number(q.value(`SELECT COUNT(*) FROM visitors WHERE created_at >= ?`, new Date(Date.now() - 7 * 86400000).toISOString())),
  };
  res.json({ items, total, page, pageSize, stats });
});

router.get('/export.xlsx', requirePerm('visitors.view'), ah(async (req, res) => {
  const { where, args } = filters(req.query);
  const rows = q.all(`${SELECT} ${where} ORDER BY v.created_at DESC`, ...args);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Visitors', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Date', key: 'created_at', width: 20 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Mobile', key: 'phone', width: 18 },
    { header: 'First product scanned', key: 'first', width: 40 },
    { header: 'Last product scanned', key: 'last', width: 40 },
    { header: 'Scans', key: 'scan_count', width: 8 },
    { header: 'Last seen', key: 'last_seen_at', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      ...r,
      created_at: new Date(r.created_at),
      last_seen_at: new Date(r.last_seen_at),
      first: r.first_sku ? `${r.first_sku} – ${r.first_name}` : '',
      last: r.last_sku ? `${r.last_sku} – ${r.last_name}` : '',
    });
  }
  ws.getColumn('created_at').numFmt = 'dd-mmm-yyyy hh:mm';
  ws.getColumn('last_seen_at').numFmt = 'dd-mmm-yyyy hh:mm';
  record({ user: req.user, entity: 'visitor', action: 'visitors_exported', summary: `Visitor details exported (${rows.length})` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="scan-visitors-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

router.get('/:id', requirePerm('visitors.view'), (req, res) => {
  const v = q.get(`${SELECT} WHERE v.id = ?`, Number(req.params.id));
  if (!v) throw notFound('Visitor not found');
  const scans = q.all(
    `SELECT s.created_at, p.id AS product_id, p.sku, p.name FROM product_scans s JOIN products p ON p.id = s.product_id
      WHERE s.visitor_id = ? ORDER BY s.created_at DESC LIMIT 200`,
    v.id,
  );
  res.json({ ...v, scans });
});

router.post('/delete', requirePerm('visitors.manage'), (req, res) => {
  const ids = idList(req.body.ids);
  for (const id of ids) q.run('DELETE FROM visitors WHERE id = ?', id);
  record({ user: req.user, entity: 'visitor', action: 'visitors_deleted', summary: `${ids.length} visitor record(s) deleted` });
  res.json({ deleted: ids.length });
});

export default router;
