var http = require('http')
  , port = process.env.PORT
  , host = process.env.HOST
  , me = 'I am: ' + host + ':' + port
  
console.log(me)

http.createServer(function (req, res) {
  res.writeHead(200)
  res.end(me)
}).listen(port, host)
