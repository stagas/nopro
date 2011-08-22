var cp = require('child_process')
  , exec = cp.exec
  , spawn = cp.spawn
  , assert = require('assert')
  , http = require('http')

var test = {}

test.deploy = function (err, next) {
  exec('./nopro.js www.test.localhost node app/app', function(err, stdout, stderr) {
    next()
  })
}

test.request = function (err, next) {
  //var methods = require('express/lib/router/methods')
  //  , method
  var methods = [ 'get', 'post', 'put', 'delete', 'options', 'head' ]
    
  ;(function getNextMethod() {
    var method = methods.shift()
    var req = http.request({
      host: 'www.test.localhost'
    , path: '/'
    , method: method
    }, function (res) {
      assert.equal(res.statusCode, 200)
      res.on('end', function() {
        console.log(method + ':', 'ok')
        if (!methods.length) next()
        else getNextMethod()
      })
      res.on('error', function(err) {
        console.log(err.message)
        console.error(err.stack)
      })
    })

    if (~[ 'post', 'put' ].indexOf(method)) {
      req.write('data\n')
      req.write('data\n')
    }
    req.end()
  }())
}

test.kill = function (err, next) {
  exec('./nopro.js kill test.localhost', function(err, stdout, stderr) {
    next()
  })
}

function run () {
  ;(function() {
    var errorHandler = function (err) {
      if (err) {
        console.error(err.message)
        console.error(err.stack)
      }
    }

    var error = errorHandler
      , tt = error

    ;['deploy', 'request', 'kill'].reverse().forEach(function(t) {
      var child = tt
      tt = function () {
        try {
          console.log('test:', t)
          test[t](null, function (err) {
            if (err) { return error(err) }
            console.log(t + ':', 'ok')
            child()
          });
        } catch (err) {
          error(err)
        }
      }
    })

    return tt
  })()()
}

console.log('test: running server')
var child = spawn('./nopro.js', [ '-s' ])
child.stdout.setEncoding('utf8')
child.stdout.on('data', function(data) {
  console.log(data)
  if (data === 'running server\n') {
    console.log('ok')
    run()
  }
})
