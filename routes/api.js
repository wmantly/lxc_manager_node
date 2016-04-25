'use strict';

var express = require('express');
var router = express.Router();
var extend = require('node.extend');
var redis = require("redis");
var client = redis.createClient();
var request = require('request');
var lxc = require('../lxc');
var os = require('os');
var spawn = require('child_process').spawn;


var totalMem = os.totalmem();
var timeoutEvents = {};
var ip2name = {};
var availContainers = [];
var usedContainers = []; 

var getFreeMem = function(callback){

	var prc = spawn('free -b',  []);

	prc.stdout.setEncoding('utf8');
	prc.stdout.on('data', function (data) {
	  var str = data.toString()
	  var lines = str.split(/\n/g);
	  for(var i = 0; i < lines.length; i++) {
	     lines[i] = lines[i].split(/\s+/);
	  }
	  var freeMem = Number(lines[2][3]);
	  return callback(freeMem);
	});

	prc.on('close', function (code) {
	});
};


var lxcTimeout = function(ip, time){
	var name = ip2name[ip];
	console.log(name)
	time = time || 900000; // 15 minutes
	var keys = Object.keys(timeoutEvents)
	if(keys.indexOf(name) !== -1){
		clearTimeout(timeoutEvents[name])
	}
	timeoutEvents[name] = setTimeout(function(){
		lxc.stop(name);
	}, time);
}


var runner = function(req, res, ip){
	lxcTimeout(ip);

	var httpOptions = {
		url:'http://' + ip + ':15000',
		body: JSON.stringify({
			code: req.body.code
		})
	};

	return request.post(httpOptions, function(error, response, body){
		body = JSON.parse(body);
		body['ip'] = ip.replace('10.0.', '');
		return res.json(body);
	});
};

var addToRedis = function(){
	lxc.info(req.params.name, null, function(data){
			var domain = req.query.domain || 'vm42.us';
			domain = req.params.name+'.'+domain;
			client.SADD("hosts", domain, function(){});
			
			var ip = data.ip + ':5000';
			client.HSET(domain, "ip", ip, redis.print);
			client.HSET(domain, "updated", (new Date).getTime(), redis.print);
			client.hset(domain, "include", "proxy.include");
			return res.json({status: 200, info: data});
	 });
};

router.get('/start/:name', function(req, res, next){
	return lxc.start(req.params.name, function(data){
		if(!data){
			return res.json({status: 500, name: req.params.name, message: data});
		}else{
			res.json({});
		}
	});
});

router.get('/live/:template/:name', function(req, res, next){
	return lxc.startEphemeral(req.params.name, req.params.template, function (data) {
		console.log('live', arguments);
		return res.json(data);
	});
});

router.get('/stop/:name', function(req, res, next){
	return lxc.stop(req.params.name, function(data){
		console.log('stop', arguments);
		if(data){
			return res.json({status: 500, name: req.params.name, message: data});
		}else{
			return res.json({status: 200});
		}
	});
});

router.get('/clone/:template/:name', function(req, res, next){
	return lxc.clone(req.params.name, req.params.template, function(data){
		console.log('clone', arguments);
		if( data.match(/Created container/) ){
			return res.json({status: 200});
		}else{
			return res.json({status: 500, message: data});
		}
	});
});

router.get('/destroy/:name', function(req, res, next){
	return lxc.destroy(req.params.name, function(data){
		console.log('destroy', arguments);
		if(data){
			return res.json({status: 500, message: data});
		}else{
			return res.json({status: 200});
		}
	});
});

router.get('/info/:name', function(req, res, next){
	return lxc.info(req.params.name, function(data){
		return res.json(data);
	});
});

router.get('/list', function(req, res, next) {
	return lxc.list(function(data){
		return res.json(data);
	});
});

router.post('/run/:ip?', function doRun(req, res, next){
	// check if server is

	return lxc.list(function(data){
		if(!req.params.ip) data = [];
		var ip = '10.0.'+ req.params.ip;
		var found = false;

		for(var idx=data.length; idx--;){
			if( data[idx]['ipv4'] === ip ){
				found = true;
				break;
			}
		}

		if(found){
			return runner(req, res, ip)
		}else{
			var name = 'crunner-'+(Math.random()*100).toString().replace('.','');
			return lxc.startEphemeral(name, 'crunner', function(data){
				ip2name[data.ip] = name;
				return runner(req, res, data.ip);
			});
		}
	});

});

// freeMem: 97700 totalmem 513818624 usedMem: 0
// freeMem: 420,472 totalmem 513,818,624 usedMem: 100
var startAll = function(){
	getFreeMem(function(freeMem){
		var usedMemPrecent = Math.round((freeMem/totalMem)*100);
		console.log('freeMem:', freeMem, 'totalmem', totalMem, 'usedMemPrecent:', usedMemPrecent);
		if(usedMemPrecent < 81 ){
			var name = 'crunner-'+(Math.random()*100).toString().replace('.','');
			return lxc.startEphemeral(name, 'crunner', function(data){
				ip2name[data.ip] = name;
				availContainers.push(data.ip);
				return startAll();
			});
		}
	});
}

startAll();

module.exports = router;
