const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { body, validationResult } = require('express-validator');

const router = express.Router();
const SALT_ROUNDS = 10;

// Student Registration
router.post('/register/student', [
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('first_name').notEmpty(),
    body('last_name').notEmpty(),
    body('student_id').notEmpty(),
    body('college_id').isInt()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, first_name, last_name, student_id, college_id } = req.body;

    try {
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await db.execute(
            'INSERT INTO students (email, password_hash, first_name, last_name, student_id, college_id) VALUES (?, ?, ?, ?, ?, ?)',
            [email, password_hash, first_name, last_name, student_id, college_id]
        );
        res.status(201).json({ message: 'Student registered successfully', studentId: result.insertId });
    } catch (error) {
        console.error('Student registration error:', error);
        res.status(500).json({ error: 'Failed to register student' });
    }
});

// Admin Registration (For setup purposes)
router.post('/register/admin', [
    body('email').isEmail(),
    body('password').isLength({ min: 6 }),
    body('first_name').notEmpty(),
    body('last_name').notEmpty(),
    body('college_id').isInt()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, first_name, last_name, college_id } = req.body;

    try {
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await db.execute(
            'INSERT INTO admins (email, password_hash, first_name, last_name, college_id, role) VALUES (?, ?, ?, ?, ?, ?)',
            [email, password_hash, first_name, last_name, college_id, 'admin']
        );
        res.status(201).json({ message: 'Admin registered successfully', adminId: result.insertId });
    } catch (error) {
        console.error('Admin registration error:', error);
        res.status(500).json({ error: 'Failed to register admin' });
    }
});


// Universal Login
router.post('/login', [
    body('email').isEmail(),
    body('password').notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
        // Check admins table first
        let [userRows] = await db.execute('SELECT * FROM admins WHERE email = ?', [email]);
        let userRole = 'admin';

        // If not found in admins, check students table
        if (userRows.length === 0) {
            [userRows] = await db.execute('SELECT * FROM students WHERE email = ?', [email]);
            userRole = 'student';
        }

        if (userRows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = userRows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const payload = {
            id: user.id,
            college_id: user.college_id,
            role: userRole
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, role: userRole } });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

module.exports = router;