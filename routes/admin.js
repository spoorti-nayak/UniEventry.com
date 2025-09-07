const express = require('express');
const { body, validationResult, param, query } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Get college statistics
router.get('/college-stats', authenticateToken, requireRole(['admin']), requireSameCollege, async (req, res) => {
  try {
    const [stats] = await db.execute(`
      SELECT 
        (SELECT COUNT(*) FROM events WHERE college_id = ?) as total_events,
        (SELECT COUNT(*) FROM events WHERE college_id = ? AND status = 'active') as active_events,
        (SELECT COUNT(*) FROM students WHERE college_id = ? AND is_active = true) as total_students,
        (SELECT COUNT(*) FROM registrations WHERE college_id = ?) as total_registrations,
        (SELECT COUNT(*) FROM attendance WHERE college_id = ?) as total_attendance,
        (SELECT COUNT(*) FROM certificates WHERE college_id = ?) as total_certificates
    `, [req.user.college_id, req.user.college_id, req.user.college_id, req.user.college_id, req.user.college_id, req.user.college_id]);

    res.json({ stats: stats[0] });
  } catch (error) {
    console.error('College stats error:', error);
    res.status(500).json({ error: 'Failed to fetch college statistics' });
  }
});

// Bulk generate certificates for event
router.post('/bulk-certificates', authenticateToken, requireRole(['admin']), requireSameCollege, [
  body('event_id').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { event_id } = req.body;

    // Get all attendees who don't have certificates yet
    const [attendees] = await db.execute(`
      SELECT a.id as attendance_id, a.student_id, s.first_name, s.last_name, e.title, e.event_date, e.duration_hours, c.name as college_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN events e ON a.event_id = e.id
      JOIN colleges c ON a.college_id = c.id
      LEFT JOIN certificates cert ON a.event_id = cert.event_id AND a.student_id = cert.student_id
      WHERE a.event_id = ? AND a.college_id = ? AND cert.id IS NULL
    `, [event_id, req.user.college_id]);

    if (attendees.length === 0) {
      return res.status(400).json({ error: 'No attendees found or all certificates already generated' });
    }

    const generated = [];
    const failed = [];

    for (const attendee of attendees) {
      try {
        // Generate certificate logic here (similar to single certificate generation)
        const certificateId = require('uuid').v4();
        
        await db.execute(
          'INSERT INTO certificates (college_id, event_id, student_id, attendance_id, certificate_id) VALUES (?, ?, ?, ?, ?)',
          [req.user.college_id, event_id, attendee.student_id, attendee.attendance_id, certificateId]
        );

        generated.push({
          student_id: attendee.student_id,
          student_name: `${attendee.first_name} ${attendee.last_name}`,
          certificate_id: certificateId
        });
      } catch (error) {
        failed.push({
          student_id: attendee.student_id,
          student_name: `${attendee.first_name} ${attendee.last_name}`,
          error: error.message
        });
      }
    }

    res.json({
      message: `Bulk certificate generation completed`,
      generated: generated.length,
      failed: failed.length,
      details: { generated, failed }
    });

  } catch (error) {
    console.error('Bulk certificate generation error:', error);
    res.status(500).json({ error: 'Failed to generate bulk certificates' });
  }
});

// Get all students in college
router.get('/students', authenticateToken, requireRole(['admin']), requireSameCollege, [
  query('search').optional(),
  query('year_of_study').optional().isInt(),
  query('department').optional(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { search, year_of_study, department, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM students WHERE college_id = ? AND is_active = true';
    const params = [req.user.college_id];

    if (search) {
      query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR student_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (year_of_study) {
      query += ' AND year_of_study = ?';
      params.push(year_of_study);
    }

    if (department) {
      query += ' AND department = ?';
      params.push(department);
    }

    query += ' ORDER BY first_name, last_name LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [students] = await db.execute(query, params);

    res.json({ students });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

module.exports = router;