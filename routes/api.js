'use strict';

var express = require('express');
var router = express.Router();
var util = require('util');
var request = require('request');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var workerSnapID = 'V1'

// console.log = function(){};

var label2runner = {};
var workers = [];
var isCheckingWorkers = false;

var dopletNewID = 0;

var workers = (function(){
	var workers = [];

	workers.checkDroplet = function(id, time){
		time = time || 5000;
		doapi.dropletInfo(id, function(data){
			var worker = JSON.parse(data)['droplet'];
			if(worker.status == 'active'){
				console.log('Droplet is now active, starting runners in 20 seconds')
				setTimeout(function(worker){
					console.log('Ready to start runners!')
					workers.startRunners(workers[workers.push(workers.makeWorkerObj(worker))-1])
					isCheckingWorkers = false;
				}, 20000, worker);
				return true;
			}else{
				console.log('Worker not ready, check again in ', time, 'MS');
				setTimeout(function(){
					workers.checkDroplet(id);
				}, time);
			}
		});
	};

	workers.create = function(){
		doapi.dropletCreate({	
			name: 'clw'+workerSnapID+'-'+(Math.random()*100).toString().replace('.',''),
			image: '17575764'
		}, function(data){
			data = JSON.parse(data);
			setTimeout(function(dopletNewID){
				workers.checkDroplet(dopletNewID);
			}, 60000, data.droplet.id);
			doapi.dropletSetTag('clworker', data.droplet.id, function(){});
		});

	};

	workers.destroy = function(worker){
		worker = worker || workers.pop();
		doapi.dropletDestroy(worker.id, function(){});
		// workers.checkBalance();
	};

	workers.makeWorkerObj = function(worker){
		worker.networks.v4.forEach(function(value){
			worker[value.type+'IP'] = value.ip_address;
		});
		worker.availrunners = [];
		worker.ip = worker.privateIP;
		worker.usedrunner = 0;
		worker.index = workers.length,
		worker.getRunner = function(){
			if(this.availrunners.length === 0) return false;
			console.log('geting runner from ', worker.name, ' aval length ', this.availrunners.length);
			var runner = this.availrunners.pop();
			this.usedrunner++;
			label2runner[runner.label] = runner;
			
			return runner;
		}
		return worker;
	};

	workers.destroyOld = function(){
		doapi.dropletsByTag('clworker', function(data){
			data = JSON.parse(data);
			console.log('dropletsByTag data:',data);
			data['droplets'].forEach(function(worker){
				console.log('found old droplet, killing it');
				doapi.dropletDestroy(worker.id, function(){});
			});
			workers.checkBalance();
		});
	};

	workers.startRunners = function(worker, stopPercent){
		console.log('starting runners on', worker.name)
		stopPercent = stopPercent || 80;
		ramPercentUsed(worker.ip, function(usedMemPercent){
			if(usedMemPercent < stopPercent ){
				var name = 'crunner-'+(Math.random()*100).toString().replace('.','');
				return lxc.startEphemeral(name, 'crunner0', worker.ip, function(data){
					if( !data.ip ) return setTimeout(workers.startRunners(worker),0);
					console.log('started runner')

					worker.availrunners.push({
						ip: data.ip,
						name: name,
						worker: worker,
						label: worker.name + ':' + name
					});
					return setTimeout(workers.startRunners(worker, stopPercent), 0);
				});
			}else{
				setTimeout(workers.checkBalance, 10000);
				console.log('using', usedMemPercent, 'percent memory, stopping runner creation!', worker.availrunners.length, 'created on ', worker.name);
			}
		});
	};

	workers.checkBalance = function(){
		if(isCheckingWorkers) return false;
		isCheckingWorkers = true;
		var changed = false;
		var minWorkers = 3;
		console.log('checking balance');

		if(workers.length < minWorkers){
			console.log('less then 3 workers, starting a droplet');
			for(var i=minWorkers; i--;) workers.create();
			return ;
		}
		if(workers[workers.length-1].usedrunner !== 0){
			console.log('last droplet has no free runners, starting droplet');
			return workers.create();
		}
		if(workers.length > minWorkers && workers[workers.length-1].usedrunner === 0 && workers[workers.length-2].usedrunner === 0){
			console.log('Last 2 runners not used, killing last runner');
			workers.destroy();
			changed = true;
		}

		for(let worker of workers){
			if(worker.length <= 3) break;
			if(worker.availrunners.length === 0 && worker.usedrunner === 0){
				console.log('found zombie worker, destroying')
				workers.destroy(worker);
				changed = true;
			}
		}

		console.log('stopping workers balancing check');
		isCheckingWorkers = false;
		if(changed) setTimeout(function(){
			workers.checkBalance();
		}, 5000);
	};

	return workers;

})();

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

	workers.startRunners(runner.worker);
};

var lxcTimeout = function(runner, time){
	time = time || 60000 // 900000; // 15 minutes

	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}

	return runner.timeout = setTimeout(function(){
		runnerFree(runner);
	}, time);
};

var run = function(req, res, runner){

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
		if(response.statusCode !== 200 || error) return run(req, res, getAvailrunner());
		body = JSON.parse(body);

		body['ip'] = getAvailrunner(runner).label;
		lxcTimeout(runner);
		return res.json(body);

	});
};

var getAvailrunner = function(runner){
	for(let worker of workers){
		console.log('checking ', worker.name, ' with ', worker.availrunners.length, ' free workers');
		if(worker.availrunners.length === 0) continue;
		if(runner && runner.worker.index <= worker.index) break;
		if(runner) runnerFree(runner);
		workers.checkBalance();
		return worker.getRunner();
	}
	if(runner) return runner;
	return false;
};

setInterval(workers.checkBalance, 30000);
workers.destroyOld();

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
	res.send("<h1>Workers</h1><pre>"+obj+"</pre><h1>label2runner</h1><pre>"+util.inspect(label2runner)+'</pre><h1>DO calls</h1>'+doapi.calls);
});

router.post('/run/:ip?', function doRun(req, res, next){
	console.log('hit runner route')
	var runner = label2runner[req.params.ip] || getAvailrunner();
	console.log('')
	return run(req, res, runner);
});

module.exports = router;
