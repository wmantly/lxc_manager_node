'use strict';

var express = require('express');
var router = express.Router();
var util = require('util');
var request = require('request');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var label2runner = {};
var workers = [];
var isCheckingWorkers = false;

var checkWorker = function(id, time){
	time = time || 30000;
	doapi.dropletInfo(id, function(data){
		var worker = JSON.parse(data)['droplet'];
		if(worker.status == 'active'){
			workers.push(makeWokerObj(worker));
			isCheckingWorkers = false;
			return ch;
		}else if(worker.status == 'new'){
			setTimeout(function(){
				checkWorker(id)
			}, time);
		}
	});
};

var workerCreate = function(){
	doapi.dropletCreate({	
		name: 'clworker'+(Math.random()*100).toString().replace('.',''),
		image: '17375637'
	}, function(data){
		data = JSON.parse(data);
		console.log(data);
		doapi.dropletSetTag('clworker', data.droplet.id, function(data){
			setTimeout(setTimeout(function(){checkWorker(data.droplet.id)}, 10000))
		});
	});
};

var workerDestroy = function(worker){
	worker = worker || workers.pop();
	doapi.dropletDestroy(worker.id, function(){});
};

var checkWorkers = function(){
	if(isCheckingWorkers) return false;

	isCheckingWorkers = true;
	if(!workers ){
		return workerCreate();
	}
	if(workers[workers.length-1].usedrunner){
		return workerCreate();
	}
	if(workers[workers.length-1].usedrunner && workers[workers.length-2].usedrunner){
		
		workerDestroy();
	}
	isCheckingWorkers = false;
};

var start

var ramPercentUsed = function(ip, callback){

	return lxc.exec(
		"python3 -c \"a=`head /proc/meminfo|grep MemAvail|grep -Po '\\d+'`;t=`head /proc/meminfo|grep MemTotal|grep -Po '\\d+'`;print(round(((t-a)/t)*100, 2))\"",
		ip,
		callback
	);
};

var runnerFree = function(runner){
	lxc.stop(runner.name, runner.worker.ip);
	runner.worker.usedrunner--;
	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}
	delete label2runner[runner.label];

	startRunners(runner.worker);
};

var lxcTimeout = function(runner, time){
	time = time || 60000 // 900000; // 15 minutes

	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}

	return runner.timeout = setTimeout(function(){
		runnerFree(runner)
	}, time);
};

var runner = function(req, res, runner){

	var httpOptions = {
		url: 'http://' + runner.worker.ip,
		headers: {
			Host: runner.name
		},
		body: JSON.stringify({
			code: req.body.code
		})
	};
	
	return request.post(httpOptions, function(error, response, body){
		// console.log('runner response:', arguments)
		body = JSON.parse(body);

		body['ip'] = getAvailrunner(runner).label;
		lxcTimeout(runner);
		return res.json(body);

	});
};

var makeWokerObj = function(worker){
	worker.networks.v4.forEach(function(value){
		worker[value.type+'IP'] = value.ip_address;
	});
	worker.availrunners = [];
	worker.ip = worker.privateIP;
	worker.usedrunner = 0;
	worker.index = workers.length,
	worker.getRunner = function(){
		if(this.availrunners === 0) return false;
		var runner = this.availrunners.pop();
		this.usedrunner++;
		label2runner[runner.label] = runner;
		
		return runner;
	}
	return worker;
};

var initWorkers = function(){
	doapi.dropletsByTag('clworker', function(data){
		data = JSON.parse(data);
		data['droplets'].forEach(function(value){
			startRunners(workers[workers.push(makeWokerObj(value))-1]);
		});
	});
};

var getAvailrunner = function(runner){
	var i = -1;
	while(workers[++i].availrunners.length && ( runner && workers[i].index < runner.worker.index )){
		if(runner) runnerFree(runner);
		return workers[i].getRunner();
	}
	if(runner) return runner;

};

var startRunners = function(worker, stopPercent){
	console.log('starting runners on', worker.name)
	stopPercent = stopPercent || 15;
	ramPercentUsed(worker.ip, function(usedMemPercent){
		if(usedMemPercent < stopPercent ){
			var name = 'crunner-'+(Math.random()*100).toString().replace('.','');
			return lxc.startEphemeral(name, 'crunner0', worker.ip, function(data){
				if( !data.ip ) return setTimeout(startRunners(worker),0);
				console.log('started runner')

				worker.availrunners.push({
					ip: data.ip,
					name: name,
					worker: worker,
					label: worker.name + ':' + name
				});
				return setTimeout(startRunners(worker, stopPercent), 0);
			});
		}else{
			checkWorker();
			console.log('using', usedMemPercent, 'percent memory, stopping runner creation!', worker.availrunners.length, 'created');
		}
	});
};

initWorkers();

// router.get('/start/:name', function(req, res, next){
// 	return lxc.start(req.params.name, function(data){
// 		if(!data){
// 			return res.json({
// 				status: 500,
// 				name: req.params.name,
// 				message: data
// 			});
// 		}else{
// 			res.json({});
// 		}
// 	});
// });

// router.get('/live/:template/:name', function(req, res, next){
// 	return lxc.startEphemeral(req.params.name, req.params.template, function (data) {
// 		console.log('live', arguments);
// 		return res.json(data);
// 	});
// });

// router.get('/clone/:template/:name', function(req, res, next){
// 	return lxc.clone(req.params.name, req.params.template, function(data){
// 		console.log('clone', arguments);
// 		if( data.match(/Created runner/) ){
// 			return res.json({status: 200});
// 		}else{
// 			return res.json({status: 500, message: data});
// 		}
// 	});
// });

// router.get('/destroy/:name', function(req, res, next){
// 	return lxc.destroy(req.params.name, function(data){
// 		console.log('destroy', arguments);
// 		if(data){
// 			return res.json({status: 500, message: data});
// 		}else{
// 			return res.json({status: 200});
// 		}
// 	});
// });

// router.get('/info/:name', function(req, res, next){
// 	return lxc.info(req.params.name, function(data){
// 		return res.json(data);
// 	});
// });

// router.get('/list', function(req, res, next) {
// 	return lxc.list(workers.clworker0.ip, function(data){
// 		return res.json(data);
// 	});
// });

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

router.get('/liststuff', function(req, res, next){
	var obj = util.inspect(workers, {depth: 4});
	res.send(obj);
});

router.post('/run/:ip?', function doRun(req, res, next){

	var runner = label2runner[req.params.ip] || getAvailrunner();
	
	return runner(req, res, runner);
});

module.exports = router;
