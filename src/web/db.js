const { Pool, types } = require('pg');

// pg returns NUMERIC columns (amount, amount_usd, amount_attributed) as strings by
// default, to avoid silent float precision loss. This dataset's amounts are well
// within safe-integer range and the frontend needs real numbers (toLocaleString,
// arithmetic for chart bar widths), so parse them here once rather than at every call site.
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

module.exports = { pool };
