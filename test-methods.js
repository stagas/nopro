var http = require('http')
  , httpProxy = require('http-proxy');

httpProxy.createServer(function (req, res, proxy) {
  //
  // Put your custom server logic here
  //
  proxy.proxyRequest(req, res, {
    host: 'localhost',
    port: 9000
  });
}).listen(8000);

//
// Target Http Server
//
http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('method ' + req.method + ' successfully proxied to: ' + req.url + '\n' + JSON.stringify(req.headers, true, 2));
  res.end();
}).listen(9000);

function finish () {
  console.log('all done');
}

var methods = require('express/lib/router/methods');
  
;(function nextMethodRequest() {
  var method = methods.shift();
  var req = http.request({
    host: 'localhost'
  , port: 8000
  , path: '/'
  , method: method
  }, function (res) {
    res.on('error', function(err) {
      throw err;
    })
    res.on('end', function () {
      console.log(method, 'ok');
      if (!methods.length) finish();
      else nextMethodRequest();
    });
  });
  req.on('error', function(err) {
    throw err;
  })
  req.end();
}());
