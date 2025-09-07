const express = require('express');
const { body, validationResult, param } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Create/Update note (Student only)
router.post('/', authenticateToken, requireSameCollege, [
  body('event_id').isInt(),
  body('content').notEmpty().isLength({ max: 5000 })
], async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can create notes' });
  }

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { event_id, content } = req.body;

    // Check if student is registered for the event
    const [registration] = await db.execute(
      'SELECT id FROM registrations WHERE event_id = ? AND student_id = ? AND college_id = ?',
      [event_id, req.user.id, req.user.college_id]
    );

    if (registration.length === 0) {
      return res.status(400).json({ error: 'Can only create notes for events you are registered for' });
    }

    // Check if note already exists
    const [existing] = await db.execute(
      'SELECT id FROM notes WHERE event_id = ? AND student_id = ?',
      [event_id, req.user.id]
    );

    if (existing.length > 0) {
      // Update existing note
      await db.execute(
        'UPDATE notes SET content = ?, updated_at = NOW() WHERE event_id = ? AND student_id = ?',
        [content, event_id, req.user.id]
      );
      res.json({ message: 'Note updated successfully' });
    } else {
      // Create new note
      await db.execute(
        'INSERT INTO notes (event_id, student_id, content) VALUES (?, ?, ?)',
        [event_id, req.user.id, content]
      );
      res.json({ message: 'Note created successfully' });
    }
  } catch (error) {
    console.error('Error managing note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get notes for an event (Student only, for their own notes)
router.get('/event/:eventId', authenticateToken, requireSameCollege, [
  param('eventId').isInt()
], async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can view notes' });
  }

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const [notes] = await db.execute(
      'SELECT content, created_at, updated_at FROM notes WHERE event_id = ? AND student_id = ?',
      [req.params.eventId, req.user.id]
    );

    res.json(notes[0] || null);
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
