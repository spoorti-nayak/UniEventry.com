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
  query('end_date').optional().isISO8601(),
  query('event_type').optional().isString() // Add this line for the event type filter
], async (req, res) => {
  try {
    const { start_date, end_date, event_type } = req.query; // Add event_type here

    let query = `
      SELECT s.id, s.first_name, s.last_name, COUNT(a.id) as events_attended
      FROM students s
      LEFT JOIN attendance a ON s.id = a.student_id AND s.college_id = a.college_id
      LEFT JOIN events e ON a.event_id = e.id
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
    // Add this block to handle the event_type filter
    if (event_type) {
        query += ' AND e.category = ?'; 
        params.push(event_type);
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

// Attendance Percentage Report
router.get('/attendance-percentage', authenticateToken, requireRole(['admin']), requireSameCollege, async (req, res) => {
  try {
    const [report] = await db.execute(`
      SELECT 
        e.id, 
        e.title, 
        COUNT(r.id) as registered_count, 
        COUNT(a.id) as attended_count,
        (COUNT(a.id) / COUNT(r.id)) * 100 as attendance_percentage
      FROM events e
      LEFT JOIN registrations r ON e.id = r.event_id AND r.status = 'registered'
      LEFT JOIN attendance a ON e.id = a.event_id
      WHERE e.college_id = ?
      GROUP BY e.id
      ORDER BY attendance_percentage DESC
    `, [req.user.college_id]);

    res.json({ report });
  } catch (error) {
    console.error('Attendance percentage report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Average Feedback Score Report
router.get('/average-feedback', authenticateToken, requireRole(['admin']), requireSameCollege, async (req, res) => {
  try {
    const [report] = await db.execute(`
      SELECT 
        e.id, 
        e.title, 
        AVG(f.rating) as average_rating,
        COUNT(f.id) as feedback_count
      FROM events e
      LEFT JOIN feedback f ON e.id = f.event_id
      WHERE e.college_id = ?
      GROUP BY e.id
      ORDER BY average_rating DESC
    `, [req.user.college_id]);

    res.json({ report });
  } catch (error) {
    console.error('Average feedback report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Top 3 Most Active Students (Bonus)
router.get('/top-students', authenticateToken, requireRole(['admin']), requireSameCollege, async (req, res) => {
  try {
    const [topStudents] = await db.execute(`
      SELECT s.id, s.first_name, s.last_name, COUNT(a.id) as events_attended
      FROM students s
      JOIN attendance a ON s.id = a.student_id
      WHERE s.college_id = ?
      GROUP BY s.id
      ORDER BY events_attended DESC
      LIMIT 3
    `, [req.user.college_id]);

    res.json({ top_students: topStudents });
  } catch (error) {
    console.error('Top students report error:', error);
    res.status(500).json({ error: 'Failed to generate top students report' });
  }
});
module.exports = router;
