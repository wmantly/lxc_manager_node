'use strict';

var express = require('express');
var router = express.Router();
var extend = require('node.extend');
var request = require('request');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var label2container = {};
var workers = [];

var checkBalance = function(){

};

var getFreeMem = function(ip, callback){

	return lxc.exec(
		"python3 -c \"a=`head /proc/meminfo|grep MemAvail|grep -Po '\\d+'`;t=`head /proc/meminfo|grep MemTotal|grep -Po '\\d+'`;print(round(((t-a)/t)*100, 2))\"",
		ip,
		callback
	);
};

var containerFree = function(container){
	lxc.stop(name, container);
	container.worker.usedContainer--;
	delete label2container[container.label];
};

var lxcTimeout = function(container, time){
	time = time || 900000; // 15 minutes

	if(container.hasOwnProperty('timeout')){
		clearTimeout(container.timeout);
	}

	return container.timeout = setTimeout(function(){
		containerFree(container)
		return startAll(container.worker);
	}, time);
};

var runner = function(req, res, container){
	console.log('calling runner:', container);

	var httpOptions = {
		url: 'http://' + container.worker.ip,
		headers: {
			Host: container.name
		},
		body: JSON.stringify({
			code: req.body.code
		})
	};
	
	return request.post(httpOptions, function(error, response, body){
		console.log('runner response:', arguments)
		body = JSON.parse(body);
		var i = -1;
		while(workers[++i].availContainers.length && workers[i].index < container.worker.index){
			containerFree(container);

			container = workers[i].availContainers.pop();
			container.usedContainer++;
		}
		body['ip'] = container.label;
		lxcTimeout(container);
		return res.json(body);

	});
};

var makeWokerObj = function(worker){
	worker.networks.v4.forEach(function(value){
		worker[value.type+'IP'] = value.ip_address;
	});
	worker.availContainers = [];
	worker.ip = worker.privateIP;
	worker.usedContainer = 0;
	return worker;
};

var getWorkers = function(){
	doapi.dropletsByTag('clworker', function(data){
		data = JSON.parse(data);
		data['droplets'].forEach(function(value){
			var workerIDX = workers.push(makeWokerObj(value)) - 1;
			workers[workerIDX].index = workerIDX;

			startWorker(workers[workerIDX]);
		});
	});
};

var getAvailContainer = function(){
	var i = -1;
	while(workers[++i].availContainers.length){
		var container = wrokers[i].availContainers.pop();
		label2container[container.label] = container;
		container.worker.usedContainer++;
		return container;
	}
};

var startWorker = function(clworker, stopPercent){
	stopPercent = stopPercent || 30;
	getFreeMem(clworker.ip, function(usedMemPercent){
		if(usedMemPercent < stopPercent ){
			var name = 'crunner-'+(Math.random()*100).toString().replace('.','');
			return lxc.startEphemeral(name, 'crunner0', clworker.ip, function(data){

				if( !data.ip ) return setTimeout(startWorker(clworker),0);

				worker.availContainers.push({
					ip: data.ip,
					name: name,
					worker: clworker,
					label: clworker.name+':'+name
				});
				return setTimeout(startWorker(clworker, stopPercent), 0);
			});
		}else{
			console.log('using', usedMemPercent, 'percent memory, stopping container creation!', worker.availContainers.length, 'created');
		}
	});
};

getWorkers();

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
// 		if( data.match(/Created container/) ){
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
	res.json({'workers': workers, 'availContainers': availContainers})
});

router.post('/run/:ip?', function doRun(req, res, next){
	// check if server is
	console.log('hit runner!')

	var container = label2container[req.params.ip] || getAvailContainer();
	
	return runner(req, res, container);
});

module.exports = router;
