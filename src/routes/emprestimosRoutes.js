const express = require('express');
const router = express.Router();
const controller = require('../controllers/emprestimosController');
const auth = require('../middlewares/auth');

// Criar
router.post('/', auth, controller.createEmprestimo);

// Listar todos
router.get('/', auth, controller.getAllEmprestimos);

// Meus empréstimos
router.get('/meus', auth, controller.getMyEmprestimos);

// Devolução
router.put('/:id/devolver', auth, controller.devolverLivro);

// Buscar por ID
router.get('/:id', auth, controller.getEmprestimoById);

module.exports = router;