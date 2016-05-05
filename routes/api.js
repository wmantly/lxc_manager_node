'use strict';

var express = require('express');
var router = express.Router();
var extend = require('node.extend');
var request = require('request');
var lxc = require('../lxc');

var timeoutEvents = {};
var label2container = {};
var availContainers = [];
var usedContainers = [];
var workers = { 
	clworker0: {
		ip: '104.236.77.157',
		name: 'clworker0'
	}
};

var getFreeMem = function(ip, callback){

	return lxc.exec(
		"python3 -c \"a=`head /proc/meminfo|grep MemAvail|grep -Po '\\d+'`;t=`head /proc/meminfo|grep MemTotal|grep -Po '\\d+'`;print(round(((t-a)/t)*100, 2))\"",
		ip,
		callback
	);
};

var lxcTimeout = function(container, time){
	time = time || 900000; // 15 minutes
	var keys = Object.keys(timeoutEvents)

	if(keys.indexOf(container.label) !== -1){
		clearTimeout(timeoutEvents[container.label])
	}

	return timeoutEvents[container.label] = setTimeout(function(){
		lxc.stop(name, container);
		return startAll(container.worker);
	}, time);
}


var runner = function(req, res, container){
	lxcTimeout(container);

	var httpOptions = {
		url: 'http://' + container.worker.ip,
		headers: {
			host: container.name
		},
		body: JSON.stringify({
			code: req.body.code
		})
	};

	return request.post(httpOptions, function(error, response, body){
		body = JSON.parse(body);
		body['ip'] = container.label;
		return res.json(body);
	});
};

var startWorkers = function(clworker, stopPercent){
	stopPercent = stopPercent || 81;
	console.log(clworker)
	getFreeMem(clworker.ip, function(usedMemPercent, clworker){
		if(usedMemPercent < 81 ){
			var name = 'crunner-'+(Math.random()*100).toString().replace('.','');
			return lxc.startEphemeral(name, 'crunner0', clworker.ip, function(data){
				console.log('worker:', clworker.name, 'name:', name)
				availContainers.push({
					ip: data.ip,
					name: name,
					worker: clworker,
					label: clworker.name+':'+name
				});
				return startWorkers(clworker);
			});
		}else{
			console.log('using', usedMemPercent, 'percent memory, stopping container creation!', availContainers.length, 'created');
		}
	});
};

startWorkers(workers.clworker0);

router.get('/start/:name', function(req, res, next){
	return lxc.start(req.params.name, function(data){
		if(!data){
			return res.json({
				status: 500,
				name: req.params.name,
				message: data
			});
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
		var container = label2container[req.params.ip] || null;


		if(container){
			return runner(req, res, container);
		}else{
			container = availContainers.splice(0,1);
			label2container[container.worker.name+':'+container.name] = container;
			return runner(req, res, container);
		}
	});

});

module.exports = router;
