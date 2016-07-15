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
var isCheckingWorkers = false;

var workers = (function(){
	var workers = [];
	
	workers.currentCreatingMax = 2;

	workers.currentCreating = 0;
	
	workers.checkDroplet = function(id, time){
		time = time || 10000;

		return doapi.dropletInfo(id, function(data){
			var worker = JSON.parse(data)['droplet'];
			if(worker.status == 'active'){
				// console.log('Droplet is now active, starting runners in 20 seconds');

				return setTimeout(function(worker){
					// console.log('Ready to start runners!');
					workers.startRunners(workers.makeWorkerObj(worker), true);
					workers.currentCreating--;
				}, 20000, worker);
			}else{
				// console.log('Worker not ready, check again in ', time, 'MS');

				return setTimeout(function(){
					workers.checkDroplet(id);
				}, time);
			}
		});
	};

	workers.create = function(){
		if(workers.currentCreating > workers.currentCreatingMax ) return false;
		return doapi.dropletCreate({	
			name: 'clw'+workerSnapID+'-'+(Math.random()*100).toString().slice(-4),
			image: '18473675',
			size: '2gb'
		}, function(data){
			data = JSON.parse(data);
			workers.currentCreating++;
			setTimeout(function(dopletNewID){
				return workers.checkDroplet(dopletNewID);
			}, 70000, data.droplet.id);

			return doapi.dropletSetTag('clworker', data.droplet.id, function(){});
		});

	};

	workers.destroy = function(worker){
		var worker = worker || workers.pop();
		return doapi.dropletDestroy(worker.id, function(body) {
			console.log('body of destroy', body)
		});
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
			// console.log('getting runner from ', worker.name, ' avail length ', this.availrunners.length);
			var runner = this.availrunners.pop();
			this.usedrunner++;
			lxcTimeout(runner);
			label2runner[runner.label] = runner;
			
			
			return runner;
		}

		return worker;
	};

	workers.__workersId = function(argument){
		return workers.map(function(item){
			return item.id;
		});

	};

	workers.destroyOld = function(){
		var currentIDs = workers.__workersId()
		doapi.dropletsByTag('clworker', function(data){
			data = JSON.parse(data);
			console.log('current worker ids', currentIDs)
			console.log('do droplets', data['droplets'].length, data['droplets'].map(function(item){
				return item.name+'| '+item.id;
			}));
			data['droplets'].forEach(function(worker){
				console.log('checking', worker.name, worker.id)
				if(~currentIDs.indexOf(worker.id)) return false;

				console.log('found old droplet, killing it');
				setTimeout(function(id) {
					// body...
					doapi.dropletDestroy(id, function(body){console.log('delete body', body)});
				}, Math.floor(Math.random() * 9) + 1, worker.id)
			});
		});
	};

	workers.startRunners = function(worker, newWorker, stopPercent){
		// console.log('starting runners on', worker.name, worker.ip)
		stopPercent = stopPercent || 80;
		ramPercentUsed(worker.ip, function(usedMemPercent){
			if(usedMemPercent < stopPercent ){
				var name = 'crunner-'+(Math.random()*100).toString().slice(-4);
				return lxc.startEphemeral(name, 'crunner0', worker.ip, function(data){
					if(!data.ip) return setTimeout(workers.startRunners(worker, newWorker),0);
					// console.log('started runner on', worker.name)
					if(newWorker){
						worker = workers[workers.push(worker)-1];
						doapi.domianAddRecord({
							domain: "codeland.us",
							type: "A",
							name: "*."+worker.name+".workers",
							data: worker.publicIP
						}, function(){});
					}

					worker.availrunners.push({
						ip: data.ip,
						name: name,
						worker: worker,
						label: worker.name + ':' + name
					});
					return setTimeout(workers.startRunners(worker, false ,stopPercent), 0);
				});
			}else{
				console.log('using', String(usedMemPercent), 'percent memory, stopping runner creation!', worker.availrunners.length, 'created on ', worker.name);
			}
		});
	};

	workers.checkBalance = function(){

		var minWorkers = 1;
		console.log('checking balance');

		if(workers.length < minWorkers){
			console.log('less then 3 workers, starting a droplet');
			for(var i=minWorkers-workers.length; i--;) workers.create();
			return ;
		}
		// if(workers[workers.length-3].usedrunner !== 0 && workers[workers.length-2].usedrunner !== 0 && workers[workers.length-1].usedrunner !== 0){
		// 	console.log('last 3 workers have no free runners, starting droplet');
		// 	return workers.create();
		// }
		// if(workers.length > minWorkers && workers[workers.length-3].usedrunner === 0 && workers[workers.length-2].usedrunner === 0 && workers[workers.length-1].usedrunner === 0){
		// 	console.log('Last 2 runners not used, killing last runner', workers.length);
		// 	return workers.destroy();
		// }

		// for(let worker of workers){
		// 	if(worker.length <= 3) break;
		// 	if(worker.availrunners.length === 0 && worker.usedrunner === 0){
		// 		console.log('found zombie worker, destroying')
		// 		workers.destroy(worker);
		// 	}
		// }

		console.log('stopping workers balancing check');
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
	time = time || 60000; // 1 minutes

	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}

	return runner.timeout = setTimeout(function(){
		runnerFree(runner);
	}, time);
};

var getAvailrunner = function(runner){
	for(let worker of workers){
		if(worker.availrunners.length === 0) continue;
		if(runner && runner.worker.index <= worker.index) break;
		if(runner) runnerFree(runner);
		return worker.getRunner();
	}
	if(runner) return runner;
	return null;
};

var run = function(req, res, runner, count){
	count = count || 0;
	console.log('run start', count);

	if(!runner){
		console.log('no runner');
		res.status(503);
		return res.json({error: 'No runners, try again soon.'});
	}

	if(count > 3){
		console.log('to many reties on runner');
		res.status(400);
		return res.json({error: 'Runner restarted to many times'});
	}

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
		if(error || response.statusCode !== 200) return run(req, res, getAvailrunner(), ++count);
		body = JSON.parse(body);

		body['ip'] = runner.label;
		body['rname'] = runner.name;
		body['wname'] = runner.worker.name;
		lxcTimeout(runner);
		return res.json(body);

	});
};

setTimeout(function(){
	// console.log('Starting balance checking in 30 seconds')
	setInterval(workers.checkBalance, 15000);
}, 180000); 

setInterval(function(argument) {
	workers.destroyOld();
}, 3600000); // 1 hour

workers.destroyOld();
workers.checkBalance();

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
router.get('/destroyOld', function(req, res, next) {
	workers.destroyOld();
	res.send('?');
});

router.get('/liststuff', function(req, res, next){
	var obj = util.inspect(workers, {depth: 4});
	res.send("<h1>Workers</h1><pre>"+obj+"</pre><h1>label2runner</h1><pre>"+util.inspect(label2runner)+'</pre><h1>DO calls</h1>'+doapi.calls);
});

router.post('/run/:ip?', function doRun(req, res, next){
	console.log('hit runner route');
	var runner = getAvailrunner(label2runner[req.params.ip]);
	return run(req, res, runner);
});

module.exports = router;
