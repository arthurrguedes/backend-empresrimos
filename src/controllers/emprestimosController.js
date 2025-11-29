const db = require('../db');
const axios = require('axios');
require('dotenv').config();

const URL_RESERVAS = process.env.URL_RESERVAS || 'http://localhost:4003/reservas';
const URL_CATALOGO = process.env.URL_CATALOGO || 'http://localhost:4002/books';
const URL_USUARIOS = process.env.URL_USUARIOS || 'http://localhost:3006/users';

const emprestimosController = {

    // Criar empréstimos
    createEmprestimo: async (req, res) => {
        const { idReserva } = req.body;
        const idBibliotecarioLogado = req.userId; 
        const authHeader = req.headers['authorization']; 

        if (!idReserva) return res.status(400).json({ message: "ID da reserva é obrigatório." });

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Buscar reserva
            let reserva;
            try {
                const response = await axios.get(`${URL_RESERVAS}/${idReserva}`, {
                    headers: { Authorization: authHeader }
                });
                reserva = response.data;
            } catch (error) {
                throw new Error(`Erro ao buscar reserva: ${error.message}`);
            }

            if (reserva.statusReserva !== 'Ativa') {
                throw new Error(`Reserva não está ativa (Status: ${reserva.statusReserva}).`);
            }

            // 2. Inserir Empréstimo
            const dataAtual = new Date();
            const dataPrevista = new Date();
            dataPrevista.setDate(dataAtual.getDate() + 7);

            const [result] = await connection.query(
                `INSERT INTO emprestimo 
                (dataEmprestimo, dataPrevista, status, idUsuario, idBibliotecario, idLivro) 
                VALUES (NOW(), ?, 'Ativo', ?, ?, ?)`,
                [dataPrevista, reserva.idUsuario, idBibliotecarioLogado, reserva.idLivro]
            );

            // 3. Atualizar reserva no outro microsserviço
            try {
                console.log(`Tentando atualizar reserva ${idReserva}...`);
                await axios.put(
                    `${URL_RESERVAS}/${idReserva}`, 
                    {
                        statusReserva: 'Concluido',
                        dataRetirada: new Date().toISOString().slice(0, 19).replace('T', ' ')
                    }, 
                    { headers: { Authorization: authHeader } }
                );
                console.log("Reserva atualizada com sucesso!");
            } catch (err) {
                // Se falhar na API externa, lançamos erro para cair no catch principal e fazer rollback do banco
                const msgErro = err.response?.data?.message || err.message;
                throw new Error(`Falha ao atualizar reserva remota: ${msgErro}`);
            }

            // 4. Confirmar transação
            await connection.commit();
            
            return res.status(201).json({ 
                message: "Empréstimo criado e reserva concluída!", 
                idEmprestimo: result.insertId 
            });

        } catch (error) {
            console.error("--- ERRO NO CREATE EMPRESTIMO ---");
            console.error(error); // Isso vai mostrar o erro real no console

            // Rollback seguro: Tenta desfazer, mas não quebra se a conexão já estiver fechada
            try {
                if (connection) await connection.rollback();
            } catch (rbError) {
                console.error("Aviso: Falha ao realizar rollback (Conexão já estava fechada).");
            }

            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
        } finally {
            if (connection) {
                try {
                    connection.release();
                } catch (e) { /* Ignora erro de release se já fechada */ }
            }
        }
    },

    // Listar todos os empréstimos (admin)
    getAllEmprestimos: async (req, res) => {
        try {
            const [rows] = await db.query(`SELECT * FROM emprestimo ORDER BY dataEmprestimo DESC`);
            
            const listaCompleta = await Promise.all(rows.map(async (emp) => {
                let titulo = 'Indisponível';
                let nomeUsuario = `User #${emp.idUsuario}`;
                
                // Busca título
                try {
                    const bookRes = await axios.get(`${URL_CATALOGO}/${emp.idLivro}`);
                    titulo = bookRes.data.titulo;
                } catch (e) {}

                // mapeamento front-end
                return {
                    idEmprestimo: emp.id,              
                    idLivro: emp.idLivro,
                    titulo: titulo,
                    usuario_info: nomeUsuario,        
                    dataEmprestimo: emp.dataEmprestimo,
                    dataDevolucaoPrevista: emp.dataPrevista, 
                    dataDevolucaoReal: emp.dataDevolucao,    
                    statusEmprestimo: emp.status,           
                    multa: emp.multa
                };
            }));

            res.json(listaCompleta);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Meus empréstimos (usuário)
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
                    editora = bookRes.data.editora; 
                } catch (e) {}

                // mapeamento front-end
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

    // Buscar por ID
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

    // Devolução do livro
    devolverLivro: async (req, res) => {
        const { id } = req.params; // idEmprestimo
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