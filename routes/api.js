'use strict';

var express = require('express');
var router = express.Router();
var util = require('util');
var request = require('request');
var jsonfile = require('jsonfile');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var label2runner = {};

var workers = (function(){
	var workers = [];
	workers.settings = require('./workers.json');

	workers.currentCreating = 0;

	workers.create = function(){
		if(workers.currentCreating > workers.settings.max ) return false;
		workers.currentCreating++;
		doapi.dropletToActive({
			name: 'clw'+workers.settings.version+'-'+(Math.random()*100).toString().slice(-4),
			image: workers.settings.image,
			size: workers.settings.size,
			onCreate: function(data){
				doapi.dropletSetTag('clwV'+workers.settings.version, data.droplet.id);
			},
			onActive: function(worker, args){
				workers.startRunners({
					worker: workers.makeWorkerObj(worker),
					onStart: function(runner, args){
						workers.push(args.worker);
						doapi.domianAddRecord({
							domain: "codeland.us",
							type: "A",
							name: "*."+worker.name+".workers",
							data: worker.publicIP
						});
						args.onStart = function(){};
					},
					onDone: function(args){
						console.log("done with workers");
					}
				});
				workers.currentCreating--;
			}
		});

	};

	workers.makeWorkerObj = function(worker){
		worker.networks.v4.forEach(function(value){
			worker[value.type+'IP'] = value.ip_address;
		});

		worker.availrunners = [];
		worker.ip = worker.publicIP;
		worker.usedrunner = 0;
		worker.index = workers.length;

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
		tag = tag || 'clwV'+workers.settings.version;
		var currentIDs = workers.__workersId();
		var deleteDroplets = function(droplets){
			if(droplets.length === 0) return true;
			var droplet = droplets.pop();
			if(~currentIDs.indexOf(droplet.id)) return deleteDroplets(droplets);
			
			doapi.dropletDestroy(droplet.id, function(body){
				setTimeout(deleteDroplets, 1000, droplets);
			});
		}

		doapi.dropletsByTag(tag, function(data){
			data = JSON.parse(data);
			console.log('current worker ids', currentIDs);
			console.log('do droplets', data['droplets'].length, data['droplets'].map(function(item){
				return item.name+' | '+item.id;
			}));

			deleteDroplets(data['droplets']);
		});
	};

	workers.startRunners = function(args){ 
		// console.log('starting runners on', args.worker.name, args.worker.ip)
		if(!args.worker || workers.settings.image > args.worker.image.id){
			console.log('blocked outdated worker', workers.settings.image, args.worker.image.id)
			return ;
		}
		args.stopPercent = args.stopPercent || 20;
		args.onStart = args.onStart || function(){};
		args.onDone = args.onDone || function(){};

		ramPercentUsed(args.worker.ip, function(usedMemPercent){
			if(usedMemPercent > args.stopPercent ){
				console.log('using', String(usedMemPercent).trim(), 
					'percent memory, stopping runner creation!', args.worker.availrunners.length, 
					'created on ', args.worker.name
				);
				args.onDone(args)
				return ;
			}

			var name = 'crunner-'+(Math.random()*100).toString().slice(-4);
			// console.log('Free ram check passed!')
			lxc.startEphemeral(name, 'crunner0', args.worker.ip, function(data){
				if(!data.ip) return setTimeout(workers.startRunners, 0, args);
				// console.log('started runner on', args.worker.name)

				var runner = {
					ip: data.ip,
					name: name,
					worker: args.worker,
					label: args.worker.name + ':' + name
				};
				args.onStart(runner, args)

				args.worker.availrunners.push(runner);

				setTimeout(workers.startRunners, 0, args);
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

		for(let worker of workers){
			console.log("checking", worker.name, "if zombie")
			if(worker.availrunners.length === 0 && worker.usedrunner === 0){
				workers.splice(workers.indexOf(worker), 1)
				console.log('found zombie worker, destroying');
				workers.destroy(worker);
			}
		}

		if(workers.settings.minAvail > 0) return ;

		var lastMinAval = 0;
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

	};
	workers.settingsSave = function(){
		jsonfile.writeFile('./workers.json', workers.settings, {spaces: 2}, function(err) {
			console.error(err)
		});
	};

	workers.add = function(newWorkers){
		newWorkers.forEach(function(worker){
			workers.push(worker);
		});
	};

	doapi.tagCreate('clwV'+workers.settings.version);
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

	return runner.timeout = setTimeout(runnerFree, time, runner);
};

var runnerFree = function(runner){
	lxc.stop(runner.name, runner.worker.ip);
	runner.worker.usedrunner--;
	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}
	delete label2runner[runner.label];

	workers.startRunners({worker: runner.worker});
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

	if(count > 2){
		console.log('to many reties on runner');
		return res.status(400).json({error: 'Runner restarted to many times'});
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

		if(req.query.once){
			res.json(body);
			return runnerFree(runner, 0);
		}

		label2runner[runner.label] = runner;
		body['ip'] = runner.label;
		body['rname'] = runner.name;
		body['wname'] = runner.worker.name;
		res.json(body);

		runnerTimeout(runner);
	});
};

setTimeout(function(){
	// console.log('Starting balance checking in 30 seconds')
	setInterval(workers.checkBalance, 15000);
}, 600000);

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
	var newWorkers = {
		workers: [],
		target: workers.length,
		image: req.query.image,
		size: req.query.size || workers.settings.size,
		version: workers.settings.version+1
	};

	doapi.tagCreate('clwV'+newWorkers.version);
	for(var i=0; i<newWorkers.target; i++){

		doapi.dropletToActive({
			name: 'clw'+newWorkers.version+'-'+(Math.random()*100).toString().slice(-4),
			newWorkers: newWorkers,
			image: newWorkers.image,
			size: newWorkers.size,
			onCreate: function(data, args){
				doapi.dropletSetTag('clwV'+args.newWorkers.version, data.droplet.id);
			},
			onActive: function(droplet, args){
				workers.startRunners({
					worker: workers.makeWorkerObj(droplet),
					newWorkers: args.newWorkers,
					onStart: function(runner, args){
						args.newWorkers.workers.push(args.worker);
						console.log('onStart ');
						args.onStart = function(){};
					},
					onDone: function(args){
						console.log('new workers:', args.newWorkers.workers.length)
						doapi.domianAddRecord({
							domain: "codeland.us",
							type: "A",
							name: "*."+args.worker.name+".workers",
							data: args.worker.publicIP
						});
						
						if(args.newWorkers.workers.length >= args.newWorkers.target){
							console.log('upgrade complete!')
							workers.settings.image = args.newWorkers.image;
							workers.settings.size = args.newWorkers.size;

							workers.forEach(function(worker){
								worker.availrunners.forEach(function(runner){
									lxc.stop(runner.name, runner.worker.ip);
								});
								worker.availrunners = [];
							});

							workers.add(args.newWorkers.workers);
							workers.settingsSave();
							workers.checkBalance();
						}
					}

				});
			}
		});
	}
	res.json({status: "maybe?"});
});

router.get('/liststuff', function(req, res, next){
	var obj = util.inspect(workers, {depth: 4});
	res.send("<h1>Workers</h1><pre>"+obj+"</pre><h1>label2runner</h1><pre>"+util.inspect(label2runner)+'</pre><h1>DO calls</h1>'+doapi.calls);
});

router.get('/ping/:runner', function(req, res, next){
	runnerTimeout(runner);
	res.json({res:''});
});

router.post('/run/:runner?', function (req, res, next){
	console.log('hit runner route');
	var runner = getAvailrunner(label2runner[req.params.runner]);
	return run(req, res, runner);
});

module.exports = router;
