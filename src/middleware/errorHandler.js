export default (err, req, res, next) => {
    err.message = `${req.method} ERROR from path ${req.url}`;
    console.error('Error:', err.message);
    res.status(500).json({error: 'Internal server error'});
};