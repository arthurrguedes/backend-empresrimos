const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Teste de conexão
pool.getConnection((err, conn) => {
    if (err) console.error("Erro ao conectar no MySQL (Empréstimos):", err);
    else {
        console.log("Conectado ao MySQL (Empréstimos) com sucesso!");
        conn.release();
    }
});

module.exports = pool.promise();