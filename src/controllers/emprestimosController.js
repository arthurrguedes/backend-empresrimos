const db = require('../db');
const axios = require('axios');
require('dotenv').config();

const emprestimosController = {

    // --- CREATE: Transformar Reserva em Empréstimo ---
    createEmprestimo: async (req, res) => {
        const { idReserva } = req.body;
        const idBibliotecario = req.userId; // Quem está logado (Admin/Bibliotecário)

        if (!idReserva) return res.status(400).json({ message: "ID da reserva é obrigatório." });

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Buscar dados da Reserva no microsserviço de Reservas
            // Nota: O admin manda o ID da reserva. Precisamos saber quem é o usuário e qual o livro.
            let reservaData;
            try {
                const response = await axios.get(`${process.env.URL_RESERVAS}/${idReserva}`);
                reservaData = response.data;
            } catch (err) {
                await connection.rollback();
                return res.status(404).json({ message: "Reserva não encontrada." });
            }

            // Validações básicas
            if (reservaData.statusReserva !== 'Ativa') {
                await connection.rollback();
                return res.status(400).json({ message: "Esta reserva não está ativa ou já foi processada." });
            }

            const { idUsuario, idLivro, prazoEmprestimo } = reservaData;

            // 2. Criar o registro de Empréstimo
            // Data prevista vem da reserva ou definimos padrão (ex: hoje + 7 dias)
            const dataPrevista = prazoEmprestimo ? new Date(prazoEmprestimo) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            const [result] = await connection.query(`
                INSERT INTO emprestimo 
                (dataEmprestimo, dataPrevista, status, idUsuario, idBibliotecario, idLivro, multa)
                VALUES (NOW(), ?, 'Ativo', ?, ?, ?, 0.00)
            `, [dataPrevista, idUsuario, idBibliotecario, idLivro]);

            // 3. Atualizar o status da Reserva para 'Concluída' no microsserviço de Reservas
            try {
                await axios.put(`${process.env.URL_RESERVAS}/${idReserva}`, {
                    statusReserva: 'Concluída'
                });
            } catch (err) {
                // Se falhar a atualização da reserva, fazemos rollback do empréstimo para manter consistência
                console.error("Erro ao atualizar reserva:", err.message);
                await connection.rollback();
                return res.status(502).json({ message: "Erro ao comunicar com serviço de Reservas." });
            }

            // 4. (Opcional) Atualizar estoque físico no Catálogo
            // Como a reserva "segurava" o livro logicamente mas não fisicamente na contagem total,
            // ao emprestar, talvez você queira decrementar o totalFisico se sua lógica de 'Disponível' 
            // for (Total - Emprestados). Se a lógica for (Total - Reservas), ao concluir a reserva, 
            // o sistema acharia que o livro voltou.
            // Para garantir, vamos decrementar 1 do estoque físico no catálogo:
            try {
                 // Busca estoque atual
                 const bookRes = await axios.get(`${process.env.URL_CATALOGO}/${idLivro}`);
                 const estoqueAtual = bookRes.data.estoque || 0;
                 if(estoqueAtual > 0) {
                    await axios.put(`${process.env.URL_CATALOGO}/${idLivro}/stock`, {
                        novaQuantidade: estoqueAtual - 1
                    });
                 }
            } catch(err) {
                console.warn("Aviso: Não foi possível atualizar o estoque no catálogo.", err.message);
                // Não fazemos rollback aqui pois o empréstimo principal já ocorreu
            }

            await connection.commit();
            return res.status(201).json({ 
                message: "Empréstimo criado com sucesso!",
                idEmprestimo: result.insertId 
            });

        } catch (error) {
            await connection.rollback();
            console.error("Erro Create Emprestimo:", error);
            res.status(500).json({ error: error.message });
        } finally {
            connection.release();
        }
    },

    // --- READ: Todos (Para Admin) ---
    getAllEmprestimos: async (req, res) => {
        try {
            const [rows] = await db.query(`SELECT * FROM emprestimo ORDER BY dataEmprestimo DESC`);
            
            // Enriquecer dados (buscar títulos de livros e nomes de usuários)
            const fullData = await Promise.all(rows.map(async (emp) => {
                let titulo = 'Desconhecido';
                let usuario_info = `User #${emp.idUsuario}`;

                // Busca info do Livro
                try {
                    const bookInfo = await axios.get(`${process.env.URL_CATALOGO}/${emp.idLivro}`);
                    titulo = bookInfo.data.titulo;
                } catch (e) {}

                // Busca info do Usuário (se necessário para a tabela do front)
                try {
                    // Assume-se que existe uma rota para pegar user por ID
                    // const userInfo = await axios.get(`${process.env.URL_USUARIOS}/${emp.idUsuario}`);
                    // usuario_info = userInfo.data.nome;
                } catch (e) {}

                return {
                    idEmprestimo: emp.id,
                    dataEmprestimo: emp.dataEmprestimo,
                    dataDevolucaoPrevista: emp.dataPrevista,
                    dataDevolucaoReal: emp.dataDevolucao,
                    statusEmprestimo: emp.status,
                    titulo,
                    usuario_info,
                    idUsuario: emp.idUsuario
                };
            }));

            res.json(fullData);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- READ: Meus Empréstimos (Para Usuário Final) ---
    getMyEmprestimos: async (req, res) => {
        const idUsuario = req.userId;
        try {
            const [rows] = await db.query(`
                SELECT * FROM emprestimo WHERE idUsuario = ? ORDER BY dataEmprestimo DESC
            `, [idUsuario]);

            const fullData = await Promise.all(rows.map(async (emp) => {
                let titulo = 'Carregando...';
                let editora = '';
                try {
                    const bookInfo = await axios.get(`${process.env.URL_CATALOGO}/${emp.idLivro}`);
                    titulo = bookInfo.data.titulo;
                    editora = bookInfo.data.editora;
                } catch (e) {}

                return {
                    idEmprestimo: emp.id,
                    dataEmprestimo: emp.dataEmprestimo,
                    dataDevolucaoPrevista: emp.dataPrevista,
                    dataDevolucaoReal: emp.dataDevolucao,
                    statusEmprestimo: emp.status,
                    titulo,
                    editora
                };
            }));

            res.json(fullData);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- READ: Por ID ---
    getEmprestimoById: async (req, res) => {
        const { id } = req.params;
        try {
            const [rows] = await db.query('SELECT * FROM emprestimo WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ message: "Empréstimo não encontrado" });
            res.json(rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- UPDATE: Devolver Livro ---
    devolverLivro: async (req, res) => {
        const { id } = req.params;
        
        try {
            // 1. Busca empréstimo
            const [rows] = await db.query('SELECT * FROM emprestimo WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ message: "Empréstimo não encontrado" });
            
            const emprestimo = rows[0];
            if (emprestimo.status === 'Devolvido') {
                return res.status(400).json({ message: "Livro já devolvido." });
            }

            const dataDevolucao = new Date();
            const dataPrevista = new Date(emprestimo.dataPrevista);
            
            // Cálculo simples de multa (Ex: 2.50 por dia de atraso)
            let multa = 0.00;
            if (dataDevolucao > dataPrevista) {
                const diffTime = Math.abs(dataDevolucao - dataPrevista);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                multa = diffDays * 2.50;
            }

            // 2. Atualiza Empréstimo
            await db.query(`
                UPDATE emprestimo 
                SET dataDevolucao = ?, status = 'Devolvido', multa = ?
                WHERE id = ?
            `, [dataDevolucao, multa, id]);

            // 3. Devolver ao Estoque (Catálogo)
            try {
                 const bookRes = await axios.get(`${process.env.URL_CATALOGO}/${emprestimo.idLivro}`);
                 const estoqueAtual = bookRes.data.estoque || 0;
                 await axios.put(`${process.env.URL_CATALOGO}/${emprestimo.idLivro}/stock`, {
                     novaQuantidade: estoqueAtual + 1
                 });
            } catch(e) {
                console.error("Erro ao devolver estoque:", e.message);
            }

            res.json({ message: "Devolução registrada com sucesso", multa: multa });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- DELETE ---
    deleteEmprestimo: async (req, res) => {
        const { id } = req.params;
        try {
            await db.query('DELETE FROM emprestimo WHERE id = ?', [id]);
            res.json({ message: "Registro de empréstimo deletado." });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = emprestimosController;