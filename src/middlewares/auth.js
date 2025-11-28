module.exports = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    if (authHeader) {
        const token = authHeader.split(' ')[1];
    }
    
    req.userId = 1;
    
    try {
        if(authHeader){
             const base64Url = authHeader.split('.')[1];
             const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
             const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                 return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
             }).join(''));
             const payload = JSON.parse(jsonPayload);
             if(payload.id) req.userId = payload.id;
        }
    } catch(e) {}

    next();
};