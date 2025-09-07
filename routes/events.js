// ================================
// ROUTES/EVENTS.JS - EVENT MANAGEMENT ROUTES
// ================================

// routes/events.js
const express = require('express');

const { body, validationResult, param, query } = require('express-validator');
const QRCode = require('qrcode');
const { randomUUID } = require('crypto');
const db = require('../config/database');
const { authenticateToken, requireRole, requireSameCollege } = require('../middleware/auth');

const router = express.Router();

// Get all events (with filters)
router.get('/', authenticateToken, requireSameCollege, [
  query('status').optional().isIn(['draft', 'active', 'completed', 'cancelled']),
  query('category').optional(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status, category, limit = 20, offset = 0 } = req.query;
    
    let querySql = `
      SELECT e.*, a.first_name as created_by_name, a.last_name as created_by_lastname,
             (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') as registered_count,
             (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted') as waitlist_count
      FROM events e
      JOIN admins a ON e.created_by = a.id
      WHERE e.college_id = ?
    `;
    
    const params = [req.user.college_id];
    
    if (status) {
      querySql += ' AND e.status = ?';
      params.push(status);
    }
    
    if (category) {
      querySql += ' AND e.category = ?';
      params.push(category);
    }
    
    querySql += ' ORDER BY e.event_date ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [events] = await db.execute(querySql, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM events WHERE college_id = ?';
    const countParams = [req.user.college_id];
    
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    
    if (category) {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }

    const [countResult] = await db.execute(countQuery, countParams);

    res.json({
      events,
      pagination: {
        total: countResult[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: countResult[0].total > (parseInt(offset) + parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get single event
router.get('/:id', authenticateToken, requireSameCollege, [
  param('id').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const [events] = await db.execute(`
      SELECT e.*, a.first_name as created_by_name, a.last_name as created_by_lastname,
             (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') as registered_count,
             (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted') as waitlist_count,
             (SELECT AVG(rating) FROM feedback f WHERE f.event_id = e.id) as avg_rating,
             (SELECT COUNT(*) FROM feedback f WHERE f.event_id = e.id) as feedback_count
      FROM events e
      JOIN admins a ON e.created_by = a.id
      WHERE e.id = ? AND e.college_id = ?
    `, [req.params.id, req.user.college_id]);

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = events[0];
    
    if (req.user.role === 'student') {
      const [registration] = await db.execute(
        'SELECT status, waitlist_position FROM registrations WHERE event_id = ? AND student_id = ?',
        [req.params.id, req.user.id]
      );
      event.user_registration = registration[0] || null;
    }

    res.json({ event });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Create event (Admin only)
router.post('/', authenticateToken, requireRole(['admin']), requireSameCollege, [
  body('title').notEmpty().isLength({ max: 255 }),
  body('description').optional(),
  body('event_date').isISO8601().toDate(),
  body('start_time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('end_time').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
  body('venue').notEmpty(),
  body('max_participants').isInt({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title, description, event_date, start_time, end_time, venue,
      max_participants
    } = req.body;

    // REMOVED ALL QR CODE LOGIC TO MATCH YOUR DATABASE
    const [result] = await db.execute(`
      INSERT INTO events (
        college_id, title, description, event_date, start_time, end_time, venue,
        max_participants, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user.college_id, title, description, event_date, start_time, end_time,
      venue, max_participants, req.user.id
    ]);

    res.status(201).json({
      message: 'Event created successfully',
      event_id: result.insertId,
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

module.exports = router;