// Caminho: src/middlewares/auth.js

module.exports = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    // 1. Verifica se o header existe
    if (!authHeader) {
        return res.status(401).json({ message: "Token não fornecido." });
    }

    // 2. Extrai o token (remove o prefixo "Bearer ")
    const parts = authHeader.split(' ');
    if (parts.length !== 2) {
        return res.status(401).json({ message: "Erro no formato do token." });
    }
    
    const token = parts[1];

    try {
        // 3. Divide o JWT nas suas 3 partes
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
            throw new Error("Token malformado");
        }

        // 4. Descodifica o Payload (segunda parte) usando Buffer
        const base64Payload = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payloadStr = Buffer.from(base64Payload, 'base64').toString('utf-8');
        const payload = JSON.parse(payloadStr);

        // 5. Verifica se o ID existe no payload
        if (!payload.id) {
            return res.status(403).json({ message: "Token inválido: ID do utilizador não encontrado." });
        }

        // 6. Define o ID correto do utilizador logado (será 17 no seu caso)
        req.userId = payload.id;
        next();

    } catch (e) {
        console.error("Erro na autenticação:", e.message);
        return res.status(401).json({ message: "Token inválido ou expirado." });
    }
};