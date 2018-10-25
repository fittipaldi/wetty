var express = require('express');
var http = require('http');
var https = require('https');
var path = require('path');
var server = require('socket.io');
var pty = require('pty.js');
var fs = require('fs');
var os = require('os');

var opts = require('optimist')
    .options({
        sslkey: {
            demand: false,
            description: 'path to SSL key'
        },
        sslcert: {
            demand: false,
            description: 'path to SSL certificate'
        },
        sshhost: {
            demand: false,
            description: 'ssh server host'
        },
        sshport: {
            demand: false,
            description: 'ssh server port'
        },
        sshuser: {
            demand: false,
            description: 'ssh user'
        },
        sshauth: {
            demand: false,
            description: 'defaults to "password", you can use "publickey,password" instead'
        },
        port: {
            demand: true,
            alias: 'p',
            description: 'wetty listen port'
        },
    }).boolean('allow_discovery').argv;

var runhttps = false;
var sshport = 22;
var sshhost = 'localhost';
var sshauth = 'password,keyboard-interactive';
var globalsshuser = '';
var forcessh = false;

if (opts.sshport) {
    sshport = opts.sshport;
}

if (opts.sshhost) {
    sshhost = opts.sshhost;
}

if (opts.sshauth) {
    sshauth = opts.sshauth
}

if (opts.sshuser) {
    globalsshuser = opts.sshuser;
}

if (opts.sslkey && opts.sslcert) {
    runhttps = true;
    opts['ssl'] = {};
    opts.ssl['key'] = fs.readFileSync(path.resolve(opts.sslkey));
    opts.ssl['cert'] = fs.readFileSync(path.resolve(opts.sslcert));
}

process.on('uncaughtException', function (e) {
    console.error('Error: ' + e);
});

var httpserv;

var app = express();
app.configure(function () {
    app.use(express.methodOverride());
    app.use(express.bodyParser());
    app.use(function (req, res, next) {
        console.log('Allowed Cross Domnain');
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });
    app.use(app.router);
});
app.get('/user/:user', function (req, res) {
    forcessh = false;
    //res.sendfile(__dirname + '/public/wetty/index.html');
	res.sendfile(__dirname + '/public/denied.html');
});
app.use('/', express.static(path.join(__dirname, 'public')));
app.get('/', function (req, res) {
    forcessh = false;
	console.log('Disable shell');
	//res.sendfile(__dirname + '/public/index.html');
    res.sendfile(__dirname + '/public/denied.html');
});


var ifaces = os.networkInterfaces();
var deniedHosts = ['localhost', '127.0.0.1', 'dublintty', 'dublintty.wiline.com'];
Object.keys(ifaces).forEach(function (ifname) {
	ifaces[ifname].forEach(function (iface) {
		if ('IPv4' !== iface.family || iface.internal !== false) {
		  // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
		  return;
		}
		deniedHosts.push(iface.address);	
	});
});
app.get('/ssh/:user/:host', function (req, res) {
    forcessh = true;
    globalsshuser = req.params.user;
    sshhost = req.params.host;
	if(deniedHosts.includes(sshhost)){
		console.log('denied');
		res.sendfile(__dirname + '/public/denied.html');
	}else{
		res.sendfile(__dirname + '/public/index.html');
	}    
});
app.get('/ssh/:user/:host/:port', function (req, res) {
    forcessh = true;
    sshport = req.params.port;
    globalsshuser = req.params.user;
    sshhost = req.params.host;
	if(deniedHosts.includes(sshhost)){
		console.log('denied');
		res.sendfile(__dirname + '/public/denied.html');
	}else{
		res.sendfile(__dirname + '/public/index.html');
	}
});

if (runhttps) {
    httpserv = https.createServer(opts.ssl, app).listen(opts.port, function () {
        console.log('https on port ' + opts.port);
    });
} else {
    httpserv = http.createServer(app).listen(opts.port, function () {
        console.log('http on port ' + opts.port);
    });
}

var io = server.listen(httpserv, {path: '/wetty/socket.io'});
io.on('connection', function (socket) {
    var sshuser = '';
    var request = socket.request;
    console.log((new Date()) + ' Connection accepted.');
    if (match = request.headers.referer.match('/user/.+$')) {
        sshuser = match[0].replace('/user/', '') + '@';
    } else if (globalsshuser) {
        sshuser = globalsshuser + '@';
    }

    var term;
    if ((process.getuid() == 0) && !forcessh) {
        term = pty.spawn('/usr/bin/env', ['login'], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30
        });
    } else if (forcessh) {
        term = pty.spawn('ssh', [sshuser + sshhost, '-p', sshport, '-q', '-o', 'StrictHostKeyChecking=no'], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30
        });
    } else {
        term = pty.spawn('ssh', [sshuser + sshhost, '-p', sshport, '-o', 'PreferredAuthentications=' + sshauth], {
            name: 'xterm-256color',
            cols: 80,
            rows: 30
        });
    }

    console.log((new Date()) + " PID=" + term.pid + " STARTED on behalf of user=" + sshuser)
    term.on('data', function (data) {
        //console.log('Data:' + data);
        socket.emit('output', data);
    });
    term.on('exit', function (code) {
        console.log((new Date()) + " PID=" + term.pid + " ENDED")
    });
    socket.on('resize', function (data) {
        term.resize(data.col, data.row);
    });
    socket.on('input', function (data) {
        term.write(data);
    });
    socket.on('disconnect', function () {
        term.end();
    });
})
