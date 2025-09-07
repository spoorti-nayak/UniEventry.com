const express = require('express');
const { query, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Event popularity report
router.get('/event-popularity', authenticateToken, requireRole(['admin']), requireSameCollege, [
  query('format').optional().isIn(['json', 'csv'])
], async (req, res) => {
  try {
    const [events] = await db.execute(`
      SELECT e.id, e.title, COUNT(r.id) as registrations
      FROM events e
      LEFT JOIN registrations r ON e.id = r.event_id AND r.status = "registered"
      WHERE e.college_id = ?
      GROUP BY e.id
      ORDER BY registrations DESC
    `, [req.user.college_id]);

    res.json({ report: events });
  } catch (error) {
    console.error('Event popularity report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Student participation report
router.get('/student-participation', authenticateToken, requireRole(['admin']), requireSameCollege, [
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601()
], async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT s.id, s.first_name, s.last_name, COUNT(a.id) as events_attended
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id AND s.college_id = a.college_id
      WHERE s.college_id = ?`;
    const params = [req.user.college_id];

    if (start_date) {
      query += ' AND a.checked_in_at >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND a.checked_in_at <= ?';
      params.push(end_date);
    }

    query += ' GROUP BY s.id ORDER BY events_attended DESC';

    const [students] = await db.execute(query, params);
    res.json({ report: students });
  } catch (error) {
    console.error('Student participation report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Leaderboard (top students by events attended)
router.get('/leaderboard', authenticateToken, requireRole(['admin']), requireSameCollege, [
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const [leaderboard] = await db.execute(`
      SELECT s.id, s.first_name, s.last_name, COUNT(a.id) as events_attended
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id AND s.college_id = a.college_id
      WHERE s.college_id = ?
      GROUP BY s.id
      ORDER BY events_attended DESC
      LIMIT ?
    `, [req.user.college_id, limit]);

    res.json({ leaderboard });
  } catch (error) {
    console.error('Leaderboard report error:', error);
    res.status(500).json({ error: 'Failed to generate leaderboard' });
  }
});

module.exports = router;
