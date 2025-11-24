const express = require('express');
const router = express.Router();
const controller = require('../controllers/emprestimosController');
const auth = require('../middlewares/auth');

// Rotas protegidas (todas exigem token)
router.use(auth);

// Rota do usuário final
router.get('/meus', controller.getMyEmprestimos);

// Rotas Administrativas (Bibliotecários)
router.post('/', controller.createEmprestimo); // Cria a partir da reserva
router.get('/', controller.getAllEmprestimos);
router.get('/:id', controller.getEmprestimoById);
router.put('/:id/devolver', controller.devolverLivro);
router.delete('/:id', controller.deleteEmprestimo);

module.exports = router;