const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Register for an event (Student only)
router.post('/', authenticateToken, requireSameCollege, [
  body('event_id').isInt()
], async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can register' });

  try {
    const { event_id } = req.body;

    // Check event capacity
    // CORRECTED: Changed 'capacity' to 'max_participants' to match your database
    const [events] = await db.execute(
      'SELECT max_participants FROM events WHERE id = ? AND college_id = ?',
      [event_id, req.user.college_id]
    );
    if (events.length === 0) return res.status(404).json({ error: 'Event not found' });

    // Use the correct variable name
    const capacity = events[0].max_participants;

    const [registeredCount] = await db.execute(
      'SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status = "registered"',
      [event_id]
    );

    let status = 'registered';
    let waitlist_position = null;
    if (registeredCount[0].count >= capacity) {
      status = 'waitlisted';
      const [maxPosition] = await db.execute(
        'SELECT MAX(waitlist_position) as max_pos FROM registrations WHERE event_id = ? AND status = "waitlisted"',
        [event_id]
      );
      waitlist_position = (maxPosition[0].max_pos || 0) + 1;
    }

    await db.execute(
      'INSERT INTO registrations (college_id, event_id, student_id, status, waitlist_position) VALUES (?, ?, ?, ?, ?)',
      [req.user.college_id, event_id, req.user.id, status, waitlist_position]
    );

    res.json({ message: `Registration ${status}`, waitlist_position });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Get student's registrations
router.get('/my', authenticateToken, requireSameCollege, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can view their registrations' });

  try {
    const [registrations] = await db.execute(`
      SELECT r.*, e.title, e.event_date, e.venue
      FROM registrations r
      JOIN events e ON r.event_id = e.id
      WHERE r.student_id = ? AND r.college_id = ?
      ORDER BY e.event_date ASC
    `, [req.user.id, req.user.college_id]);

    res.json({ registrations });
  } catch (error) {
    console.error('Get my registrations error:', error);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

module.exports = router;