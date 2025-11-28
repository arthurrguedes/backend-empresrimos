const express = require('express');
const router = express.Router();
const controller = require('../controllers/emprestimosController');
const auth = require('../middlewares/auth');

// 1. Criar
router.post('/', auth, controller.createEmprestimo);

// 2. Listar Todos
router.get('/', auth, controller.getAllEmprestimos);

// 3. Meus Empréstimos (Deve vir ANTES de /:id)
router.get('/meus', auth, controller.getMyEmprestimos);

// 4. Devolver
router.put('/:id/devolver', auth, controller.devolverLivro);

// 5. Buscar por ID (Esta é a rota que estava causando erro se a função não existisse)
router.get('/:id', auth, controller.getEmprestimoById);

module.exports = router;