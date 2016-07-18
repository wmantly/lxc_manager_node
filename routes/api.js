'use strict';

var express = require('express');
var router = express.Router();
var util = require('util');
var request = require('request');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var label2runner = {};

var workers = (function(){
	var workers = [];
	var worker.settings = require('./workers.json');

	workers.currentCreating = 0;

	workers.create = function(){
		if(workers.currentCreating > workers.settins.max ) return false;
		workers.currentCreating++;
		return doapi.dropletToActive({	
			name: 'clw'+workerSnapID+'-'+(Math.random()*100).toString().slice(-4),
			image: '18473675',
			size: '2gb',
			onActive = function(worker){
				doapi.domianAddRecord({
					domain: "codeland.us",
					type: "A",
					name: "*."+args.worker.name+".workers",
					data: args.worker.publicIP
				}, function(){});

				workers.startRunners({
					worker: workers.makeWorkerObj(worker),
					onDone: function(worker){
						workers.push(args.worker)
					}
				}),
				workers.currentCreating--;
			}
		});

	};

	workers.makeWorkerObj = function(worker){
		worker.networks.v4.forEach(function(value){
			worker[value.type+'IP'] = value.ip_address;
		});

		worker.availrunners = [];
		worker.ip = worker.privateIP;
		worker.usedrunner = 0;
		worker.index = workers.length;
		worker.snapShotId = worker.settings.snapShotId;

		worker.getRunner = function(){
			if(this.availrunners.length === 0) return false;
			// console.log('getting runner from ', worker.name, ' avail length ', this.availrunners.length);
			var runner = this.availrunners.pop();
			this.usedrunner++;
			runnerTimeout(runner);
			
						
			return runner;
		}

		return worker;
	};

	workers.__workersId = function(argument){
		return workers.map(function(item){
			return item.id;
		});

	};

	workers.destroy = function(worker){
		var worker = worker || workers.pop();
		return doapi.dropletDestroy(worker.id, function(body) {
			console.log('body of destroy', body);
		});
	};

	workers.destroyOld = function(tag){
		if(droplets.length === 0) return true;
		var droplet = droplets.pop();
		tag = tag || 'clworker';
		var currentIDs = workers.__workersId();

		var deleteDroplets = function(droplets){
			console.log('checking', droplet.name, droplet.id);
			if(~currentIDs.indexOf(droplet.id)) return deleteDroplets(droplets);
			
			doapi.dropletDestroy(droplet.id, function(body){
				console.log('delete body', body);
				setTimeout(deleteDroplets(droplets));
			});
		}

		doapi.dropletsByTag(tag, function(data){
			data = JSON.parse(data);
			console.log('current worker ids', currentIDs);
			console.log('do droplets', data['droplets'].length, data['droplets'].map(function(item){
				return item.name+'| '+item.id;
			}));

			deleteDroplets(data['droplets']);
		});
	};

	workers.startRunners = function(args){ 
		// console.log('starting runners on', worker.name, worker.ip)
		args.stopPercent = stopPercent || 80;
		args.onStart = args.onStart || function(){};
		args.onDone = args.onDone || function(){};

		ramPercentUsed(args.worker.ip, function(usedMemPercent){
			if(usedMemPercent > stopPercent ){
				console.log('using', String(usedMemPercent), 
					'percent memory, stopping runner creation!', args.worker.availrunners.length, 
					'created on ', args.worker.name
				);
				args.onDone(worker)
				return ;
			}

			var name = 'crunner-'+(Math.random()*100).toString().slice(-4);
			lxc.startEphemeral(name, 'crunner0', args.worker.ip, function(data){
				if(!data.ip) return setTimeout(workers.startRunners,0, args);
				// console.log('started runner on', args.worker.name)
				args.onStart(args.worker.availrunners[args.worker.availrunners.length-1])

				args.worker.availrunners.push({
					ip: data.ip,
					name: name,
					worker: worker,
					label: args.worker.name + ':' + name
				});

				setTimeout(workers.startRunners(args), 0);
			});
		});
	};

	workers.checkBalance = function(){
		console.log('checking balance');

		if(workers.length < workers.settings.min){
			console.log('less then '+ workers.settings.min +' workers, starting a droplet');
			for(var i=workers.settings.min-workers.length; i--;) workers.create();
			return ;
		}

		if(minAvail > 0) return ;

		var lastMinAval
		for(let worker of workers.slice(-wokers.settings.minAvail)){
			if(worker.usedrunner !== 0){
				console.log('last 3 workers have no free runners, starting droplet');
				return workers.create();
			}
			if(workers.length > workers.settings.min && workers.usedrunner === 0 ){
				lastMinAval++;
			}
		}
		if(lastMinAval == wokers.settings.minAvail){
			console.log('Last 3 runners not used, killing last runner', workers.length);
			return workers.destroy();
		}

		for(let worker of workers){
			if(worker.availrunners.length === 0 && worker.usedrunner === 0){
				console.log('found zombie worker, destroying')
				workers.destroy(worker);
			}
		}
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

var runnerTimeout = function(runner, time){
	time = time || 60000; // 1 minutes

	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}

	return runner.timeout = setTimeout(function(){
		runnerFree(runner);
	}, time);
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

var getAvailrunner = function(runner){
	for(let worker of workers){
		if(worker.availrunners.length === 0) continue;
		if(runner && runner.worker.index <= worker.index) break;
		if(runner) runnerFree(runner);

		return worker.getRunner();
	}

	if(runner) return runner;
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
		res.json(body);
		
		if(req.params.once) return runnerFree(runner);

		label2runner[runner.label] = runner;
		body['ip'] = runner.label;
		body['rname'] = runner.name;
		body['wname'] = runner.worker.name;
		runnerTimeout(runner);
	});
};

setTimeout(function(){
	// console.log('Starting balance checking in 30 seconds')
	setInterval(workers.checkBalance, 15000);
}, 180000);

workers.destroyOld();
workers.checkBalance();


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

router.post('/updateID', function(req, res, next){

});

router.get('/liststuff', function(req, res, next){
	var obj = util.inspect(workers, {depth: 4});
	res.send("<h1>Workers</h1><pre>"+obj+"</pre><h1>label2runner</h1><pre>"+util.inspect(label2runner)+'</pre><h1>DO calls</h1>'+doapi.calls);
});

runner.get('/ping/:runner', function(req, res, next){
	runnerTimeout(runner);
	res.json({res:''});
});

router.post('/run/:runner?', function (req, res, next){
	console.log('hit runner route');
	var runner = getAvailrunner(label2runner[req.params.runner]);
	return run(req, res, runner);
});

module.exports = router;
