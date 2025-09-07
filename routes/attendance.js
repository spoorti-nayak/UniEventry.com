const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Mark attendance manually (Admin only)
router.post('/manual', authenticateToken, requireRole(['admin']), requireSameCollege, [
  body('event_id').isInt(),
  body('student_id').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { event_id, student_id } = req.body;

    // Check if student is registered
    const [registration] = await db.execute(
      'SELECT id FROM registrations WHERE event_id = ? AND student_id = ? AND status = "registered"',
      [event_id, student_id]
    );
    if (registration.length === 0) return res.status(400).json({ error: 'Student not registered for event' });

    // Mark attendance
    await db.execute(
      'INSERT INTO attendance (college_id, event_id, student_id) VALUES (?, ?, ?)',
      [req.user.college_id, event_id, student_id]
    );

    res.json({ message: 'Attendance marked successfully' });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// QR check-in (Student only)
router.post('/qr-checkin', authenticateToken, requireSameCollege, [
  body('qr_data').notEmpty()
], async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can check in' });

  try {
    const { qr_data } = req.body;
    const qr = JSON.parse(qr_data);

    // Verify QR secret & college
    const [events] = await db.execute(
      'SELECT id FROM events WHERE id = ? AND qr_secret = ? AND college_id = ?',
      [qr.event_id, qr.secret, qr.college_id]
    );
    if (events.length === 0) return res.status(400).json({ error: 'Invalid QR code' });

    // Check if already marked
    const [existing] = await db.execute(
      'SELECT id FROM attendance WHERE event_id = ? AND student_id = ?',
      [qr.event_id, req.user.id]
    );
    if (existing.length > 0) return res.status(400).json({ error: 'Already checked in' });

    await db.execute(
      'INSERT INTO attendance (college_id, event_id, student_id) VALUES (?, ?, ?)',
      [req.user.college_id, qr.event_id, req.user.id]
    );

    res.json({ message: 'Checked in successfully' });
  } catch (error) {
    console.error('QR check-in error:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// Get attendance for an event (Admin only)
router.get('/event/:eventId', authenticateToken, requireRole(['admin']), requireSameCollege, [
  param('eventId').isInt()
], async (req, res) => {
  try {
    const [attendance] = await db.execute(`
      SELECT a.id, s.first_name, s.last_name, s.student_id, a.checked_in_at
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.event_id = ? AND a.college_id = ?
      ORDER BY a.checked_in_at ASC
    `, [req.params.eventId, req.user.college_id]);

    res.json({ attendance });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

module.exports = router;
