const express = require('express');
const { body, validationResult, param } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Submit feedback (Student only)
router.post('/', authenticateToken, requireSameCollege, [
  body('event_id').isInt(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comments').optional().isLength({ max: 1000 }),
  body('suggestions').optional().isLength({ max: 1000 }),
  body('anonymous').optional().isBoolean()
], async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can submit feedback' });
  }

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { event_id, rating, comments, suggestions, anonymous = false } = req.body;

    // Check if student attended the event
    const [attendance] = await db.execute(
      'SELECT id FROM attendance WHERE event_id = ? AND student_id = ? AND college_id = ?',
      [event_id, req.user.id, req.user.college_id]
    );

    if (attendance.length === 0) {
      return res.status(400).json({ error: 'Can only provide feedback for events you attended' });
    }

    // Check if feedback already submitted
    const [existing] = await db.execute(
      'SELECT id FROM feedback WHERE event_id = ? AND student_id = ?',
      [event_id, req.user.id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Feedback already submitted for this event' });
    }

    // Insert feedback
    const [result] = await db.execute(
      'INSERT INTO feedback (college_id, event_id, student_id, rating, comments, suggestions, anonymous) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.college_id, event_id, req.user.id, rating, comments, suggestions, anonymous]
    );

    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedback_id: result.insertId
    });

  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Update feedback (Student only)
router.put('/:id', authenticateToken, requireSameCollege, [
  param('id').isInt(),
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('comments').optional().isLength({ max: 1000 }),
  body('suggestions').optional().isLength({ max: 1000 }),
  body('anonymous').optional().isBoolean()
], async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can update feedback' });
  }

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Check if feedback exists and belongs to student
    const [existing] = await db.execute(
      'SELECT id FROM feedback WHERE id = ? AND student_id = ? AND college_id = ?',
      [req.params.id, req.user.id, req.user.college_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    // Build update query
    const allowedFields = ['rating', 'comments', 'suggestions', 'anonymous'];
    const updates = [];
    const params = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    params.push(req.params.id);

    await db.execute(
      `UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    res.json({ message: 'Feedback updated successfully' });

  } catch (error) {
    console.error('Update feedback error:', error);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// Get feedback for event (Admin only)
router.get('/event/:eventId', authenticateToken, requireRole(['admin']), requireSameCollege, [
  param('eventId').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const [feedback] = await db.execute(`
      SELECT f.*, 
             CASE WHEN f.anonymous = true THEN 'Anonymous' ELSE CONCAT(s.first_name, ' ', s.last_name) END as student_name,
             CASE WHEN f.anonymous = true THEN NULL ELSE s.student_id END as student_id
      FROM feedback f
      JOIN students s ON f.student_id = s.id
      WHERE f.event_id = ? AND f.college_id = ?
      ORDER BY f.submitted_at DESC
    `, [req.params.eventId, req.user.college_id]);

    // Calculate summary statistics
    const summary = {
      total_feedback: feedback.length,
      average_rating: feedback.length > 0 ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(2) : 0,
      rating_distribution: {
        1: feedback.filter(f => f.rating === 1).length,
        2: feedback.filter(f => f.rating === 2).length,
        3: feedback.filter(f => f.rating === 3).length,
        4: feedback.filter(f => f.rating === 4).length,
        5: feedback.filter(f => f.rating === 5).length
      }
    };

    res.json({ feedback, summary });

  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Get student's feedback history
router.get('/my-feedback', authenticateToken, requireSameCollege, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can view their feedback' });
  }

  try {
    const [feedback] = await db.execute(`
      SELECT f.*, e.title, e.event_date
      FROM feedback f
      JOIN events e ON f.event_id = e.id
      WHERE f.student_id = ? AND f.college_id = ?
      ORDER BY f.submitted_at DESC
    `, [req.user.id, req.user.college_id]);

    res.json({ feedback });

  } catch (error) {
    console.error('Get feedback history error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback history' });
  }
});

module.exports = router;