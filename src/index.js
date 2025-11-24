const express = require('express');
const cors = require('cors');
require('dotenv').config();

const emprestimosRoutes = require('./routes/emprestimosRoutes');

const app = express();
const PORT = process.env.PORT || 4004;

app.use(cors());
app.use(express.json());

// Registra as rotas
app.use('/emprestimos', emprestimosRoutes);

app.get('/', (req, res) => {
    res.send('Microsserviço de Empréstimos rodando!');
});

app.listen(PORT, () => {
    console.log(`Servidor de Empréstimos rodando na porta ${PORT}`);
});