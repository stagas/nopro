#!/usr/bin/env node

var cwd = process.cwd()

var options = {
  commands: [
    'server', '-s', 'Run server'
  , 'deploy', '', 'Deploy application (default)'
  , 'info', '-i', 'Server information'
  , 'list', '-l', 'List applications'
  , 'kill', '-k', 'Kill application'
  , 'destroy', '-d', 'Destroy application (kills and removes)'
  ]

, arguments: [
    'host', 'Hostname to use'
  , 'app', 'Application to run'
  , 'params', 'Application parameters'
  ]

, usage: function () {
    console.log(
      [ 'nopro [command] <host> <app> [params]\n'

      , 'Commands:'
      , (function (commands) {
          var str = ''
          for (var cmd = '', i = 0, len = commands.length; i < len; i += 3, cmd = '') {
            cmd += '  ' + commands[i] + (commands[i + 1] ? ', ' + commands[i + 1] : '')
            str += cmd + ' ' + new Array(16 - cmd.length).join('.') + ' ' + commands[i + 2] + '\n'
          }
          return str
        }(this.commands))

      , 'Arguments:'
      , (function (args) {
          var str = ''
          for (var i = 0, len = args.length; i < len; i += 2) {
            str += '  ' + args[i] + ' ' + new Array(14 - args[i].length).join('.') + ' ' + args[i + 1] + '\n'
          }
          return str
        }(this.arguments))
      ].join('\n').slice(0, -1)
    )
    process.exit(1)
  }

, process: function (args) {
    if (!args.length) return null
    var opts = {}
      , pos = this.commands.filter(function (cmd, index) {
        return (index + 1) % 3 && cmd.length
      }).indexOf(args[0])
    if (~pos) {
      if (args[0][0] === '-') args[0] = this.commands[pos - 1]
      opts[args.shift()] = true
    }
    opts.host = args[0]
    opts.app = args[1]
    opts.params = args.slice(2)
    return opts
  }
}

var net = require('net')
  , child_process = require('child_process')
  , spawn = child_process.spawn
  , exec = child_process.exec
  , config = require('confu')('./config.json')
  , Store = require('ministore')(config.db || cwd + '/nopro-db', {
      polling: true
    , watch: true
    })
  , apps = Store('apps')

var port = config.port || 7000
  , ports = []

var args = options.process(process.argv.slice(2))
if (!args) options.usage()

if (args.server) {
  runProxy()

} else if (args.kill) {
  console.log('killing app:', args.host)
  pub('kill', args.host, function () {
    process.exit(0)
  })

} else if (args.destroy) {
  console.log('destroying app:', args.host)
  pub('destroy', args.host, function () {
    process.exit(0)
  })

} else if (args.list) {
  apps.all(function (err, data) {
    console.log(JSON.stringify(data, null, '  '))
    process.exit(0)
  })

} else {
  if (!args.host || !args.app) options.usage()
  console.log('deploying app:', args.host)
  pub('deploy', args.host + ' ' + args.app + ' ' + args.params.join(' '), function () {
    process.exit(0)
  })
}

function killApp (host, cb) {
  var app = apps.get(host)
    , pid = app && app.pid
  if (!pid) {
    return cb && cb(new Error('no pid for app: ' + host))
  }
  log(app, 'killing app')
  kill(pid, cb)
}

function kill (pids, cb) {
  exec('kill -9 ' + (Array.isArray(pids) ? pids.join(' ') : pids), cb)
}

function runListener () {
  var server = net.createServer(function (client) {
    client.setEncoding('utf8')
    client.on('data', function (data) {
      data = data.split(/ |\r\n|\n|\r/igm)
      var cmd = data[0]
        , a = data[1]
        , b = data[2]
        , c = data[3]

      switch (cmd) {
        case 'deploy':
          addApp({ host: a, app: b, params: data.slice(3) }, function (err) {
            if (err) return console.error(err.stack)
            console.log('deployed:', a)
          })
          break
        case 'kill':
          killApp(a, function (err) {
            if (err) return console.error(err.stack)
            console.log('killed:', a)
          })
          break
        case 'destroy':
          killApp(a, function (err) {
            if (err) console.error(err.stack)
            else console.log('killed:', a)
            apps.remove(a, function (err) {
              if (err) return console.error(err.message)
              console.log('destroyed:', a)
            })
          })
          break
      }
    })
  })
  server.listen(config.paths.socket || '/tmp/nopro.sock')
}

function pub () {
  var args = [].slice.call(arguments)
    , cb = args.pop()
  
  var socket = net.createConnection(config.paths.socket || '/tmp/nopro.sock')
  socket.end(args.join(' '), cb)
}

function idler () {
  var now = Date.now()
  apps.forEach(function (k, app) {
    if (app.pid && app.running
      && now - app.lastAccessTime > (config.idle || 5000)) { // 900000 (15 minutes)
      kill([app.pid], function (err) {
        if (err) return console.error(err.stack)
        app.running = false
        app.pid = 0
        app.port = 0
        apps.set(app.host, app)
        console.log('idled:', app.host)
      })
    }
  })
}

function runProxy () {
  var httpProxy = require('http-proxy')

  runListener()

  setInterval(idler, 10000)

  var createServer = function () {
    console.log('running server')
    httpProxy.createServer(function (req, res, proxy) {
      var buffer = proxy.buffer(req)
        , host = req.headers.host.toLowerCase()
        , hostParts = host.split('.')

      req.headers.ip = req.connection.remoteAddress

      if (hostParts[0] === 'www') {
        host = hostParts.slice(1).join('.')
      }

      var app = apps.get(host)

      var redirect = false
      if (app) {
        if (app.www && hostParts[0] !== 'www') {
          redirect = 'www.'
        } else if (!app.www && hostParts[0] === 'www') {
          redirect = true
        }
      }

      if (redirect) {
        res.writeHead(301, {
          'Content-Type': 'text/html'
        , 'Location': 'http://' + ('string' === typeof redirect && redirect || '') + host + req.url 
        })
        return res.end('Moved <a href="http://' + ('string' === typeof redirect && redirect || '') + host + req.url + '">here</a>')
      }

      if (app) {
        if (app.running) {
          app.lastAccessTime = Date.now()
          apps.set(app.host, app)
          proxy.proxyRequest(req, res, {
            host: app.host
          , port: app.port
          , buffer: buffer
          })
        } else {
          runApp(app, function (running) {
            if (!running) {
              res.writeHead(500, { 'Content-Type': 'text/html' })
              return res.end(
                  '<h1>Internal Server Error</h1>'
                + '<p>The URL you requested could not be retrieved'
                + 'because of an internal server error</p>'
                )
            }
            setTimeout(function () {
              apps.set(host, app)
              proxy.proxyRequest(req, res, {
                host: app.host
              , port: app.port
              , buffer: buffer
              })
            }, 2000)
          })
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' })
        res.end('<h1>Not Found</h1><p>The URL you requested could not be found</p>')
      }
    }).listen(config.port || 80, config.host || '127.0.0.1')
  }

  var pids = []
  apps.forEach(function (host, app) {
    if (app.pid) pids.push(app.pid)
    app.pid = 0
    app.port = 0
    app.running = false
    apps.set(host, app)
  })

  if (pids.length) {
    console.log('killing old processes')
    kill(pids, function () {
      setTimeout(function () {
        createServer()
      }, 3000)
    })
  } else {
    createServer()
  }
}

function addApp (app, cb) {
  if (app.host.split('.')[0] === 'www') {
    app.www = true
    app.host = app.host.split('.').slice(1).join('.')
  } else {
    app.www = false
  }
  if (!apps.has(app.host)) {
    log(app, 'ok - added app')
    apps.set(app.host, app, cb)
  } else {
    app = apps.get(app.host)
    log(app, 'ERROR - already exists')
    cb && cb()
  }
}


function runApp (app, cb) {
  var child

  port = config.port || 7000
  while (~ports.indexOf((app.port = port++))) {}
  ports.push(app.port)

  log(app, 'running app')

  process.env.HOST = app.host
  process.env.PORT = app.port

  try {
    child = spawn(app.app, app.params)
    app.running = true
    app.pid = child.pid
    app.lastAccessTime = Date.now()
    apps.set(app.host, app)
  } catch(e) {
    console.error(e.stack)
    return
  }

  child.stdout.on('data', function (data) {
    process.stdout.write(data)
  })

  child.stderr.on('data', function (data) {
    process.stdout.write(data)
  })

  child.on('exit', function (err, sig) {
    ports.splice(ports.indexOf(app.port), 1)
    app.running = false
    app.pid = 0
    apps.set(app.host, app)
    if (err)
      console.error(err.stack)
    else
      log(app, 'app exited')
  })

  // give it some time to initialize
  setTimeout(function () {
    cb && cb(app.running)
  }, 4000)
}

function log () {
  var args = [].slice.call(arguments)
    , app = args.shift()

  args[args.length - 1] += ':'
  args.push(app.host + (app.port ? ':' + app.port : ''), app.app, app.params.join(' '))

  console.log.apply(console, args)
}