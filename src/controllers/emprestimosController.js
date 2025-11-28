const db = require('../db');
const axios = require('axios');
require('dotenv').config();

// URLs dos outros serviços
const URL_RESERVAS = process.env.URL_RESERVAS || 'http://localhost:4003/reservas';
const URL_CATALOGO = process.env.URL_CATALOGO || 'http://localhost:4002/books';
const URL_USUARIOS = process.env.URL_USUARIOS || 'http://localhost:3006/users';

const emprestimosController = {

    // --- CREATE ---
    createEmprestimo: async (req, res) => {
        const { idReserva } = req.body;
        const idBibliotecarioLogado = req.userId; 
        const authHeader = req.headers.authorization;

        if (!idReserva) return res.status(400).json({ message: "ID da reserva é obrigatório." });

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Buscar Reserva
            let reserva;
            try {
                const response = await axios.get(`${URL_RESERVAS}/${idReserva}`, {
                    headers: { Authorization: authHeader }
                });
                reserva = response.data;
            } catch (error) {
                await connection.rollback();
                if (error.response?.status === 401) return res.status(401).json({ message: "Não autorizado no serviço de Reservas." });
                return res.status(404).json({ message: "Reserva não encontrada." });
            }

            if (reserva.statusReserva !== 'Ativa') {
                await connection.rollback();
                return res.status(400).json({ message: `Reserva não está ativa (Status: ${reserva.statusReserva}).` });
            }

            // 2. Datas
            const dataAtual = new Date();
            const dataPrevista = new Date();
            dataPrevista.setDate(dataAtual.getDate() + 7);

            // 3. Inserir Empréstimo
            const [result] = await connection.query(
                `INSERT INTO emprestimo 
                (dataEmprestimo, dataPrevista, status, idUsuario, idBibliotecario, idLivro) 
                VALUES (NOW(), ?, 'Ativo', ?, ?, ?)`,
                [dataPrevista, reserva.idUsuario, idBibliotecarioLogado, reserva.idLivro]
            );

            // 4. Atualizar Reserva
            try {
                // [CORREÇÃO] Enviando 'Concluido' (Masculino) conforme sua preferência
                await axios.put(`${URL_RESERVAS}/${idReserva}`, {
                    statusReserva: 'Concluido', 
                    dataRetirada: new Date().toISOString()
                }, { headers: { Authorization: authHeader } });
            } catch (err) {
                console.error("Aviso: Falha ao atualizar reserva remota.", err.message);
            }
            
            await connection.commit();
            res.status(201).json({ 
                message: "Empréstimo criado com sucesso!", 
                idEmprestimo: result.insertId 
            });

        } catch (error) {
            await connection.rollback();
            res.status(500).json({ error: error.message });
        } finally {
            connection.release();
        }
    },

    // --- GET ALL (ADMIN) ---
    getAllEmprestimos: async (req, res) => {
        try {
            const [rows] = await db.query(`SELECT * FROM emprestimo ORDER BY dataEmprestimo DESC`);
            
            const listaCompleta = await Promise.all(rows.map(async (emp) => {
                let titulo = 'Indisponível';
                let nomeUsuario = `User #${emp.idUsuario}`;
                
                // Busca Título
                try {
                    const bookRes = await axios.get(`${URL_CATALOGO}/${emp.idLivro}`);
                    titulo = bookRes.data.titulo;
                } catch (e) {}

                // Busca Nome Usuário (Opcional, se tiver endpoint)
                // try { const userRes = await axios.get(`${URL_USUARIOS}/${emp.idUsuario}`); nomeUsuario = userRes.data.nome; } catch(e) {}
                
                // [CORREÇÃO] Mapeamento para o Front-end
                return {
                    idEmprestimo: emp.id,              // Front espera idEmprestimo
                    idLivro: emp.idLivro,
                    titulo: titulo,
                    usuario_info: nomeUsuario,         // Front espera usuario_info
                    dataEmprestimo: emp.dataEmprestimo,
                    dataDevolucaoPrevista: emp.dataPrevista, // Front espera dataDevolucaoPrevista
                    dataDevolucaoReal: emp.dataDevolucao,    // Front espera dataDevolucaoReal
                    statusEmprestimo: emp.status,            // Front espera statusEmprestimo
                    multa: emp.multa
                };
            }));

            res.json(listaCompleta);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- MY LOANS (USUARIO) ---
    getMyEmprestimos: async (req, res) => {
        const idUsuario = req.userId;
        try {
            const [rows] = await db.query(
                `SELECT * FROM emprestimo WHERE idUsuario = ? ORDER BY dataEmprestimo DESC`, 
                [idUsuario]
            );

            const lista = await Promise.all(rows.map(async (emp) => {
                let titulo = 'Indisponível';
                let editora = '';
                try {
                    const bookRes = await axios.get(`${URL_CATALOGO}/${emp.idLivro}`);
                    titulo = bookRes.data.titulo;
                    editora = bookRes.data.editora; // Front usa editora
                } catch (e) {}

                // [CORREÇÃO] Mapeamento
                return {
                    idEmprestimo: emp.id,
                    titulo: titulo,
                    editora: editora,
                    dataEmprestimo: emp.dataEmprestimo,
                    dataDevolucaoPrevista: emp.dataPrevista,
                    dataDevolucaoReal: emp.dataDevolucao,
                    statusEmprestimo: emp.status
                };
            }));
            res.json(lista);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- GET BY ID ---
    getEmprestimoById: async (req, res) => {
        const { id } = req.params;
        try {
            const [rows] = await db.query('SELECT * FROM emprestimo WHERE id = ?', [id]);
            if (rows.length === 0) return res.status(404).json({ message: "Empréstimo não encontrado" });
            
            const emp = rows[0];
            let titulo = "Desconhecido";
            try {
                const bookRes = await axios.get(`${URL_CATALOGO}/${emp.idLivro}`);
                titulo = bookRes.data.titulo;
            } catch (e) {}

            res.json({
                idEmprestimo: emp.id,
                idLivro: emp.idLivro,
                titulo: titulo,
                dataEmprestimo: emp.dataEmprestimo,
                dataDevolucaoPrevista: emp.dataPrevista,
                statusEmprestimo: emp.status
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // --- DEVOLVER ---
    devolverLivro: async (req, res) => {
        const { id } = req.params; // Aqui chega o idEmprestimo
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [rows] = await connection.query('SELECT * FROM emprestimo WHERE id = ?', [id]);
            if (rows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: "Empréstimo não encontrado." });
            }
            const emp = rows[0];

            if (emp.status === 'Devolvido') {
                await connection.rollback();
                return res.status(400).json({ message: "Livro já devolvido." });
            }

            const hoje = new Date();
            const prevista = new Date(emp.dataPrevista);
            let valorMulta = 0.0;

            if (hoje > prevista) {
                const diffTempo = Math.abs(hoje - prevista);
                const diffDias = Math.ceil(diffTempo / (1000 * 60 * 60 * 24)); 
                valorMulta = diffDias * 2.50; 
            }

            // Atualiza status para 'Devolvido' (Capitalizado para consistência se quiser, ou Uppercase)
            // No create usei 'Ativo', aqui uso 'Devolvido'.
            await connection.query(
                `UPDATE emprestimo 
                 SET status = 'Devolvido', dataDevolucao = NOW(), multa = ? 
                 WHERE id = ?`,
                [valorMulta, id]
            );

            await connection.commit();
            res.json({ message: "Devolução registrada.", multa: valorMulta.toFixed(2) });

        } catch (error) {
            await connection.rollback();
            res.status(500).json({ error: error.message });
        } finally {
            connection.release();
        }
    }
};

module.exports = emprestimosController;