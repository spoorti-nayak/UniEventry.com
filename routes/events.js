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
    
    let query = `
      SELECT e.*, a.first_name as created_by_name, a.last_name as created_by_lastname,
             (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'registered') as registered_count,
             (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted') as waitlist_count
      FROM events e
      JOIN admins a ON e.created_by = a.id
      WHERE e.college_id = ?
    `;
    
    const params = [req.user.college_id];
    
    if (status) {
      query += ' AND e.status = ?';
      params.push(status);
    }
    
    if (category) {
      query += ' AND e.category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY e.event_date ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [events] = await db.execute(query, params);

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
        has_more: countResult[0].total > parseInt(offset) + parseInt(limit)
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
    
    // Check if current user is registered (for students)
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
  body('event_date').isISO8601(),
  body('venue').optional().isLength({ max: 255 }),
  body('capacity').isInt({ min: 1, max: 10000 }),
  body('category').optional().isLength({ max: 100 }),
  body('duration_hours').optional().isFloat({ min: 0.5, max: 24 }),
  body('requirements').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title, description, event_date, venue, capacity, category,
      duration_hours = 1.0, requirements, tags, status = 'draft'
    } = req.body;

    // Generate QR code secret and QR code
    const qr_secret = randomUUID();
    const qr_data = JSON.stringify({
      event_id: null, // Will be updated after insert
      secret: qr_secret,
      college_id: req.user.college_id
    });

    const [result] = await db.execute(`
      INSERT INTO events (
        college_id, title, description, event_date, duration_hours, venue,
        capacity, status, qr_secret, category, tags, requirements, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user.college_id, title, description, event_date, duration_hours,
      venue, capacity, status, qr_secret, category, JSON.stringify(tags || []),
      requirements, req.user.id
    ]);

    // Generate QR code with actual event ID
    const actualQRData = JSON.stringify({
      event_id: result.insertId,
      secret: qr_secret,
      college_id: req.user.college_id
    });
    
    const qrCodeDataURL = await QRCode.toDataURL(actualQRData);

    // Update event with QR code
    await db.execute(
      'UPDATE events SET qr_code = ? WHERE id = ?',
      [qrCodeDataURL, result.insertId]
    );

    res.status(201).json({
      message: 'Event created successfully',
      event_id: result.insertId,
      qr_code: qrCodeDataURL
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

module.exports = router;
