// db.js
const mysql = require('mysql2');
require('dotenv').config(); // Add this to use environment variables

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'notice_user',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'announcement_system',
  connectionLimit: 10
});

module.exports = pool.promise();